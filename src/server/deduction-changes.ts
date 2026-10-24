import { z } from "zod";
import type { Prisma, Term, TermPhase } from "@/generated/prisma/client";
import { AccountError } from "@/server/account-error";
import { termTransaction } from "@/server/terms";
import { scopedStudentWhere } from "@/server/access-scope";
import { studentFilters, studentDirectoryWhere, studentScopeOptions } from "@/server/students";
import { validateScheme } from "@/lib/scoring/validate";
import { decimalSchema } from "@/lib/scoring/types";
import { Rational } from "@/lib/scoring/rational";
import {
  inputStudentScope, inputChangeFilter, inputPendingStatuses, scopedStudentIds,
  staffNames, appendHistory, jsonValue, inputHistoryEntry, type InputActor,
} from "@/server/input-review";

const allPhases: TermPhase[] = ["CONFIGURATION", "ACTIVE", "CHECKING", "LOCKED"];

function projects(term: Pick<Term, "scheme">) {
  const { scheme, nodes } = validateScheme(term.scheme);
  return scheme.deductions.map(project => ({ id: project.id, name: project.name, nodeId: project.nodeId, nodeName: nodes.get(project.nodeId)?.name ?? project.nodeId, coefficient: project.coefficient }));
}
function projectOf(term: Pick<Term, "scheme">, projectId: string) {
  const project = validateScheme(term.scheme).scheme.deductions.find(item => item.id === projectId);
  if (!project) throw new AccountError("扣分项目不存在或已停用", 409);
  return project;
}
async function actorOf(tx: Prisma.TransactionClient, actorId: string): Promise<InputActor> {
  return tx.user.findUniqueOrThrow({ where: { id: actorId }, select: { id: true, role: true, collegeId: true } });
}
function positive(amount: string) {
  const value = Rational.from(amount);
  if (value.compare(Rational.from("0")) <= 0) throw new AccountError("扣分额必须为正数");
  return value;
}

const submitSchema = z.object({
  studentId: z.string().min(1).max(100),
  projectId: z.string().min(1).max(100),
  action: z.enum(["CREATE", "REVOKE"]),
  amount: decimalSchema.optional(),
  targetInputId: z.string().min(1).max(100).optional(),
  targetRevision: z.number().int().nonnegative().optional(),
  reason: z.string().trim().min(2).max(1000),
  requestId: z.string().min(8).max(100),
}).strict();

// The HTTP envelope carries termId for routing; strict schemas below must keep
// rejecting forged fields on the payload itself.
function payloadWithoutTermId(input: unknown) {
  const parsed = z.record(z.string(), z.unknown()).parse(input);
  delete parsed.termId;
  return parsed;
}

export async function submitDeductionChange(sessionId: string, termId: string, input: unknown) {
  const data = submitSchema.parse(payloadWithoutTermId(input));
  return termTransaction(sessionId, termId, ["COUNSELOR"], ["ACTIVE"], async (tx, term, actorId) => {
    const actor = await actorOf(tx, actorId);
    await inputStudentScope(tx, actor, data.studentId);
    const project = projectOf(term, data.projectId);
    const replay = await tx.deductionChange.findUnique({ where: { termId_submittedBy_requestId: { termId, submittedBy: actorId, requestId: data.requestId } } });
    if (replay) return replay;
    let target: { id: string; revision: number } | null = null;
    if (data.action === "CREATE") {
      if (data.amount === undefined) throw new AccountError("请填写扣分额");
      positive(data.amount);
    } else {
      if (!data.targetInputId || data.targetRevision === undefined) throw new AccountError("请选择需要撤销的扣分事件");
      const record = await tx.deductionInput.findUnique({ where: { id: data.targetInputId } });
      if (!record || record.termId !== termId || record.studentId !== data.studentId || record.projectId !== project.id) throw new AccountError("扣分事件不存在或无权查看", 404);
      if (record.revoked) throw new AccountError("该扣分事件已撤销", 409);
      if (record.revision !== data.targetRevision) throw new AccountError("扣分事件已变化，请刷新后重新提交", 409);
      if (await tx.deductionChange.count({ where: { termId, studentId: data.studentId, projectId: project.id, action: "REVOKE", targetInputId: record.id, status: { in: [...inputPendingStatuses] } } })) throw new AccountError("该扣分事件已有待审或退回修改中的撤销申请", 409);
      target = { id: record.id, revision: record.revision };
    }
    const change = await tx.deductionChange.create({
      data: {
        termId, studentId: data.studentId, projectId: project.id, action: data.action, amount: data.action === "CREATE" ? data.amount : null,
        reason: data.reason, requestId: data.requestId, submittedBy: actorId,
        targetInputId: target?.id ?? null, targetRevision: target?.revision ?? null,
        history: jsonValue([inputHistoryEntry(actorId, "SUBMITTED", { action: data.action, amount: data.amount ?? null, targetInputId: target?.id ?? null, reason: data.reason })]),
      },
    });
    await tx.auditEvent.create({ data: { actorId, action: data.action === "CREATE" ? "DEDUCTION_CHANGE_SUBMITTED" : "DEDUCTION_REVOKE_SUBMITTED", targetId: change.id, details: jsonValue({ termId, studentId: data.studentId, projectId: project.id, nodeId: project.nodeId, coefficient: project.coefficient, amount: data.amount ?? null, targetInputId: target?.id ?? null, reason: data.reason }) } });
    return change;
  });
}

