import { z } from "zod";
import { db } from "@/server/db";
import { AccountError } from "@/server/accounts";
import { termTransaction } from "@/server/terms";
import { validateScheme } from "@/lib/scoring/validate";
import { decimalSchema } from "@/lib/scoring/types";
import { Rational } from "@/lib/scoring/rational";
import type { Activity, Prisma } from "@/generated/prisma/client";
import { activityAudience, assertActivityManager, audienceFields, audienceSchema, audienceTokenState, canManageActivity, classKey, emptyAudience, inspectAudience, normalizeAudience, studentFeedWhere } from "@/server/activity-policy";
import { scopedStudentWhere } from "@/server/access-scope";
import { verifyFlowToken } from "@/server/flow-token";
const phases = ["CONFIGURATION", "ACTIVE", "CHECKING", "LOCKED"] as const;
const activitySchema = z.object({ name: z.string().trim().min(1).max(120), organizer: z.string().trim().min(1).max(120), content: z.string().trim().min(1).max(5000), requirements: z.string().trim().max(2000), startsAt: z.iso.datetime(), endsAt: z.iso.datetime(), nodeId: z.string().min(1).max(100), points: decimalSchema, scoreMode: z.enum(["FIXED", "INDIVIDUAL"]).default("FIXED"), audience: audienceSchema.default(emptyAudience), collegeId: z.string().min(1).max(100).optional() });
const ownEvidenceInclude = { sources: { include: { evidence: { select: { evidence: { select: { id: true, name: true, mime: true, size: true } } } } } } } as const;
const evidenceInclude = { evidence: { select: { id: true, name: true, mime: true, size: true, createdAt: true, ownerId: true } } } as const;
type OwnParticipation = Prisma.ParticipationGetPayload<{ include: typeof ownEvidenceInclude }>;
type EvidenceRow = Prisma.ActivityEvidenceGetPayload<{ include: typeof evidenceInclude }>;
export type ActivityViewOptions = { canManage?: boolean; college?: { id: string; name: string; code: string } | null; evidence?: EvidenceRow[]; includeEvidenceHistory?: boolean; canReview?: boolean };
export function activityView(activity: Activity, role: string, ownParticipation?: OwnParticipation | null, options: ActivityViewOptions = {}) {
  const { audienceColleges: _colleges, audienceClasses: _classes, audienceStudents: _students, ...safe } = activity;
  void _colleges; void _classes; void _students;
  const canManage = options.canManage ?? (role === "ADMIN" || role === "PUBLISHER");
  return {
    ...safe,
    points: activity.points.toFixed(),
    college: options.college ?? undefined,
    audience: canManage ? activityAudience(activity) : null,
    canManage,
    canReview: options.canReview ?? false,
    rosterCommitted: !!activity.rosterCommittedAt,
    evidence: (options.evidence ?? []).filter(row => options.includeEvidenceHistory || row.active).map(row => ({ id: row.id, version: row.version, active: row.active, uploadedBy: row.uploadedBy, note: row.note, createdAt: row.createdAt, evidence: row.evidence })),
    ownParticipation: ownParticipation ? { id: ownParticipation.id, registeredAt: ownParticipation.registeredAt, registrationSnapshot: ownParticipation.registrationSnapshot, score: ownParticipation.score?.toFixed() ?? null, removedAt: ownParticipation.removedAt, removalReason: ownParticipation.removalReason, revision: ownParticipation.revision, history: ownParticipation.history, sources: ownParticipation.sources.map(source => ({ id: source.id, status: source.status, reviewReason: source.reviewReason, history: source.history, evidence: source.evidence })) } : null,
  };
}
async function counselorClassKeys(tx: Prisma.TransactionClient, actorId: string) {
  const classes = await tx.schoolClass.findMany({ where: { counselorId: actorId }, select: { name: true, major: { select: { name: true, college: { select: { name: true } } } } } });
  return classes.map(schoolClass => classKey({ college: schoolClass.major.college.name, major: schoolClass.major.name, className: schoolClass.name }));
}
export async function pageActivityFeed(sessionId: string, termId: string, query = "", page = 1) { return pageDirectory(sessionId, termId, query, page, true); }
export async function pageActivities(sessionId: string, termId: string, query = "", page = 1) { return pageDirectory(sessionId, termId, query, page, false); }
export async function listActivities(sessionId: string, termId: string, page = 1, query = "") { return pageActivities(sessionId, termId, query, page); }
async function pageDirectory(sessionId: string, termId: string, query: string, page: number, feed: boolean) {
  const safePage = z.number().int().min(1).max(100000).parse(page);
  return termTransaction(sessionId, termId, feed ? ["STUDENT"] : ["ADMIN", "COLLEGE", "COUNSELOR", "PUBLISHER", "STUDENT"], [...phases], async (tx, _term, actorId) => {
    const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId }, include: { studentProfile: true, college: { select: { id: true, name: true } } } });
    const scopedIds = actor.role === "COUNSELOR" ? (await tx.user.findMany({ where: scopedStudentWhere(actor), select: { id: true } })).map(row => row.id) : [];
    const classKeys = actor.role === "COUNSELOR" ? await counselorClassKeys(tx, actorId) : [];
    const scope: Prisma.ActivityWhereInput = actor.role === "PUBLISHER" ? { ownerId: actorId }
      : actor.role === "COLLEGE" && actor.college ? { OR: [{ collegeId: actor.college.id }, { audienceColleges: { has: actor.college.name } }] }
        : actor.role === "COUNSELOR" ? { OR: [{ audienceClasses: { hasSome: classKeys } }, { participations: { some: { studentId: { in: scopedIds } } } }] }
          : actor.role === "STUDENT" ? feed ? studentFeedWhere(actor) : { participations: { some: { studentId: actorId, registeredAt: { not: null } } } }
            : {};
    const where: Prisma.ActivityWhereInput = { termId, ...(query ? { OR: [{ name: { contains: query.slice(0, 80), mode: "insensitive" } }, { organizer: { contains: query.slice(0, 80), mode: "insensitive" } }] } : {}), ...scope };
    const [items, total] = await Promise.all([tx.activity.findMany({ where, include: { college: { select: { id: true, name: true, code: true } } }, orderBy: [{ startsAt: "desc" }, { id: "desc" }], take: 20, skip: (safePage - 1) * 20 }), tx.activity.count({ where })]);
    const own = actor.role === "STUDENT" ? await tx.participation.findMany({ where: { activityId: { in: items.map(item => item.id) }, studentId: actorId, registeredAt: { not: null } }, include: ownEvidenceInclude }) : [];
    return { items: items.map(({ college, ...item }) => activityView(item, actor.role, own.find(fact => fact.activityId === item.id), { canManage: canManageActivity(item, actor), college })), total, page: safePage };
  }, "read");
}
export async function getActivity(sessionId: string, id: string) {
  const found = await db.activity.findUnique({ where: { id }, select: { termId: true } });
  if (!found) throw new AccountError("活动不存在或无权查看", 404);
  return termTransaction(sessionId, found.termId, ["ADMIN", "COLLEGE", "COUNSELOR", "PUBLISHER", "STUDENT"], [...phases], async (tx, _term, actorId) => {
    const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId }, include: { studentProfile: true, college: { select: { id: true, name: true, code: true } } } });
    const activity = await tx.activity.findUniqueOrThrow({ where: { id }, include: { college: { select: { id: true, name: true, code: true } }, evidence: { include: evidenceInclude, orderBy: [{ version: "desc" }, { id: "desc" }] } } });
    const canManage = canManageActivity(activity, actor);
    const own = actor.role === "STUDENT" ? await tx.participation.findUnique({ where: { activityId_studentId: { activityId: id, studentId: actorId } }, include: ownEvidenceInclude }) : null;
    const scoped = actor.role === "COUNSELOR" || actor.role === "COLLEGE" ? await tx.user.count({ where: { AND: [scopedStudentWhere(actor), { participations: { some: { activityId: id } } }] } }) : 0;
    const scopedClassFeed = actor.role === "COUNSELOR" ? (await counselorClassKeys(tx, actorId)).some(key => activity.audienceClasses.includes(key)) : false;
    const audienceCollege = actor.role === "COLLEGE" && actor.college ? activity.audienceColleges.includes(actor.college.name) : false;
    const visible = actor.role === "ADMIN" || canManage || (actor.role === "PUBLISHER" && activity.ownerId === actorId) || (actor.role === "STUDENT" && (!!own?.registeredAt || !!await tx.activity.findFirst({ where: { id, ...studentFeedWhere(actor) }, select: { id: true } }))) || (actor.role === "COUNSELOR" && (scoped > 0 || scopedClassFeed)) || (actor.role === "COLLEGE" && (audienceCollege || scoped > 0));
    if (!visible) throw new AccountError("活动不存在或无权查看", 404);
    return { ...activityView(activity, actor.role, own?.registeredAt ? own : null, { canManage, college: activity.college, evidence: activity.evidence, includeEvidenceHistory: canManage, canReview: actor.role === "COUNSELOR" || actor.role === "COLLEGE" }), canSubmit: false };
  }, "read");
}
export async function saveActivity(sessionId: string, termId: string, input: unknown) {
  const data = z.object({ id: z.string().optional(), revision: z.number().int().nonnegative().optional(), activity: activitySchema }).parse(input);
  const { audience: raw, collegeId: requestedCollegeId, ...fields } = data.activity, audience = normalizeAudience(raw);
  if (new Date(fields.endsAt) < new Date(fields.startsAt)) throw new AccountError("结束时间不能早于开始时间");
  if (Rational.from(fields.points).compare(Rational.from("0")) < 0) throw new AccountError("活动分值不能为负");
  return termTransaction(sessionId, termId, ["ADMIN", "COLLEGE", "PUBLISHER"], ["ACTIVE"], async (tx, term, actorId) => {
    if (validateScheme(term.scheme).nodes.get(fields.nodeId)?.kind !== "ACTIVITY") throw new AccountError("活动必须归属活动累加最底层模块");
    const previous = data.id ? await tx.activity.findUnique({ where: { id: data.id } }) : null;
    if (data.id && (!previous || previous.termId !== termId)) throw new AccountError("活动不存在", 404);
    const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId } });
    if (!previous && actor.role === "PUBLISHER") throw new AccountError("历史发布者仅保留既有活动，不能创建新活动", 403);
    if (previous) assertActivityManager(previous, actor);
    if (previous && previous.revision !== data.revision) throw new AccountError("活动已变化，请刷新", 409);
    if (previous?.confirmed && (previous.nodeId !== fields.nodeId || previous.scoreMode !== fields.scoreMode || !previous.points.equals(fields.points))) throw new AccountError("已确认分值变更须通过影响预览与统一更正", 409);
    const collegeId = actor.role === "COLLEGE" ? actor.collegeId : actor.role === "PUBLISHER" ? previous?.collegeId ?? null : previous?.collegeId ?? requestedCollegeId ?? null;
    if (!collegeId) throw new AccountError("请选择活动主办学院");
    if (previous?.collegeId && collegeId !== previous.collegeId) throw new AccountError("活动主办学院移交须由学校管理员单独办理");
    const college = await tx.college.findUnique({ where: { id: collegeId } });
    if (!college?.enabled) throw new AccountError("活动主办学院不存在或已停用");
    const changed = previous && JSON.stringify(activityAudience(previous)) !== JSON.stringify(audience);
    const saved = previous ? await tx.activity.update({ where: { id: previous.id }, data: { ...fields, ...audienceFields(audience), ...(changed ? { publishedAt: null, ...(previous.publishedAt ? { publishRevision: { increment: 1 } } : {}) } : {}), revision: { increment: 1 } } }) : await tx.activity.create({ data: { ...fields, ...audienceFields(audience), termId, ownerId: actorId, collegeId } });
    await tx.auditEvent.create({ data: { actorId, action: previous ? "ACTIVITY_UPDATED" : "ACTIVITY_CREATED", targetId: saved.id, details: { termId, collegeId, revision: saved.revision, scopeChanged: !!changed, publicationWithdrawn: !!changed && !!previous?.publishedAt, ...(changed ? { beforeAudience: activityAudience(previous), afterAudience: audience, publishRevision: saved.publishRevision } : {}) } } });
    return activityView(saved, actor.role, null, { canManage: true, college });
  });
}
export async function reassignActivity(sessionId: string, termId: string, input: unknown) {
  const data = z.object({ id: z.string(), revision: z.number().int().nonnegative(), collegeId: z.string().min(1).max(100), reason: z.string().trim().min(2).max(500) }).parse(input);
  return termTransaction(sessionId, termId, ["ADMIN"], ["ACTIVE"], async (tx, term, actorId) => {
    const activity = await tx.activity.findUnique({ where: { id: data.id } });
    if (!activity || activity.termId !== termId) throw new AccountError("活动不存在", 404);
    if (activity.revision !== data.revision) throw new AccountError("活动已变化，请刷新", 409);
    const college = await tx.college.findUnique({ where: { id: data.collegeId } });
    if (!college?.enabled) throw new AccountError("请选择已启用的主办学院");
    if (activity.collegeId === college.id) return activityView(activity, "ADMIN", null, { canManage: true, college });
    const before = activity.collegeId ? await tx.college.findUnique({ where: { id: activity.collegeId }, select: { id: true, name: true } }) : null;
    const saved = await tx.activity.update({ where: { id: activity.id }, data: { collegeId: college.id, revision: { increment: 1 } } });
    await tx.auditEvent.create({ data: { actorId, action: "ACTIVITY_HOST_REASSIGNED", targetId: activity.id, details: { termId, reason: data.reason, before, after: { id: college.id, name: college.name }, rosterRevision: activity.rosterRevision } } });
    return activityView(saved, "ADMIN", null, { canManage: true, college });
  });
}
export async function confirmActivity(sessionId: string, termId: string, input: unknown) {
  const data = z.object({ id: z.string(), revision: z.number().int().nonnegative() }).parse(input);
  return termTransaction(sessionId, termId, ["ADMIN"], ["ACTIVE"], async (tx, term, actorId) => {
    const activity = await tx.activity.findUnique({ where: { id: data.id } });
    if (!activity || activity.termId !== termId) throw new AccountError("活动不存在", 404);
    if (activity.revision !== data.revision) throw new AccountError("活动已变化，请刷新", 409);
    if (activity.confirmed) return activityView(activity, "ADMIN", null, { canManage: true });
    if (validateScheme(term.scheme).nodes.get(activity.nodeId)?.kind !== "ACTIVITY") throw new AccountError("活动归属已失效", 409);
    const saved = await tx.activity.update({ where: { id: data.id }, data: { confirmed: true, revision: { increment: 1 } } });
    await tx.auditEvent.create({ data: { actorId, action: "ACTIVITY_CONFIRMED", targetId: saved.id, details: { termId, nodeId: saved.nodeId, points: saved.points.toFixed() } } });
    return activityView(saved, "ADMIN", null, { canManage: true });
  });
}
export async function publishActivity(sessionId: string, termId: string, input: unknown) {
  const data = z.object({ id: z.string(), revision: z.number().int().nonnegative(), action: z.enum(["publish", "unpublish"]), token: z.string().max(4000).optional(), reason: z.string().trim().min(2).max(1000).optional() }).parse(input);
  return termTransaction(sessionId, termId, ["ADMIN", "COLLEGE", "PUBLISHER"], ["ACTIVE"], async (tx, _term, actorId) => {
    const activity = await tx.activity.findUnique({ where: { id: data.id } });
    if (!activity || activity.termId !== termId) throw new AccountError("活动不存在", 404);
    const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId } });
    assertActivityManager(activity, actor);
    if (activity.revision !== data.revision) throw new AccountError("活动已变化，请重新核对", 409);
    if (data.action === "publish") {
      if (!activity.confirmed) throw new AccountError("请先由管理员确认活动分值", 409);
      const inspected = await inspectAudience(tx, activityAudience(activity));
      if (inspected.errors.length) throw new AccountError(inspected.errors.join("；"), 409);
      verifyFlowToken(data.token ?? "", actorId, "ACTIVITY_AUDIENCE", audienceTokenState(inspected));
    } else if (!data.reason) throw new AccountError("请填写撤回发布的理由");
    const saved = await tx.activity.update({ where: { id: activity.id }, data: { publishedAt: data.action === "publish" ? new Date() : null, publishRevision: { increment: 1 }, revision: { increment: 1 } } });
    await tx.auditEvent.create({ data: { actorId, action: data.action === "publish" ? "ACTIVITY_PUBLISHED" : "ACTIVITY_UNPUBLISHED", targetId: activity.id, details: { termId, publishRevision: saved.publishRevision, audience: activityAudience(activity), reason: data.reason ?? null } } });
    return activityView(saved, actor.role, null, { canManage: true });
  });
}
