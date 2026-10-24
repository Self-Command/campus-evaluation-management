import { z } from "zod";
import { AccountError } from "@/server/accounts";
import { termTransaction } from "@/server/terms";
import { validateScheme } from "@/lib/scoring/validate";
import { decimalSchema } from "@/lib/scoring/types";
import { Rational } from "@/lib/scoring/rational";
import type { Prisma } from "@/generated/prisma/client";
import { recordAudit } from "@/server/audit";

export const claimStatusSchema = z.enum(["PENDING_COUNSELOR", "PENDING_COLLEGE", "RETURNED", "RESCORING", "APPROVED", "ABANDONED", "REVOKED", "REJECTED"]);
export const claimFilterSchema = z.enum(["PENDING", ...claimStatusSchema.options]);
export const claimPendingStatuses = ["PENDING_COUNSELOR", "PENDING_COLLEGE", "RESCORING"] as const;
export const claimAttentionStatuses = ["RETURNED", "REJECTED"] as const;
export const jsonValue = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
export const historyEntry = (actorId: string, action: string, details: Record<string, unknown> = {}) => ({ actorId, action, at: new Date().toISOString(), ...details });
export function appendHistory(previous: Prisma.JsonValue, entry: unknown) { return jsonValue([...(Array.isArray(previous) ? previous : []), entry]); }
export async function ownEvidence(tx: Prisma.TransactionClient, actorId: string, raw: string[]) {
  const ids = [...new Set(raw)];
  if (await tx.evidence.count({ where: { id: { in: ids }, ownerId: actorId } }) !== ids.length) throw new AccountError("证明不存在或不属于当前提交者", 403);
  return ids;
}