const changeSchema = z.object({
  revision: z.number().int().nonnegative(),
  action: z.enum(["approve", "return", "resubmit", "abandon"]),
  reason: z.string().trim().min(2).max(1000).optional(),
  amount: decimalSchema.optional(),
}).strict();

export async function changeDeductionChange(sessionId: string, termId: string, id: string, input: unknown) {
  const data = changeSchema.parse(payloadWithoutTermId(input));
  return termTransaction(sessionId, termId, ["COUNSELOR", "COLLEGE"], ["ACTIVE"], async (tx, term, actorId) => {
    const actor = await actorOf(tx, actorId);
    const change = await tx.deductionChange.findUnique({ where: { id } });
    if (!change || change.termId !== termId) throw new AccountError("扣分修订不存在或无权查看", 404);
    await inputStudentScope(tx, actor, change.studentId);
    if (change.revision !== data.revision) throw new AccountError("扣分修订已变化，请刷新后核对", 409);
    const project = projectOf(term, change.projectId);
    const before = change.status;
    let next = change.status;
    const fields: Prisma.DeductionChangeUpdateInput = {};
    if (data.action === "approve") {
      if (actor.role !== "COLLEGE") throw new AccountError("只有学院可以审核扣分", 403);
      if (before !== "PENDING_COLLEGE") throw new AccountError("仅待学院审核的扣分修订可批准", 409);
      if (change.action === "CREATE") {
        if (change.amount === null) throw new AccountError("扣分修订缺少扣分额", 409);
        positive(change.amount.toFixed());
        const max = await tx.deductionInput.aggregate({ where: { termId, studentId: change.studentId, projectId: change.projectId }, _max: { occurrence: true } });
        const saved = await tx.deductionInput.create({ data: { termId, studentId: change.studentId, projectId: change.projectId, occurrence: (max._max.occurrence ?? -1) + 1, amount: change.amount, reason: change.reason } });
        await tx.auditEvent.create({ data: { actorId, action: "DEDUCTION_APPROVED", targetId: saved.id, details: jsonValue({ termId, changeId: change.id, studentId: change.studentId, projectId: change.projectId, nodeId: project.nodeId, coefficient: project.coefficient, amount: saved.amount.toFixed(), occurrence: saved.occurrence, reason: change.reason }) } });
      } else {
        if (!change.targetInputId || change.targetRevision === null) throw new AccountError("撤销修订缺少目标事件", 409);
        const record = await tx.deductionInput.findUnique({ where: { id: change.targetInputId } });
        if (!record || record.termId !== termId || record.studentId !== change.studentId || record.projectId !== change.projectId) throw new AccountError("扣分事件不存在或无权查看", 404);
        if (record.revoked) throw new AccountError("该扣分事件已撤销", 409);
        if (record.revision !== change.targetRevision) throw new AccountError("扣分事件已变化，请退回辅导员按最新记录重新提交", 409);
        const saved = await tx.deductionInput.update({ where: { id: record.id }, data: { revoked: true, revision: { increment: 1 } } });
        await tx.auditEvent.create({ data: { actorId, action: "DEDUCTION_REVOKED_APPROVED", targetId: saved.id, details: jsonValue({ termId, changeId: change.id, studentId: change.studentId, projectId: change.projectId, before: { amount: record.amount.toFixed(), revoked: record.revoked }, after: { revoked: saved.revoked }, reason: change.reason }) } });
      }
      await tx.term.update({ where: { id: termId }, data: { inputRevision: { increment: 1 } } });
      fields.reviewerId = actorId; fields.reviewedAt = new Date(); fields.reviewReason = data.reason ?? null;
      next = "APPROVED";
    } else if (data.action === "return") {
      if (actor.role !== "COLLEGE") throw new AccountError("只有学院可以退回扣分修订", 403);
      if (before !== "PENDING_COLLEGE") throw new AccountError("仅待学院审核的扣分修订可退回", 409);
      if (!data.reason) throw new AccountError("请填写退回理由");
      fields.reviewReason = data.reason; fields.reviewerId = actorId; fields.reviewedAt = new Date();
      next = "RETURNED";
    } else if (data.action === "resubmit") {
      if (actor.role !== "COUNSELOR" || change.submittedBy !== actorId) throw new AccountError("只能由原提交辅导员修正本人提交的扣分", 403);
      if (before !== "RETURNED") throw new AccountError("仅退回修改中的扣分修订可重新提交", 409);
      if (change.action === "CREATE") {
        const amount = data.amount ?? change.amount?.toFixed();
        if (amount === undefined) throw new AccountError("请填写扣分额");
        positive(amount);
        fields.amount = amount;
      } else {
        if (!change.targetInputId) throw new AccountError("撤销修订缺少目标事件", 409);
        const record = await tx.deductionInput.findUnique({ where: { id: change.targetInputId } });
        if (!record || record.revoked) throw new AccountError("该扣分事件已撤销或不存在", 409);
        fields.targetRevision = record.revision;
      }
      fields.reason = data.reason ?? change.reason;
      fields.reviewReason = null; fields.reviewerId = null; fields.reviewedAt = null;
      next = "PENDING_COLLEGE";
    } else {
      if (actor.role !== "COUNSELOR" || change.submittedBy !== actorId) throw new AccountError("只能放弃本人提交的扣分修订", 403);
      if (!["PENDING_COLLEGE", "RETURNED"].includes(before)) throw new AccountError("仅待审或退回修改中的扣分修订可放弃", 409);
      next = "ABANDONED";
    }
    const updated = await tx.deductionChange.update({
      where: { id },
      data: { ...fields, status: next, revision: { increment: 1 }, history: appendHistory(change.history, inputHistoryEntry(actorId, data.action.toUpperCase(), { before, after: next, reason: data.reason, amount: data.amount })) },
    });
    await tx.auditEvent.create({ data: { actorId, action: "DEDUCTION_CHANGE_CHANGED", targetId: id, details: jsonValue({ termId, action: data.action, before, after: next, reason: data.reason ?? null }) } });
    return updated;
  });
}

