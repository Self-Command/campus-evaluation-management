import { z } from "zod";
import { db } from "@/server/db";
import { AccountError } from "@/server/accounts";
import { getCurrentSession } from "@/server/auth";
import { termTransaction } from "@/server/terms";
import { appendHistory, historyEntry, jsonValue, ownEvidence, reviewStatusSchema } from "@/server/claims";
import { assertActivityOwner, eligible } from "@/server/activity-policy";
import { registerFact } from "@/server/activity-participants";
import { activityView } from "@/server/activities";
export async function submitParticipation(sessionId: string, termId: string, input: unknown) {
  const data = z.object({ activityId: z.string(), studentId: z.string().optional(), studentLogin: z.string().max(64).optional(), note: z.string().trim().min(1).max(2000), evidenceIds: z.array(z.string()).min(1).max(5) }).parse(input);
  return termTransaction(sessionId, termId, ["ADMIN", "PUBLISHER", "STUDENT"], ["ACTIVE"], async (tx, term, actorId) => {
    const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId } });
    const activity = await tx.activity.findUnique({ where: { id: data.activityId } });
    if (!activity || activity.termId !== term.id) throw new AccountError("活动不存在", 404);
    if (!activity.confirmed) throw new AccountError("活动分值尚未确认", 409);
    if (actor.role !== "STUDENT") assertActivityOwner(activity, actor);
    if (actor.role === "STUDENT" && ((data.studentId && data.studentId !== actorId) || (data.studentLogin && data.studentLogin !== actor.login))) throw new AccountError("只能提交本人参与", 403);
    if (actor.role !== "STUDENT" && !data.studentId && !data.studentLogin) throw new AccountError("请输入学生学号");
    const student = await tx.user.findUnique({ where: actor.role === "STUDENT" ? { id: actorId } : data.studentId ? { id: data.studentId } : { login: data.studentLogin! }, include: { studentProfile: true } });
    if (!student || student.role !== "STUDENT" || student.disabled || !student.studentProfile) throw new AccountError("学生账号或档案无效");
    if (!eligible(activity, student) || (actor.role === "STUDENT" && !activity.publishedAt)) throw new AccountError("不符合当前已发布活动的学院、班级和学生范围", 403);
    const ids = [...new Set(data.evidenceIds)];
    const evidence = await tx.evidence.findMany({ where: { id: { in: ids }, ownerId: actorId } });
    if (evidence.length !== ids.length) throw new AccountError("证明不存在或不属于当前提交者", 403);
    const participation = actor.role === "STUDENT" ? await tx.participation.upsert({ where: { activityId_studentId: { activityId: activity.id, studentId: student.id } }, create: { activityId: activity.id, studentId: student.id }, update: {} }) : await registerFact(tx, activity.id, student, actorId);
    const pending = await tx.recognitionSource.findFirst({ where: { participationId: participation.id, submitterId: actorId, status: "PENDING" } });
    if (pending) throw new AccountError("已有待审核提交，请先等待处理", 409);
    const source = await tx.recognitionSource.create({ data: { participationId: participation.id, submitterId: actorId, origin: actor.role === "STUDENT" ? "SELF" : "OWNER", note: data.note, history: jsonValue([historyEntry(actorId, "SUBMITTED", { note: data.note, evidenceIds: ids })]), evidence: { create: ids.map(evidenceId => ({ evidenceId })) } } });
    await tx.auditEvent.create({ data: { actorId, action: "PARTICIPATION_SUBMITTED", targetId: source.id, details: { termId, participationId: participation.id, evidenceCount: ids.length } } });
    return source;
  });
}
export async function reviewParticipation(sessionId: string, termId: string, input: unknown) {
  const data = z.object({ id: z.string(), revision: z.number().int().nonnegative(), status: z.enum(["APPROVED", "REJECTED", "NEEDS_CHANGES"]), reason: z.string().trim().min(2).max(1000) }).parse(input);
  return termTransaction(sessionId, termId, ["ADMIN"], ["ACTIVE"], async (tx, term, actorId) => {
    const source = await tx.recognitionSource.findUnique({ where: { id: data.id }, include: { participation: { include: { activity: true } } } });
    if (!source || source.participation.activity.termId !== term.id) throw new AccountError("认定记录不存在", 404);
    if (source.revision !== data.revision) throw new AccountError("认定记录已变化，请刷新", 409);
    if (source.status === data.status) return source;
    if (source.status !== "PENDING") throw new AccountError("仅待审核记录可审核；已通过记录请使用理由撤销", 409);
    if (!source.participation.activity.confirmed) throw new AccountError("活动尚未确认", 409);
    if (data.status === "APPROVED") {
      if (source.participation.activity.scoreMode === "INDIVIDUAL" && (!source.participation.registeredAt || source.participation.score === null)) throw new AccountError("请先由发布者登记参与并录入个人活动分数", 409);
      if (await tx.personalClaim.count({ where: { studentId: source.participation.studentId, activityId: source.participation.activityId, status: "APPROVED", project: { termId } } })) throw new AccountError("该学生已有同活动的个人申报通过，请先核对并撤销重复来源", 409);
    }
    const saved = await tx.recognitionSource.update({ where: { id: source.id }, data: { status: data.status, reviewReason: data.reason, reviewerId: actorId, reviewedAt: new Date(), revision: { increment: 1 }, history: appendHistory(source.history, historyEntry(actorId, "REVIEWED", { before: source.status, after: data.status, reason: data.reason })) } });
    await tx.participation.update({ where: { id: source.participationId }, data: { revision: { increment: 1 } } });
    await tx.term.update({ where: { id: termId }, data: { inputRevision: { increment: 1 } } });
    await tx.auditEvent.create({ data: { actorId, action: "PARTICIPATION_REVIEWED", targetId: source.id, details: { reason: data.reason, before: source.status, after: data.status, termId } } });
    return saved;
  });
}
export async function listRecognitions(sessionId: string, termId: string, page = 1) { return pageRecognitions(sessionId, termId, page); }
export async function pageRecognitions(sessionId: string, termId: string, page = 1, status?: string) {
  const current = await getCurrentSession(sessionId);
  if (!current || current.user.mustChangePassword) throw new AccountError("请重新登录", 401);
  const safePage = z.number().int().min(1).max(100000).parse(page);
  const parsed = reviewStatusSchema.optional().parse(status || undefined);
  const where = { ...(parsed ? { status: parsed } : {}), participation: { activity: { termId, ...(current.user.role === "PUBLISHER" ? { ownerId: current.userId } : {}) }, ...(current.user.role === "STUDENT" ? { studentId: current.userId } : {}) } };
  const [items, total] = await db.$transaction([db.recognitionSource.findMany({ where, include: { participation: { include: { activity: true } }, evidence: { select: { evidence: { select: { id: true, name: true } } } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 20, skip: (safePage - 1) * 20 }), db.recognitionSource.count({ where })]);
  const students = await db.user.findMany({ where: { id: { in: [...new Set(items.map(s => s.participation.studentId))] } }, select: { id: true, name: true, login: true } });
  return { items: items.map(s => ({ ...s, participation: { ...s.participation, activity: activityView(s.participation.activity, current.user.role), score: s.participation.score?.toFixed() ?? null }, student: students.find(u => u.id === s.participation.studentId) || null })), total, page: safePage };
}

export async function changeParticipation(sessionId: string, termId: string, input: unknown) {
  const data = z.object({ id: z.string(), revision: z.number().int().nonnegative(), action: z.enum(["withdraw", "resubmit", "revoke", "close"]), reason: z.string().trim().min(2).max(1000).optional(), note: z.string().trim().min(1).max(2000).optional(), evidenceIds: z.array(z.string()).min(1).max(5).optional() }).parse(input);
  return termTransaction(sessionId, termId, ["ADMIN", "PUBLISHER", "STUDENT"], ["ACTIVE"], async (tx, _term, actorId) => {
    const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId } });
    const source = await tx.recognitionSource.findUnique({ where: { id: data.id }, include: { participation: { include: { activity: true } } } });
    if (!source || source.participation.activity.termId !== termId) throw new AccountError("认定记录不存在", 404);
    if (source.revision !== data.revision) throw new AccountError("认定记录已变化，请刷新", 409);
    if (["revoke", "close"].includes(data.action) ? actor.role !== "ADMIN" : source.submitterId !== actorId) throw new AccountError("没有操作该记录的权限", 403);
    if (["withdraw", "resubmit"].includes(data.action)) {
      if (actor.role === "STUDENT") { if (source.participation.studentId !== actorId) throw new AccountError("只能维护本人参与材料", 403); }
      else assertActivityOwner(source.participation.activity, actor);
    }
    let status: "WITHDRAWN" | "PENDING" | "REVOKED" | "REJECTED";
    let ids: string[] = [];
    if (data.action === "close") { if (!["PENDING", "NEEDS_CHANGES"].includes(source.status) || !data.reason) throw new AccountError("仅待审或待补充记录可填写理由终结", 409); status = "REJECTED"; }
    else if (data.action === "withdraw") { if (!["PENDING", "NEEDS_CHANGES"].includes(source.status)) throw new AccountError("仅待审核或待补充记录可撤回", 409); status = "WITHDRAWN"; }
    else if (data.action === "resubmit") {
      const student = await tx.user.findUnique({ where: { id: source.participation.studentId }, include: { studentProfile: true } });
      if (!student || !eligible(source.participation.activity, student) || (actor.role === "STUDENT" && !source.participation.activity.publishedAt)) throw new AccountError("学生不符合当前活动范围，无法重新提交；可撤回或联系管理员终结", 403);
      if (!["REJECTED", "NEEDS_CHANGES", "WITHDRAWN"].includes(source.status)) throw new AccountError("当前记录不允许重新提交", 409);
      if (!data.note || !data.evidenceIds) throw new AccountError("请填写说明并选择证明");
      const otherPending = await tx.recognitionSource.count({ where: { participationId: source.participationId, submitterId: actorId, status: "PENDING", id: { not: source.id } } });
      if (otherPending) throw new AccountError("本人已有待审核提交", 409);
      ids = await ownEvidence(tx, actorId, data.evidenceIds); status = "PENDING";
    } else { if (source.status !== "APPROVED" || !data.reason) throw new AccountError("仅已通过记录可填写理由撤销", 409); status = "REVOKED"; }
    const saved = await tx.recognitionSource.update({ where: { id: source.id }, data: { status, revision: { increment: 1 }, ...(data.action === "resubmit" ? { note: data.note, reviewReason: null, reviewerId: null, reviewedAt: null } : {}), ...(["revoke", "close"].includes(data.action) ? { reviewReason: data.reason, reviewerId: actorId, reviewedAt: new Date() } : {}), history: appendHistory(source.history, historyEntry(actorId, data.action.toUpperCase(), { before: source.status, after: status, note: data.note, evidenceIds: ids, reason: data.reason })) } });
    if (ids.length) await tx.evidenceReference.createMany({ data: ids.map(evidenceId => ({ sourceId: source.id, evidenceId })), skipDuplicates: true });
    if (source.status === "APPROVED") await tx.term.update({ where: { id: termId }, data: { inputRevision: { increment: 1 } } });
    await tx.participation.update({ where: { id: source.participationId }, data: { revision: { increment: 1 } } });
    await tx.auditEvent.create({ data: { actorId, action: "PARTICIPATION_CHANGED", targetId: source.id, details: { termId, before: source.status, after: status, reason: data.reason ?? null } } });
    return saved;
  });
}
