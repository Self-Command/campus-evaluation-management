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
import { recordAudit } from "@/server/audit";
import { batchAuditDetails, type BatchContext } from "@/server/batch-context";

const allPhases: TermPhase[] = ["CONFIGURATION", "ACTIVE", "CHECKING", "LOCKED"];

function gradeNodes(term: Pick<Term, "scheme">) {
  return validateScheme(term.scheme).scheme.nodes.filter(node => node.kind === "GRADE");
}
function nodeOf(term: Pick<Term, "scheme">, nodeId: string) {
  const node = validateScheme(term.scheme).nodes.get(nodeId);
  if (!node || node.kind !== "GRADE") throw new AccountError("只能处理最底层成绩模块", 409);
  return node;
}
function rangeCheck(node: { minimum: string; maximum: string; name: string }, value: string) {
  const parsed = Rational.from(value);
  if (parsed.compare(Rational.from(node.minimum)) < 0 || parsed.compare(Rational.from(node.maximum)) > 0) throw new AccountError(`${node.name}的成绩应在${node.minimum}至${node.maximum}范围内`);
  return parsed;
}
async function actorOf(tx: Prisma.TransactionClient, actorId: string): Promise<InputActor> {
  return tx.user.findUniqueOrThrow({ where: { id: actorId }, select: { id: true, role: true, collegeId: true } });
}