export async function readDeductionRoster(sessionId: string, termId: string, input: unknown) {
  const filters = studentFilters.parse(input);
  return termTransaction(sessionId, termId, ["ADMIN", "COLLEGE", "COUNSELOR"], allPhases, async (tx, term, actorId) => {
    const actor = await actorOf(tx, actorId);
    const where: Prisma.UserWhereInput = { AND: [scopedStudentWhere(actor), studentDirectoryWhere(filters, true)] };
    const [students, total, scope, eventCount] = await Promise.all([
      tx.user.findMany({ where, select: { id: true, login: true, name: true, studentProfile: { select: { studentNumber: true, college: true, major: true, className: true } } }, orderBy: [{ login: "asc" }, { id: "asc" }], take: 20, skip: (filters.page - 1) * 20 }),
      tx.user.count({ where }),
      tx.studentProfile.findMany({ where: { user: scopedStudentWhere(actor) }, select: { college: true, major: true, className: true }, distinct: ["college", "major", "className"] }),
      actor.role === "ADMIN"
        ? tx.deductionInput.count({ where: { termId, revoked: false } })
        : tx.deductionInput.count({ where: { termId, revoked: false, studentId: { in: await scopedStudentIds(tx, actor) } } }),
    ]);
    const ids = students.map(student => student.id);
    const [events, changes] = await Promise.all([
      ids.length ? tx.deductionInput.groupBy({ by: ["studentId"], where: { termId, studentId: { in: ids }, revoked: false }, _count: { _all: true } }) : [],
      ids.length ? tx.deductionChange.groupBy({ by: ["studentId", "status"], where: { termId, studentId: { in: ids }, status: { in: [...inputPendingStatuses] } }, _count: { _all: true } }) : [],
    ]);
    const counted = new Map(events.map(row => [row.studentId, row._count._all]));
    return {
      items: students.map(student => ({
        ...student,
        events: counted.get(student.id) ?? 0,
        pending: changes.filter(row => row.studentId === student.id && row.status === "PENDING_COLLEGE").reduce((sum, row) => sum + row._count._all, 0),
        returned: changes.filter(row => row.studentId === student.id && row.status === "RETURNED").reduce((sum, row) => sum + row._count._all, 0),
      })),
      total, page: filters.page,
      scopeOptions: studentScopeOptions(scope, filters),
      projects: projects(term),
      stats: { events: eventCount },
      canSubmit: actor.role === "COUNSELOR", canReview: actor.role === "COLLEGE", canCorrect: actor.role === "ADMIN",
    };
  }, "read");
}