// The recognition project catalog is discontinued: personal claims are submitted
// directly by students. Reads remain for historical explanation, writes are refused.
export async function saveProject(...args: [string, string, unknown]): Promise<never> {
  void args;
  throw new AccountError("认定项目目录已取消，个人申报由学生直接提交，不再配置申报项目", 403);
}
export async function listProjects(sessionId: string, termId: string) {
  return termTransaction(sessionId, termId, ["ADMIN", "COLLEGE", "COUNSELOR"], ["CONFIGURATION", "ACTIVE", "CHECKING", "LOCKED"], async (tx) => {
    return tx.recognitionProject.findMany({ where: { termId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 500 });
  }, "read");
}

const claimSchema = z.object({
  title: z.string().trim().min(1).max(120),
  occurredOn: z.iso.date(),
  note: z.string().trim().min(2).max(2000),
  evidenceIds: z.array(z.string().min(1)).min(1).max(5),
}).strict();
// The HTTP envelope carries termId for routing; strict schemas below must keep
// rejecting forged fields (projectId/activityId/factKey/points/score).
function claimPayload(input: unknown) {
  const parsed = z.record(z.string(), z.unknown()).parse(input);
  delete parsed.termId;
  return parsed;
}

export async function submitClaim(sessionId: string, termId: string, input: unknown) {
  const data = claimSchema.parse(claimPayload(input));
  if (data.occurredOn > new Date().toISOString().slice(0, 10)) throw new AccountError("发生日期不能晚于今天");
  return termTransaction(sessionId, termId, ["STUDENT"], ["ACTIVE"], async (tx, _term, actorId) => {
    const student = await tx.user.findUniqueOrThrow({ where: { id: actorId }, include: { studentProfile: { include: { schoolClass: true } } } });
    const schoolClass = student.studentProfile?.schoolClass;
    if (!student.studentProfile || !schoolClass) throw new AccountError("归属待完善，请先联系管理员配置班级后再申报", 409);
    if (!schoolClass.enabled) throw new AccountError("所在班级已停用，请联系管理员更新归属后再申报", 409);
    if (!schoolClass.counselorId) throw new AccountError("所在班级尚未配置责任辅导员，请联系管理员后再申报", 409);
    const ids = await ownEvidence(tx, actorId, data.evidenceIds);
    const claim = await tx.personalClaim.create({ data: { termId, studentId: actorId, title: data.title, occurredOn: data.occurredOn, note: data.note, history: jsonValue([historyEntry(actorId, "SUBMITTED", { title: data.title, occurredOn: data.occurredOn, note: data.note, evidenceIds: ids })]), evidence: { create: ids.map(evidenceId => ({ evidenceId })) } } });
    await recordAudit(tx, { actorId, action: "CLAIM_SUBMITTED", targetId: claim.id, details: { termId } });
    return claim;
  });
}

async function reviewScope(tx: Prisma.TransactionClient, actor: { id: string; role: string; collegeId: string | null }, studentId: string) {
  const student = await tx.user.findUnique({ where: { id: studentId }, include: { studentProfile: { include: { schoolClass: { include: { major: { include: { college: true } } } } } } } });
  const schoolClass = student?.studentProfile?.schoolClass;
  if (!student || !schoolClass || !schoolClass.enabled || !schoolClass.major.enabled || !schoolClass.major.college.enabled) throw new AccountError("申报不存在或无权查看", 404);
  if (actor.role === "COUNSELOR" && schoolClass.counselorId !== actor.id) throw new AccountError("只能处理本人负责班级学生的申报", 403);
  if (actor.role === "COLLEGE" && schoolClass.major.collegeId !== actor.collegeId) throw new AccountError("只能处理本院学生的申报", 403);
  return student;
}

const changeSchema = z.object({
  revision: z.number().int().nonnegative(),
  action: z.enum(["resubmit", "abandon", "submitScore", "return", "approve", "rescore", "revoke"]),
  reason: z.string().trim().min(2).max(1000).optional(),
  title: z.string().trim().min(1).max(120).optional(),
  occurredOn: z.iso.date().optional(),
  note: z.string().trim().min(2).max(2000).optional(),
  evidenceIds: z.array(z.string().min(1)).min(1).max(5).optional(),
  nodeId: z.string().min(1).max(100).optional(),
  score: decimalSchema.optional(),
}).strict();

export async function changeClaim(sessionId: string, termId: string, id: string, input: unknown) {
  const data = changeSchema.parse(claimPayload(input));
  return termTransaction(sessionId, termId, ["ADMIN", "STUDENT", "COUNSELOR", "COLLEGE"], ["ACTIVE"], async (tx, term, actorId) => {
    const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId } });
    const claim = await tx.personalClaim.findUnique({ where: { id }, include: { project: true } });
    if (!claim || claim.termId !== termId) throw new AccountError("申报不存在或无权查看", 404);
    if (actor.role === "STUDENT" && claim.studentId !== actorId) throw new AccountError("申报不存在或无权查看", 404);
    if (actor.role === "COUNSELOR" || actor.role === "COLLEGE") await reviewScope(tx, actor, claim.studentId);
    if (claim.revision !== data.revision) throw new AccountError("申报已变化，请刷新", 409);
    const status = claim.status;
    let next = status;
    let ids: string[] = [];
    const fields: Prisma.PersonalClaimUpdateInput = {};
    if (data.action === "abandon") {
      if (actor.role !== "STUDENT" || claim.studentId !== actorId) throw new AccountError("只能放弃本人申报", 403);
      if (!["PENDING_COUNSELOR", "RETURNED"].includes(status)) throw new AccountError("仅待辅导员或退回修改中的申报可放弃", 409);
      next = "ABANDONED";
    } else if (data.action === "resubmit") {
      if (actor.role !== "STUDENT" || claim.studentId !== actorId) throw new AccountError("只能由当前学生账号修改本人申报", 403);
      if (status !== "RETURNED") throw new AccountError("仅退回修改中的申报可重新提交", 409);
      if (!data.title || !data.occurredOn || !data.note || !data.evidenceIds) throw new AccountError("请完整填写标题、发生日期、说明并选择1至5份证明");
      if (data.occurredOn > new Date().toISOString().slice(0, 10)) throw new AccountError("发生日期不能晚于今天");
      const student = await tx.user.findUniqueOrThrow({ where: { id: actorId }, include: { studentProfile: { include: { schoolClass: true } } } });
      const schoolClass = student.studentProfile?.schoolClass;
      if (!schoolClass || !schoolClass.enabled || !schoolClass.counselorId) throw new AccountError("归属或责任辅导员已变化，请联系管理员确认后再提交", 409);
      ids = await ownEvidence(tx, actorId, data.evidenceIds);
      fields.title = data.title; fields.occurredOn = data.occurredOn; fields.note = data.note;
      // A new revision restarts the full review chain: the previous score stays in
      // history only and must be re-entered or confirmed by the counselor.
      fields.score = null; fields.scoreNodeId = null; fields.scorerId = null; fields.scoredAt = null;
      fields.reviewReason = null; fields.reviewerId = null; fields.reviewedAt = null;
      next = "PENDING_COUNSELOR";
    } else if (data.action === "submitScore") {
      if (actor.role !== "COUNSELOR") throw new AccountError("没有初审评分权限", 403);
      if (!["PENDING_COUNSELOR", "RESCORING"].includes(status)) throw new AccountError("仅待辅导员或待重评的申报可评分提交", 409);
      if (!data.nodeId || data.score === undefined) throw new AccountError("请选择计分模块并填写本次申报分数后再提交学院");
      const node = validateScheme(term.scheme).nodes.get(data.nodeId);
      if (!node || node.kind !== "ACTIVITY") throw new AccountError("计分模块必须是可计分的最底层模块", 409);
      const value = Rational.from(data.score);
      if (value.compare(Rational.from(node.minimum)) < 0 || value.compare(Rational.from(node.maximum)) > 0) throw new AccountError(`分数须在该模块输入范围 ${node.minimum} 至 ${node.maximum} 内`);
      fields.scoreNodeId = data.nodeId; fields.score = data.score; fields.scorerId = actorId; fields.scoredAt = new Date();
      fields.reviewReason = null; fields.reviewerId = null; fields.reviewedAt = null;
      next = "PENDING_COLLEGE";
    } else if (data.action === "return") {
      if (!data.reason) throw new AccountError("请填写退回修改理由");
      if (actor.role === "COUNSELOR") {
        if (status !== "PENDING_COUNSELOR") throw new AccountError("仅待辅导员的申报可退回修改", 409);
      } else if (actor.role === "COLLEGE") {
        if (status !== "PENDING_COLLEGE") throw new AccountError("仅待学院的申报可退回修改", 409);
      } else throw new AccountError("没有退回权限", 403);
      fields.reviewReason = data.reason; fields.reviewerId = actorId; fields.reviewedAt = new Date();
      next = "RETURNED";
    } else if (data.action === "approve") {
      if (actor.role !== "COLLEGE") throw new AccountError("没有终审权限", 403);
      if (status !== "PENDING_COLLEGE") throw new AccountError("仅待学院的申报可终审", 409);
      if (claim.score === null || !claim.scoreNodeId) throw new AccountError("缺少辅导员评分，不能终审通过", 409);
      if (claim.activityId) {
        const fact = await tx.participation.findUnique({ where: { activityId_studentId: { activityId: claim.activityId, studentId: claim.studentId } }, include: { sources: { where: { status: "APPROVED" }, select: { id: true } } } });
        if (fact?.sources.length || await tx.personalClaim.count({ where: { id: { not: claim.id }, activityId: claim.activityId, studentId: claim.studentId, status: "APPROVED", termId } })) throw new AccountError("同活动已有有效认定或已通过申报，请先核对并撤销重复来源", 409);
      }
      fields.reviewReason = data.reason ?? null; fields.reviewerId = actorId; fields.reviewedAt = new Date();
      next = "APPROVED";
    } else if (data.action === "rescore") {
      if (actor.role !== "COLLEGE") throw new AccountError("没有终审权限", 403);
      if (status !== "PENDING_COLLEGE") throw new AccountError("仅待学院的申报可退回重评", 409);
      if (!data.reason) throw new AccountError("请填写评分问题理由");
      fields.reviewReason = data.reason; fields.reviewerId = actorId; fields.reviewedAt = new Date();
      next = "RESCORING";
    } else if (data.action === "revoke") {
      if (actor.role !== "ADMIN") throw new AccountError("没有受控撤销权限", 403);
      if (status !== "APPROVED") throw new AccountError("仅已通过申报可撤销", 409);
      if (!data.reason) throw new AccountError("请填写撤销理由");
      fields.reviewReason = data.reason; fields.reviewerId = actorId; fields.reviewedAt = new Date();
      next = "REVOKED";
    }
    const updated = await tx.personalClaim.update({ where: { id }, data: { ...fields, status: next, revision: { increment: 1 }, history: appendHistory(claim.history, historyEntry(actorId, data.action.toUpperCase(), { before: status, after: next, reason: data.reason, note: data.note, evidenceIds: ids, nodeId: data.nodeId, score: data.score })) } });
    if (ids.length) await tx.claimEvidence.createMany({ data: ids.map(evidenceId => ({ claimId: id, evidenceId })), skipDuplicates: true });
    if ((status === "APPROVED") !== (next === "APPROVED")) await tx.term.update({ where: { id: termId }, data: { inputRevision: { increment: 1 } } });
    await recordAudit(tx, { actorId, action: "CLAIM_CHANGED", targetId: id, details: { termId, action: data.action, before: status, after: next, reason: data.reason ?? null } });
    return updated;
  });
}