const submitSchema = z.object({
  studentId: z.string().min(1).max(100),
  nodeId: z.string().min(1).max(100),
  value: decimalSchema,
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

export async function submitGradeChange(sessionId: string, termId: string, input: unknown) {
  const data = submitSchema.parse(payloadWithoutTermId(input));
  return termTransaction(sessionId, termId, ["COUNSELOR"], ["ACTIVE"], async (tx, term, actorId) => {
    const actor = await actorOf(tx, actorId);
    await inputStudentScope(tx, actor, data.studentId);
    const node = nodeOf(term, data.nodeId);
    const value = rangeCheck(node, data.value);
    const replay = await tx.gradeChange.findUnique({ where: { termId_submittedBy_requestId: { termId, submittedBy: actorId, requestId: data.requestId } } });
    if (replay) return replay;
    if (await tx.gradeChange.count({ where: { termId, studentId: data.studentId, nodeId: data.nodeId, status: { in: [...inputPendingStatuses] } } })) throw new AccountError("该学生此成绩项已有待审或退回修改中的修订，请先处理该修订", 409);
    const current = await tx.gradeInput.findUnique({ where: { termId_studentId_nodeId: { termId, studentId: data.studentId, nodeId: data.nodeId } } });
    if (current && Rational.from(current.value.toFixed()).compare(value) === 0) throw new AccountError("与当前有效成绩相同，无需提交审核");
    const change = await tx.gradeChange.create({
      data: {
        termId, studentId: data.studentId, nodeId: node.id, value: data.value, reason: data.reason, requestId: data.requestId,
        baseInputId: current?.id ?? null, baseRevision: current?.revision ?? null, baseValue: current?.value ?? null,
        submittedBy: actorId,
        history: jsonValue([inputHistoryEntry(actorId, "SUBMITTED", { value: data.value, reason: data.reason, baseValue: current?.value.toFixed() ?? null })]),
      },
    });
    await recordAudit(tx, { actorId, action: "GRADE_CHANGE_SUBMITTED", targetId: change.id, details: jsonValue({ termId, studentId: data.studentId, nodeId: node.id, value: data.value, reason: data.reason }) });
    return change;
  });
}

const changeSchema = z.object({
  revision: z.number().int().nonnegative(),
  action: z.enum(["approve", "return", "resubmit", "abandon"]),
  reason: z.string().trim().min(2).max(1000).optional(),
  value: decimalSchema.optional(),
}).strict();

export async function changeGradeChange(sessionId: string, termId: string, id: string, input: unknown, batch?: BatchContext) {
  const data = changeSchema.parse(payloadWithoutTermId(input));
  return termTransaction(sessionId, termId, ["COUNSELOR", "COLLEGE"], ["ACTIVE"], async (tx, term, actorId) => {
    const actor = await actorOf(tx, actorId);
    const change = await tx.gradeChange.findUnique({ where: { id } });
    if (!change || change.termId !== termId) throw new AccountError("成绩修订不存在或无权查看", 404);
    await inputStudentScope(tx, actor, change.studentId);
    if (change.revision !== data.revision) throw new AccountError("成绩修订已变化，请刷新后核对", 409);
    const node = nodeOf(term, change.nodeId);
    const before = change.status;
    let next = change.status;
    const fields: Prisma.GradeChangeUpdateInput = {};
    if (data.action === "approve") {
      if (actor.role !== "COLLEGE") throw new AccountError("只有学院可以审核成绩", 403);
      if (before !== "PENDING_COLLEGE") throw new AccountError("仅待学院审核的成绩修订可批准", 409);
      const current = await tx.gradeInput.findUnique({ where: { termId_studentId_nodeId: { termId, studentId: change.studentId, nodeId: change.nodeId } } });
      if ((current?.id ?? null) !== change.baseInputId || (current?.revision ?? null) !== change.baseRevision) throw new AccountError("该成绩项的有效值已变化，请退回辅导员按最新记录重新提交", 409);
      const value = rangeCheck(node, change.value.toFixed());
      if (current && Rational.from(current.value.toFixed()).compare(value) === 0) {
        fields.reviewerId = actorId; fields.reviewedAt = new Date(); fields.reviewReason = data.reason ?? null;
        next = "APPROVED";
      } else {
        const saved = current
          ? await tx.gradeInput.update({ where: { id: current.id }, data: { value: change.value, revision: { increment: 1 } } })
          : await tx.gradeInput.create({ data: { termId, studentId: change.studentId, nodeId: change.nodeId, value: change.value } });
        await tx.term.update({ where: { id: termId }, data: { inputRevision: { increment: 1 } } });
        await recordAudit(tx, { actorId, action: "GRADE_APPROVED", targetId: saved.id, details: jsonValue({ termId, changeId: change.id, studentId: change.studentId, nodeId: change.nodeId, before: current?.value.toFixed() ?? null, after: saved.value.toFixed(), reason: change.reason, ...batchAuditDetails(batch) }) });
        fields.reviewerId = actorId; fields.reviewedAt = new Date(); fields.reviewReason = data.reason ?? null;
        next = "APPROVED";
      }
    } else if (data.action === "return") {
      if (actor.role !== "COLLEGE") throw new AccountError("只有学院可以退回成绩修订", 403);
      if (before !== "PENDING_COLLEGE") throw new AccountError("仅待学院审核的成绩修订可退回", 409);
      if (!data.reason) throw new AccountError("请填写退回理由");
      fields.reviewReason = data.reason; fields.reviewerId = actorId; fields.reviewedAt = new Date();
      next = "RETURNED";
    } else if (data.action === "resubmit") {
      if (actor.role !== "COUNSELOR" || change.submittedBy !== actorId) throw new AccountError("只能由原提交辅导员修正本人提交的成绩", 403);
      if (before !== "RETURNED") throw new AccountError("仅退回修改中的成绩修订可重新提交", 409);
      if (data.value === undefined) throw new AccountError("请填写修正后的成绩");
      const value = rangeCheck(node, data.value);
      const current = await tx.gradeInput.findUnique({ where: { termId_studentId_nodeId: { termId, studentId: change.studentId, nodeId: change.nodeId } } });
      if (current && Rational.from(current.value.toFixed()).compare(value) === 0) throw new AccountError("与当前有效成绩相同，无需提交审核");
      fields.value = data.value;
      fields.reason = data.reason ?? change.reason;
      fields.baseInputId = current?.id ?? null;
      fields.baseRevision = current?.revision ?? null;
      fields.baseValue = current?.value ?? null;
      fields.reviewReason = null; fields.reviewerId = null; fields.reviewedAt = null;
      next = "PENDING_COLLEGE";
    } else {
      if (actor.role !== "COUNSELOR" || change.submittedBy !== actorId) throw new AccountError("只能放弃本人提交的成绩修订", 403);
      if (!["PENDING_COLLEGE", "RETURNED"].includes(before)) throw new AccountError("仅待审或退回修改中的修订可放弃", 409);
      next = "ABANDONED";
    }
    const updated = await tx.gradeChange.update({
      where: { id },
      data: { ...fields, status: next, revision: { increment: 1 }, history: appendHistory(change.history, inputHistoryEntry(actorId, data.action.toUpperCase(), { before, after: next, reason: data.reason, value: data.value, ...batchAuditDetails(batch) })) },
    });
    await recordAudit(tx, { actorId, action: "GRADE_CHANGE_CHANGED", targetId: id, details: jsonValue({ termId, action: data.action, before, after: next, reason: data.reason ?? null, ...batchAuditDetails(batch) }) });
    return updated;
  });
}

export async function readGradeRoster(sessionId: string, termId: string, input: unknown) {
  const filters = studentFilters.parse(input);
  return termTransaction(sessionId, termId, ["ADMIN", "COLLEGE", "COUNSELOR"], allPhases, async (tx, term, actorId) => {
    const actor = await actorOf(tx, actorId);
    const where: Prisma.UserWhereInput = { AND: [scopedStudentWhere(actor), studentDirectoryWhere(filters, true)] };
    const [students, total, scope] = await Promise.all([
      tx.user.findMany({ where, select: { id: true, login: true, name: true, studentProfile: { select: { studentNumber: true, college: true, major: true, className: true } } }, orderBy: [{ login: "asc" }, { id: "asc" }], take: 20, skip: (filters.page - 1) * 20 }),
      tx.user.count({ where }),
      tx.studentProfile.findMany({ where: { user: scopedStudentWhere(actor) }, select: { college: true, major: true, className: true }, distinct: ["college", "major", "className"] }),
    ]);
    const ids = students.map(student => student.id);
    const [entered, changes] = await Promise.all([
      ids.length ? tx.gradeInput.groupBy({ by: ["studentId"], where: { termId, studentId: { in: ids } }, _count: { _all: true } }) : [],
      ids.length ? tx.gradeChange.groupBy({ by: ["studentId", "status"], where: { termId, studentId: { in: ids }, status: { in: [...inputPendingStatuses] } }, _count: { _all: true } }) : [],
    ]);
    const counted = new Map(entered.map(row => [row.studentId, row._count._all]));
    const nodes = gradeNodes(term);
    const required = nodes.filter(node => node.required);
    return {
      items: students.map(student => ({
        ...student,
        entered: counted.get(student.id) ?? 0,
        required: (required.length ? required : nodes).length,
        pending: changes.filter(row => row.studentId === student.id && row.status === "PENDING_COLLEGE").reduce((sum, row) => sum + row._count._all, 0),
        returned: changes.filter(row => row.studentId === student.id && row.status === "RETURNED").reduce((sum, row) => sum + row._count._all, 0),
      })),
      total, page: filters.page,
      scopeOptions: studentScopeOptions(scope, filters),
      nodes: nodes.map(node => ({ id: node.id, name: node.name, minimum: node.minimum, maximum: node.maximum, required: node.required })),
      canSubmit: actor.role === "COUNSELOR",
      canReview: actor.role === "COLLEGE",
      canCorrect: actor.role === "ADMIN",
    };
  }, "read");
}

export async function readGradeDetail(sessionId: string, termId: string, studentId: string) {
  return termTransaction(sessionId, termId, ["ADMIN", "COLLEGE", "COUNSELOR"], allPhases, async (tx, term, actorId) => {
    const actor = await actorOf(tx, actorId);
    const student = await inputStudentScope(tx, actor, studentId);
    const nodes = gradeNodes(term);
    const [inputs, changes] = await Promise.all([
      tx.gradeInput.findMany({ where: { termId, studentId } }),
      tx.gradeChange.findMany({ where: { termId, studentId }, orderBy: [{ submittedAt: "desc" }, { id: "desc" }], take: 60 }),
    ]);
    const names = await staffNames(tx, changes.flatMap(change => [change.submittedBy, change.reviewerId]));
    return {
      student: { id: student.id, login: student.login, name: student.name, disabled: student.disabled, profile: student.studentProfile ? { college: student.studentProfile.college, major: student.studentProfile.major, className: student.studentProfile.className } : null },
      nodes: nodes.map(node => {
        const input = inputs.find(row => row.nodeId === node.id);
        const active = changes.find(change => change.nodeId === node.id && (inputPendingStatuses as readonly string[]).includes(change.status));
        return {
          id: node.id, name: node.name, minimum: node.minimum, maximum: node.maximum, required: node.required,
          input: input ? { id: input.id, value: input.value.toFixed(), revision: input.revision, updatedAt: input.updatedAt } : null,
          change: active ? { id: active.id, value: active.value.toFixed(), reason: active.reason, status: active.status, revision: active.revision, submittedBy: active.submittedBy, submittedAt: active.submittedAt, reviewReason: active.reviewReason } : null,
        };
      }),
      changes: changes.map(change => ({
        id: change.id, nodeId: change.nodeId, nodeName: nodes.find(node => node.id === change.nodeId)?.name ?? change.nodeId,
        value: change.value.toFixed(), baseValue: change.baseValue?.toFixed() ?? null, reason: change.reason, status: change.status,
        submittedBy: names.get(change.submittedBy) ?? null, submittedAt: change.submittedAt,
        reviewer: change.reviewerId ? names.get(change.reviewerId) ?? null : null, reviewedAt: change.reviewedAt, reviewReason: change.reviewReason,
      })),
      canSubmit: actor.role === "COUNSELOR", canReview: actor.role === "COLLEGE", canCorrect: actor.role === "ADMIN",
      phase: term.phase, disposition: term.disposition,
    };
  }, "read");
}

export async function readGradeQueue(sessionId: string, termId: string, input: unknown) {
  const query = z.object({ status: inputChangeFilter.default("PENDING"), page: z.coerce.number().int().min(1).max(100000).default(1) }).parse(input);
  return termTransaction(sessionId, termId, ["ADMIN", "COLLEGE", "COUNSELOR"], allPhases, async (tx, term, actorId) => {
    const actor = await actorOf(tx, actorId);
    const scope: Prisma.GradeChangeWhereInput =
      actor.role === "COLLEGE"
        ? { studentId: { in: await scopedStudentIds(tx, actor) } }
        : actor.role === "COUNSELOR"
          ? { submittedBy: actorId }
          : {};
    const where: Prisma.GradeChangeWhereInput = {
      termId, ...scope,
      ...(query.status === "PENDING" ? { status: { in: [...inputPendingStatuses] } } : { status: query.status }),
    };
    const [rows, total, pending, returned] = await Promise.all([
      tx.gradeChange.findMany({ where, orderBy: [{ submittedAt: "asc" }, { id: "asc" }], take: 20, skip: (query.page - 1) * 20 }),
      tx.gradeChange.count({ where }),
      tx.gradeChange.count({ where: { termId, ...scope, status: "PENDING_COLLEGE" } }),
      tx.gradeChange.count({ where: { termId, ...scope, status: "RETURNED" } }),
    ]);
    const nodes = gradeNodes(term);
    const [students, names] = await Promise.all([
      tx.user.findMany({ where: { id: { in: [...new Set(rows.map(row => row.studentId))] } }, select: { id: true, login: true, name: true, studentProfile: { select: { className: true, college: true } } } }),
      staffNames(tx, rows.flatMap(row => [row.submittedBy, row.reviewerId])),
    ]);
    const known = new Map(students.map(student => [student.id, student]));
    return {
      items: rows.map(row => {
        const student = known.get(row.studentId);
        return {
          id: row.id, studentId: row.studentId, studentName: student?.name ?? "学生档案不可用", login: student?.login ?? "",
          className: student?.studentProfile?.className ?? "", college: student?.studentProfile?.college ?? "",
          nodeId: row.nodeId, nodeName: nodes.find(node => node.id === row.nodeId)?.name ?? row.nodeId,
          value: row.value.toFixed(), baseValue: row.baseValue?.toFixed() ?? null, reason: row.reason, status: row.status,
          submitter: names.get(row.submittedBy) ?? null, submittedAt: row.submittedAt,
          reviewer: row.reviewerId ? names.get(row.reviewerId) ?? null : null, reviewedAt: row.reviewedAt, reviewReason: row.reviewReason,
          revision: row.revision, canDecide: row.status === "PENDING_COLLEGE" && actor.role === "COLLEGE",
          canRevise: row.status === "RETURNED" && actor.role === "COUNSELOR" && row.submittedBy === actorId,
        };
      }),
      total, page: query.page, status: query.status,
      stats: { pending, returned },
      role: actor.role,
    };
  }, "read");
}