export async function readDeductionDetail(sessionId: string, termId: string, studentId: string) {
  return termTransaction(sessionId, termId, ["ADMIN", "COLLEGE", "COUNSELOR"], allPhases, async (tx, term, actorId) => {
    const actor = await actorOf(tx, actorId);
    const student = await inputStudentScope(tx, actor, studentId);
    const catalog = projects(term);
    const [events, changes] = await Promise.all([
      tx.deductionInput.findMany({ where: { termId, studentId }, orderBy: [{ occurrence: "asc" }, { id: "asc" }] }),
      tx.deductionChange.findMany({ where: { termId, studentId }, orderBy: [{ submittedAt: "desc" }, { id: "desc" }], take: 60 }),
    ]);
    const names = await staffNames(tx, changes.flatMap(change => [change.submittedBy, change.reviewerId]));
    const byId = new Map(events.map(event => [event.id, event]));
    return {
      student: { id: student.id, login: student.login, name: student.name, disabled: student.disabled, profile: student.studentProfile ? { college: student.studentProfile.college, major: student.studentProfile.major, className: student.studentProfile.className } : null },
      projects: catalog,
      events: events.map(event => {
        const project = catalog.find(item => item.id === event.projectId);
        return {
          id: event.id, projectId: event.projectId, projectName: project?.name ?? event.projectId, nodeName: project?.nodeName ?? "", coefficient: project?.coefficient ?? "1",
          occurrence: event.occurrence, amount: event.amount.toFixed(), revoked: event.revoked, reason: event.reason, revision: event.revision, updatedAt: event.updatedAt,
          pendingRevoke: changes.some(change => change.targetInputId === event.id && change.action === "REVOKE" && (inputPendingStatuses as readonly string[]).includes(change.status)),
        };
      }),
      changes: changes.map(change => {
        const project = catalog.find(item => item.id === change.projectId);
        return {
          id: change.id, projectId: change.projectId, projectName: project?.name ?? change.projectId, nodeName: project?.nodeName ?? "",
          action: change.action, amount: change.amount?.toFixed() ?? null, reason: change.reason, status: change.status,
          targetInputId: change.targetInputId, targetOccurrence: change.targetInputId ? byId.get(change.targetInputId)?.occurrence ?? null : null,
          submittedBy: names.get(change.submittedBy) ?? null, submittedAt: change.submittedAt, reviewer: change.reviewerId ? names.get(change.reviewerId) ?? null : null,
          reviewedAt: change.reviewedAt, reviewReason: change.reviewReason, revision: change.revision,
        };
      }),
      canSubmit: actor.role === "COUNSELOR", canReview: actor.role === "COLLEGE", canCorrect: actor.role === "ADMIN",
      phase: term.phase, disposition: term.disposition,
    };
  }, "read");
}

