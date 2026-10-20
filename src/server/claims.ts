import { z } from "zod";
import { AccountError } from "@/server/accounts";
import { termTransaction } from "@/server/terms";
import { validateScheme } from "@/lib/scoring/validate";
import { decimalSchema } from "@/lib/scoring/types";
import { Rational } from "@/lib/scoring/rational";
import type { Prisma } from "@/generated/prisma/client";
import { studentFeedWhere } from "@/server/activity-policy";

export const reviewStatusSchema = z.enum(["PENDING", "APPROVED", "REJECTED", "NEEDS_CHANGES", "WITHDRAWN", "REVOKED"]);
export const jsonValue = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
export const historyEntry = (actorId: string, action: string, details: Record<string, unknown> = {}) => ({ actorId, action, at: new Date().toISOString(), ...details });
export function appendHistory(previous: Prisma.JsonValue, entry: unknown) { return jsonValue([...(Array.isArray(previous) ? previous : []), entry]); }
export async function ownEvidence(tx: Prisma.TransactionClient, actorId: string, raw: string[]) {
  const ids = [...new Set(raw)];
  if (await tx.evidence.count({ where: { id: { in: ids }, ownerId: actorId } }) !== ids.length) throw new AccountError("证明不存在或不属于当前提交者", 403);
  return ids;
}
const projectSchema = z.object({ id: z.string().optional(), revision: z.number().int().nonnegative().optional(), name: z.string().trim().min(1).max(120), description: z.string().trim().min(2).max(3000), nodeId: z.string().min(1).max(100), points: decimalSchema, enabled: z.boolean() });
export async function saveProject(sessionId: string, termId: string, input: unknown) {
  const data = projectSchema.parse(input);
  if (Rational.from(data.points).compare(Rational.from("0")) < 0) throw new AccountError("项目分值不能为负");
  return termTransaction(sessionId, termId, ["ADMIN"], ["ACTIVE"], async (tx, term, actorId) => {
    if (validateScheme(term.scheme).nodes.get(data.nodeId)?.kind !== "ACTIVITY") throw new AccountError("项目必须归属活动累加最底层模块");
    const previous = data.id ? await tx.recognitionProject.findUnique({ where: { id: data.id }, include: { _count: { select: { claims: true } } } }) : null;
    if (data.id && (!previous || previous.termId !== termId)) throw new AccountError("申报项目不存在", 404);
    if (!previous && await tx.recognitionProject.count({ where: { termId } }) >= 500) throw new AccountError("每周期最多500个申报项目，请停用或复用已有项目", 409);
    if (previous && previous.revision !== data.revision) throw new AccountError("项目已变化，请刷新", 409);
    if (previous?._count.claims && (previous.nodeId !== data.nodeId || !previous.points.equals(data.points))) throw new AccountError("已有申报的项目不可直接修改分值或归属，请建立新项目", 409);
    const fields = { name: data.name, description: data.description, nodeId: data.nodeId, points: data.points, enabled: data.enabled };
    const project = previous ? await tx.recognitionProject.update({ where: { id: previous.id }, data: { ...fields, revision: { increment: 1 } } }) : await tx.recognitionProject.create({ data: { ...fields, termId } });
    await tx.auditEvent.create({ data: { actorId, action: previous ? "PROJECT_UPDATED" : "PROJECT_CREATED", targetId: project.id, details: { termId, revision: project.revision } } });
    return project;
  });
}
export async function listProjects(sessionId: string, termId: string) {
  return termTransaction(sessionId, termId, ["ADMIN", "PUBLISHER", "STUDENT"], ["CONFIGURATION", "ACTIVE", "CHECKING", "LOCKED"], async (tx, _term, actorId) => {
    const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId } });
    return tx.recognitionProject.findMany({ where: { termId, ...(actor.role !== "ADMIN" ? { enabled: true } : {}) }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 500 });
  });
}
const claimSchema = z.object({ projectId: z.string(), activityId: z.string().max(100).optional(), factKey: z.string().trim().min(1).max(120).transform(v => v.normalize("NFKC").toLocaleLowerCase()), occurredOn: z.iso.date(), note: z.string().trim().min(2).max(2000), evidenceIds: z.array(z.string().min(1)).min(1).max(5) });
export async function submitClaim(sessionId: string, termId: string, input: unknown) {
  const data = claimSchema.parse(input);
  if (data.occurredOn > new Date().toISOString().slice(0, 10)) throw new AccountError("发生日期不能晚于今天");
  return termTransaction(sessionId, termId, ["STUDENT"], ["ACTIVE"], async (tx, _term, actorId) => {
    const student = await tx.user.findUniqueOrThrow({ where: { id: actorId }, include: { studentProfile: true } });
    if (!student.studentProfile) throw new AccountError("学生档案不完整，请联系管理员", 409);
    const project = await tx.recognitionProject.findUnique({ where: { id: data.projectId } });
    if (!project || project.termId !== termId || !project.enabled) throw new AccountError("申报项目不存在或已停用", 409);
    if (data.activityId && !await tx.activity.findFirst({ where: { id: data.activityId, termId, OR: [studentFeedWhere(student), { participations: { some: { studentId: actorId, registeredAt: { not: null } } } }] }, select: { id: true } })) throw new AccountError("关联活动不存在或不属于本人可见范围", 403);
    if (await tx.personalClaim.findFirst({ where: { studentId: actorId, factKey: data.factKey, project: { termId } } })) throw new AccountError("本周期已有相同事实标识的申报，请查看原记录", 409);
    const ids = await ownEvidence(tx, actorId, data.evidenceIds);
    const claim = await tx.personalClaim.create({ data: { projectId: project.id, studentId: actorId, activityId: data.activityId || null, factKey: data.factKey, occurredOn: data.occurredOn, note: data.note, history: jsonValue([historyEntry(actorId, "SUBMITTED", { note: data.note, evidenceIds: ids, activityId: data.activityId || null })]), evidence: { create: ids.map(evidenceId => ({ evidenceId })) } } });
    await tx.auditEvent.create({ data: { actorId, action: "CLAIM_SUBMITTED", targetId: claim.id, details: { termId, projectId: project.id } } });
    return claim;
  });
}
const changeSchema = z.object({ revision: z.number().int().nonnegative(), action: z.enum(["withdraw", "resubmit", "review", "revoke", "close"]), status: z.enum(["APPROVED", "REJECTED", "NEEDS_CHANGES"]).optional(), reason: z.string().trim().min(2).max(1000).optional(), note: z.string().trim().min(2).max(2000).optional(), evidenceIds: z.array(z.string().min(1)).min(1).max(5).optional() });
export async function changeClaim(sessionId: string, termId: string, id: string, input: unknown) {
  const data = changeSchema.parse(input);
  return termTransaction(sessionId, termId, ["ADMIN", "STUDENT"], ["ACTIVE"], async (tx, _term, actorId) => {
    const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId } });
    const claim = await tx.personalClaim.findUnique({ where: { id }, include: { project: true } });
    if (!claim || claim.project.termId !== termId || (actor.role !== "ADMIN" && claim.studentId !== actorId)) throw new AccountError("申报不存在或无权查看", 404);
    if (claim.revision !== data.revision) throw new AccountError("申报已变化，请刷新", 409);
    let status = claim.status;
    let ids: string[] = [];
    if (data.action === "withdraw") {
      if (actorId !== claim.studentId) throw new AccountError("只能撤回本人申报", 403);
      if (!["PENDING", "NEEDS_CHANGES"].includes(status)) throw new AccountError("仅待审核或待补充申报可撤回", 409);
      status = "WITHDRAWN";
    } else if (data.action === "resubmit") {
      if (actor.role !== "STUDENT" || actorId !== claim.studentId) throw new AccountError("只能由当前学生账号补充本人申报", 403);
      if (!["REJECTED", "NEEDS_CHANGES", "WITHDRAWN"].includes(status)) throw new AccountError("当前申报不允许重新提交", 409);
      if (!claim.project.enabled) throw new AccountError("申报项目已停用", 409);
      if (!data.note || !data.evidenceIds) throw new AccountError("请填写说明并选择1至5份证明");
      ids = await ownEvidence(tx, actorId, data.evidenceIds); status = "PENDING";
    } else {
      if (actor.role !== "ADMIN") throw new AccountError("没有审核权限", 403);
      if (!data.reason) throw new AccountError("请填写处理理由");
      if (data.action === "close") {
        if (!["PENDING", "NEEDS_CHANGES"].includes(status)) throw new AccountError("仅待审或待补充申报可终结", 409);
        status = "REJECTED";
      } else if (data.action === "revoke") {
        if (status !== "APPROVED") throw new AccountError("仅已通过申报可撤销", 409);
        status = "REVOKED";
      } else {
        if (status !== "PENDING" || !data.status) throw new AccountError("仅待审核申报可审核", 409);
        if (data.status === "APPROVED" && claim.activityId) {
          const fact = await tx.participation.findUnique({ where: { activityId_studentId: { activityId: claim.activityId, studentId: claim.studentId } }, include: { sources: { where: { status: "APPROVED" }, select: { id: true } } } });
          if (fact?.sources.length || await tx.personalClaim.count({ where: { id: { not: claim.id }, activityId: claim.activityId, studentId: claim.studentId, status: "APPROVED", project: { termId } } })) throw new AccountError("同活动已有有效认定或已通过申报，请先核对并撤销重复来源", 409);
        }
        status = data.status;
      }
    }
    const updated = await tx.personalClaim.update({ where: { id }, data: { status, revision: { increment: 1 }, ...(data.action === "resubmit" ? { note: data.note, reviewReason: null, reviewerId: null, reviewedAt: null } : {}), ...(["review", "revoke", "close"].includes(data.action) ? { reviewReason: data.reason, reviewerId: actorId, reviewedAt: new Date() } : {}), history: appendHistory(claim.history, historyEntry(actorId, data.action.toUpperCase(), { before: claim.status, after: status, reason: data.reason, note: data.note, evidenceIds: ids })) } });
    if (ids.length) await tx.claimEvidence.createMany({ data: ids.map(evidenceId => ({ claimId: id, evidenceId })), skipDuplicates: true });
    if ((claim.status === "APPROVED") !== (status === "APPROVED")) await tx.term.update({ where: { id: termId }, data: { inputRevision: { increment: 1 } } });
    await tx.auditEvent.create({ data: { actorId, action: "CLAIM_CHANGED", targetId: id, details: { termId, action: data.action, before: claim.status, after: status, reason: data.reason ?? null } } });
    return updated;
  });
}
export async function pageClaims(sessionId: string, termId: string, page = 1, status?: string) {
  const safePage = z.number().int().min(1).max(100000).parse(page);
  const parsed = reviewStatusSchema.optional().parse(status || undefined);
  return termTransaction(sessionId, termId, ["ADMIN", "STUDENT"], ["CONFIGURATION", "ACTIVE", "CHECKING", "LOCKED"], async (tx, _term, actorId) => {
    const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId } });
    const where = { project: { termId }, ...(actor.role === "STUDENT" ? { studentId: actorId } : {}), ...(parsed ? { status: parsed } : {}) };
    const items = await tx.personalClaim.findMany({ where, include: { project: true, evidence: { select: { evidence: { select: { id: true, name: true } } } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 20, skip: (safePage - 1) * 20 });
    const students = await tx.user.findMany({ where: { id: { in: items.map(i => i.studentId) } }, select: { id: true, name: true, login: true } });
    return { items: items.map(i => ({ ...i, evidence: i.evidence.map(e => e.evidence), student: students.find(s => s.id === i.studentId) ?? null })), total: await tx.personalClaim.count({ where }), page: safePage };
  });
}
