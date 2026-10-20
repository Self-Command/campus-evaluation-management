import { z } from "zod";
import { db } from "@/server/db";
import { AccountError } from "@/server/accounts";
import { termTransaction } from "@/server/terms";
import { validateScheme } from "@/lib/scoring/validate";
import { decimalSchema } from "@/lib/scoring/types";
import { Rational } from "@/lib/scoring/rational";
import type { Activity, Prisma } from "@/generated/prisma/client";
import { activityAudience, assertActivityOwner, audienceFields, audienceSchema, audienceTokenState, emptyAudience, inspectAudience, normalizeAudience, studentFeedWhere } from "@/server/activity-policy";
import { verifyFlowToken } from "@/server/flow-token";
const phases = ["CONFIGURATION", "ACTIVE", "CHECKING", "LOCKED"] as const;
const activitySchema = z.object({ name: z.string().trim().min(1).max(120), organizer: z.string().trim().min(1).max(120), content: z.string().trim().min(1).max(5000), requirements: z.string().trim().max(2000), startsAt: z.iso.datetime(), endsAt: z.iso.datetime(), nodeId: z.string().min(1).max(100), points: decimalSchema, scoreMode: z.enum(["FIXED", "INDIVIDUAL"]).default("FIXED"), audience: audienceSchema.default(emptyAudience) });
type OwnParticipation = Prisma.ParticipationGetPayload<{ include: { sources: true } }>;
export function activityView(activity: Activity, role: string, ownParticipation?: OwnParticipation | null) {
  const { audienceColleges: _colleges, audienceClasses: _classes, audienceStudents: _students, ...safe } = activity;
  void _colleges; void _classes; void _students;
  return { ...safe, points: activity.points.toFixed(), audience: role === "STUDENT" ? null : activityAudience(activity), ownParticipation: ownParticipation ? { id: ownParticipation.id, registeredAt: ownParticipation.registeredAt, registrationSnapshot: ownParticipation.registrationSnapshot, score: ownParticipation.score?.toFixed() ?? null, revision: ownParticipation.revision, history: ownParticipation.history, sources: ownParticipation.sources.map(source => ({ id: source.id, status: source.status, reviewReason: source.reviewReason, history: source.history })) } : null };
}
export async function pageActivityFeed(sessionId: string, termId: string, query = "", page = 1) { return pageDirectory(sessionId, termId, query, page, true); }
export async function pageActivities(sessionId: string, termId: string, query = "", page = 1) { return pageDirectory(sessionId, termId, query, page, false); }
export async function listActivities(sessionId: string, termId: string, page = 1, query = "") { return pageActivities(sessionId, termId, query, page); }
async function pageDirectory(sessionId: string, termId: string, query: string, page: number, feed: boolean) {
  const safePage = z.number().int().min(1).max(100000).parse(page);
  return termTransaction(sessionId, termId, feed ? ["STUDENT"] : ["ADMIN", "PUBLISHER", "STUDENT"], [...phases], async (tx, _term, actorId) => {
    const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId }, include: { studentProfile: true } });
    const where: Prisma.ActivityWhereInput = { termId, ...(query ? { OR: [{ name: { contains: query.slice(0, 80), mode: "insensitive" } }, { organizer: { contains: query.slice(0, 80), mode: "insensitive" } }] } : {}), ...(actor.role === "PUBLISHER" ? { ownerId: actorId } : {}), ...(actor.role === "STUDENT" ? feed ? studentFeedWhere(actor) : { participations: { some: { studentId: actorId, registeredAt: { not: null } } } } : {}) };
    const [items, total] = await Promise.all([tx.activity.findMany({ where, orderBy: [{ startsAt: "desc" }, { id: "desc" }], take: 20, skip: (safePage - 1) * 20 }), tx.activity.count({ where })]);
    const own = actor.role === "STUDENT" ? await tx.participation.findMany({ where: { activityId: { in: items.map(item => item.id) }, studentId: actorId, registeredAt: { not: null } }, include: { sources: true } }) : [];
    return { items: items.map(item => activityView(item, actor.role, own.find(fact => fact.activityId === item.id))), total, page: safePage };
  });
}
export async function getActivity(sessionId: string, id: string) {
  const found = await db.activity.findUnique({ where: { id }, select: { termId: true } });
  if (!found) throw new AccountError("活动不存在或无权查看", 404);
  return termTransaction(sessionId, found.termId, ["ADMIN", "PUBLISHER", "STUDENT"], [...phases], async (tx, _term, actorId) => {
    const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId }, include: { studentProfile: true } });
    const activity = await tx.activity.findUniqueOrThrow({ where: { id } });
    const own = actor.role === "STUDENT" ? await tx.participation.findUnique({ where: { activityId_studentId: { activityId: id, studentId: actorId } }, include: { sources: true } }) : null;
    const visible = actor.role !== "STUDENT" || !!own?.registeredAt || !!await tx.activity.findFirst({ where: { id, ...studentFeedWhere(actor) }, select: { id: true } });
    if (!visible || (actor.role === "PUBLISHER" && activity.ownerId !== actorId)) throw new AccountError("活动不存在或无权查看", 404);
    return { ...activityView(activity, actor.role, own?.registeredAt ? own : null), canSubmit: actor.role === "STUDENT" && !!await tx.activity.findFirst({ where: { id, ...studentFeedWhere(actor) }, select: { id: true } }) };
  });
}
export async function saveActivity(sessionId: string, termId: string, input: unknown) {
  const data = z.object({ id: z.string().optional(), revision: z.number().int().nonnegative().optional(), activity: activitySchema }).parse(input);
  const { audience: raw, ...fields } = data.activity, audience = normalizeAudience(raw);
  if (new Date(fields.endsAt) < new Date(fields.startsAt)) throw new AccountError("结束时间不能早于开始时间");
  if (Rational.from(fields.points).compare(Rational.from("0")) < 0) throw new AccountError("活动分值不能为负");
  return termTransaction(sessionId, termId, ["ADMIN", "PUBLISHER"], ["ACTIVE"], async (tx, term, actorId) => {
    if (validateScheme(term.scheme).nodes.get(fields.nodeId)?.kind !== "ACTIVITY") throw new AccountError("活动必须归属活动累加最底层模块");
    const previous = data.id ? await tx.activity.findUnique({ where: { id: data.id } }) : null;
    if (data.id && (!previous || previous.termId !== termId)) throw new AccountError("活动不存在", 404);
    const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId } });
    if (previous && actor.role !== "ADMIN" && previous.ownerId !== actorId) throw new AccountError("只能维护本人活动", 403);
    if (previous && previous.revision !== data.revision) throw new AccountError("活动已变化，请刷新", 409);
    if (previous?.confirmed && (previous.nodeId !== fields.nodeId || previous.scoreMode !== fields.scoreMode || !previous.points.equals(fields.points))) throw new AccountError("已确认分值变更须通过影响预览与统一更正", 409);
    const changed = previous && JSON.stringify(activityAudience(previous)) !== JSON.stringify(audience);
    const saved = previous ? await tx.activity.update({ where: { id: previous.id }, data: { ...fields, ...audienceFields(audience), ...(changed ? { publishedAt: null, ...(previous.publishedAt ? { publishRevision: { increment: 1 } } : {}) } : {}), revision: { increment: 1 } } }) : await tx.activity.create({ data: { ...fields, ...audienceFields(audience), termId, ownerId: actorId } });
    await tx.auditEvent.create({ data: { actorId, action: previous ? "ACTIVITY_UPDATED" : "ACTIVITY_CREATED", targetId: saved.id, details: { termId, revision: saved.revision, scopeChanged: !!changed, publicationWithdrawn: !!changed && !!previous?.publishedAt, ...(changed ? { beforeAudience: activityAudience(previous), afterAudience: audience, publishRevision: saved.publishRevision } : {}) } } });
    return activityView(saved, actor.role);
  });
}
export async function confirmActivity(sessionId: string, termId: string, input: unknown) {
  const data = z.object({ id: z.string(), revision: z.number().int().nonnegative() }).parse(input);
  return termTransaction(sessionId, termId, ["ADMIN"], ["ACTIVE"], async (tx, term, actorId) => {
    const activity = await tx.activity.findUnique({ where: { id: data.id } });
    if (!activity || activity.termId !== termId) throw new AccountError("活动不存在", 404);
    if (activity.revision !== data.revision) throw new AccountError("活动已变化，请刷新", 409);
    if (activity.confirmed) return activityView(activity, "ADMIN");
    if (validateScheme(term.scheme).nodes.get(activity.nodeId)?.kind !== "ACTIVITY") throw new AccountError("活动归属已失效", 409);
    const saved = await tx.activity.update({ where: { id: data.id }, data: { confirmed: true, revision: { increment: 1 } } });
    await tx.auditEvent.create({ data: { actorId, action: "ACTIVITY_CONFIRMED", targetId: saved.id, details: { termId, nodeId: saved.nodeId, points: saved.points.toFixed() } } });
    return activityView(saved, "ADMIN");
  });
}
export async function publishActivity(sessionId: string, termId: string, input: unknown) {
  const data = z.object({ id: z.string(), revision: z.number().int().nonnegative(), action: z.enum(["publish", "unpublish"]), token: z.string().max(4000).optional(), reason: z.string().trim().min(2).max(1000).optional() }).parse(input);
  return termTransaction(sessionId, termId, ["ADMIN", "PUBLISHER"], ["ACTIVE"], async (tx, _term, actorId) => {
    const activity = await tx.activity.findUnique({ where: { id: data.id } });
    if (!activity || activity.termId !== termId) throw new AccountError("活动不存在", 404);
    const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId } });
    assertActivityOwner(activity, actor);
    if (activity.revision !== data.revision) throw new AccountError("活动已变化，请重新核对", 409);
    if (data.action === "publish") {
      if (!activity.confirmed) throw new AccountError("请先由管理员确认活动分值", 409);
      const inspected = await inspectAudience(tx, activityAudience(activity));
      if (inspected.errors.length) throw new AccountError(inspected.errors.join("；"), 409);
      verifyFlowToken(data.token ?? "", actorId, "ACTIVITY_AUDIENCE", audienceTokenState(inspected));
    } else if (!data.reason) throw new AccountError("请填写撤回发布的理由");
    const saved = await tx.activity.update({ where: { id: activity.id }, data: { publishedAt: data.action === "publish" ? new Date() : null, publishRevision: { increment: 1 }, revision: { increment: 1 } } });
    await tx.auditEvent.create({ data: { actorId, action: data.action === "publish" ? "ACTIVITY_PUBLISHED" : "ACTIVITY_UNPUBLISHED", targetId: activity.id, details: { termId, publishRevision: saved.publishRevision, audience: activityAudience(activity), reason: data.reason ?? null } } });
    return activityView(saved, actor.role);
  });
}