export async function readDeductionQueue(sessionId: string, termId: string, input: unknown) {
  const query = z.object({ status: inputChangeFilter.default("PENDING"), page: z.coerce.number().int().min(1).max(100000).default(1) }).parse(input);
  return termTransaction(sessionId, termId, ["ADMIN", "COLLEGE", "COUNSELOR"], allPhases, async (tx, term, actorId) => {
    const actor = await actorOf(tx, actorId);
    const scope: Prisma.DeductionChangeWhereInput =
      actor.role === "COLLEGE"
        ? { studentId: { in: await scopedStudentIds(tx, actor) } }
        : actor.role === "COUNSELOR"
          ? { submittedBy: actorId }
          : {};
    const where: Prisma.DeductionChangeWhereInput = {
      termId, ...scope,
      ...(query.status === "PENDING" ? { status: { in: [...inputPendingStatuses] } } : { status: query.status }),
    };
    const [rows, total, pending, returned] = await Promise.all([
      tx.deductionChange.findMany({ where, orderBy: [{ submittedAt: "asc" }, { id: "asc" }], take: 20, skip: (query.page - 1) * 20 }),
      tx.deductionChange.count({ where }),
      tx.deductionChange.count({ where: { termId, ...scope, status: "PENDING_COLLEGE" } }),
      tx.deductionChange.count({ where: { termId, ...scope, status: "RETURNED" } }),
    ]);
    const catalog = projects(term);
    const [students, names, targets] = await Promise.all([
      tx.user.findMany({ where: { id: { in: [...new Set(rows.map(row => row.studentId))] } }, select: { id: true, login: true, name: true, studentProfile: { select: { className: true, college: true } } } }),
      staffNames(tx, rows.flatMap(row => [row.submittedBy, row.reviewerId])),
      tx.deductionInput.findMany({ where: { id: { in: rows.map(row => row.targetInputId).filter((value): value is string => Boolean(value)) } }, select: { id: true, occurrence: true, amount: true, revoked: true } }),
    ]);
    const known = new Map(students.map(student => [student.id, student])), targetById = new Map(targets.map(target => [target.id, target]));
    return {
      items: rows.map(row => {
        const student = known.get(row.studentId), project = catalog.find(item => item.id === row.projectId);
        const target = row.targetInputId ? targetById.get(row.targetInputId) : null;
        return {
          id: row.id, studentId: row.studentId, studentName: student?.name ?? "学生档案不可用", login: student?.login ?? "",
          className: student?.studentProfile?.className ?? "", college: student?.studentProfile?.college ?? "",
          projectId: row.projectId, projectName: project?.name ?? row.projectId, nodeName: project?.nodeName ?? "", coefficient: project?.coefficient ?? "1",
          action: row.action, amount: row.amount?.toFixed() ?? null, targetOccurrence: target?.occurrence ?? null, targetAmount: target?.amount.toFixed() ?? null,
          reason: row.reason, status: row.status, submitter: names.get(row.submittedBy) ?? null, submittedAt: row.submittedAt,
          reviewer: row.reviewerId ? names.get(row.reviewerId) ?? null : null, reviewedAt: row.reviewedAt, reviewReason: row.reviewReason,
          revision: row.revision, canDecide: row.status === "PENDING_COLLEGE" && actor.role === "COLLEGE",
          canRevise: row.status === "RETURNED" && actor.role === "COUNSELOR" && row.submittedBy === actorId,
        };
      }),
      total, page: query.page, status: query.status, stats: { pending, returned }, role: actor.role,
    };
  }, "read");
}