export async function pageClaims(sessionId: string, termId: string, page = 1, status?: string) {
  const safePage = z.number().int().min(1).max(100000).parse(page);
  const parsed = claimFilterSchema.optional().parse(status || undefined);
  return termTransaction(sessionId, termId, ["ADMIN", "STUDENT", "COUNSELOR", "COLLEGE"], ["CONFIGURATION", "ACTIVE", "CHECKING", "LOCKED"], async (tx, _term, actorId) => {
    const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId } });
    const where: Prisma.PersonalClaimWhereInput = { termId, ...(parsed ? { status: parsed === "PENDING" ? { in: [...claimPendingStatuses] } : parsed } : {}) };
    if (actor.role === "STUDENT") where.studentId = actorId;
    else if (actor.role === "COUNSELOR" || actor.role === "COLLEGE") {
      if (actor.role === "COLLEGE" && !actor.collegeId) where.studentId = { in: [] };
      else {
        const classScope = actor.role === "COUNSELOR"
          ? { enabled: true, counselorId: actorId, major: { is: { enabled: true, college: { is: { enabled: true } } } } }
          : { enabled: true, major: { is: { enabled: true, collegeId: actor.collegeId!, college: { is: { enabled: true } } } } };
        const scoped = await tx.user.findMany({ where: { role: "STUDENT", studentProfile: { is: { schoolClass: { is: classScope } } } }, select: { id: true } });
        where.studentId = { in: scoped.map(s => s.id) };
      }
    }
    const items = await tx.personalClaim.findMany({ where, include: { project: true, evidence: { select: { evidence: { select: { id: true, name: true } } } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 20, skip: (safePage - 1) * 20 });
    const students = await tx.user.findMany({ where: { id: { in: items.map(i => i.studentId) } }, select: { id: true, name: true, login: true, studentProfile: { select: { studentNumber: true, className: true, schoolClass: { select: { name: true, major: { select: { name: true, college: { select: { name: true } } } } } } } } } });
    const staffIds = [...new Set(items.flatMap(i => [i.scorerId, i.reviewerId]).filter((v): v is string => !!v))];
    const staff = await tx.user.findMany({ where: { id: { in: staffIds } }, select: { id: true, name: true } });
    return {
      items: items.map(i => ({ ...i, evidence: i.evidence.map(e => e.evidence), student: students.find(s => s.id === i.studentId) ?? null, scorer: staff.find(s => s.id === i.scorerId) ?? null, reviewer: staff.find(s => s.id === i.reviewerId) ?? null })),
      total: await tx.personalClaim.count({ where }), page: safePage,
    };
  }, "read");
}
