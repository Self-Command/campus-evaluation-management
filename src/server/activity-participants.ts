import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { AccountError } from "@/server/accounts";
import { termTransaction } from "@/server/terms";
import { assertActivityOwner } from "@/server/activity-policy";
import { appendHistory, historyEntry, jsonValue } from "@/server/claims";
import { decimalSchema } from "@/lib/scoring/types";
import { Rational } from "@/lib/scoring/rational";

export function registrationData(student: { id: string; login: string; name: string; studentProfile: { college: string; major: string; className: string } | null }, actorId: string, batchId?: string) {
  return { registeredAt: new Date(), registeredBy: actorId, registrationSnapshot: jsonValue({ studentId: student.id, login: student.login, name: student.name, college: student.studentProfile?.college ?? "", major: student.studentProfile?.major ?? "", className: student.studentProfile?.className ?? "" }), importBatchId: batchId ?? null };
}
export async function registerFact(tx: Prisma.TransactionClient, activityId: string, student: Parameters<typeof registrationData>[0], actorId: string, batchId?: string) {
  const old = await tx.participation.findUnique({ where: { activityId_studentId: { activityId, studentId: student.id } } });
  const registration = registrationData(student, actorId, batchId);
  if (old?.registeredAt) return old;
  const entry = historyEntry(actorId, batchId ? "IMPORTED" : "REGISTERED", { batchId: batchId ?? null, student: registration.registrationSnapshot });
  return tx.participation.upsert({ where: { activityId_studentId: { activityId, studentId: student.id } }, create: { activityId, studentId: student.id, ...registration, history: jsonValue([entry]) }, update: { ...registration, revision: { increment: 1 }, history: appendHistory(old?.history ?? [], entry) } });
}
export async function pageActivityParticipants(sessionId: string, termId: string, activityId: string, page = 1, query = "") {
  const safePage = z.number().int().min(1).max(100000).parse(page);
  return termTransaction(sessionId, termId, ["ADMIN", "PUBLISHER"], ["CONFIGURATION", "ACTIVE", "CHECKING", "LOCKED"], async (tx, _term, actorId) => {
    const activity = await tx.activity.findUnique({ where: { id: activityId } });
    const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId } });
    if (!activity || activity.termId !== termId || (actor.role !== "ADMIN" && activity.ownerId !== actorId)) throw new AccountError("活动不存在或无权查看", 404);
    // A bounded identity lookup augments historical registration snapshots for search.
    const students = await tx.user.findMany({ where: query ? { OR: [{ login: { contains: query.slice(0, 80), mode: "insensitive" } }, { name: { contains: query.slice(0, 80), mode: "insensitive" } }] } : { id: { in: [] } }, select: { id: true } });
    const where: Prisma.ParticipationWhereInput = { activityId, registeredAt: { not: null }, ...(query ? { OR: [{ studentId: { in: students.map(student => student.id) } }, { registrationSnapshot: { path: ["login"], string_contains: query.slice(0, 80) } }, { registrationSnapshot: { path: ["name"], string_contains: query.slice(0, 80) } }] } : {}) };
    const [items, total] = await Promise.all([tx.participation.findMany({ where, include: { sources: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, submitterId: true, status: true, reviewReason: true, note: true, revision: true, history: true, createdAt: true, evidence: { select: { evidence: { select: { id: true, name: true, mime: true, size: true } } } } } } }, take: 20, skip: (safePage - 1) * 20, orderBy: [{ registeredAt: "desc" }, { id: "desc" }] }), tx.participation.count({ where })]);
    return { items: items.map(item => ({ ...item, ...(item.registrationSnapshot as object ?? {}), score: item.score?.toFixed() ?? null })), total, page: safePage };
  }, "read");
}
export async function saveActivityScore(sessionId: string, termId: string, input: unknown) {
  const data = z.object({ participationId: z.string(), revision: z.number().int().nonnegative(), value: decimalSchema, reason: z.string().trim().min(2).max(1000) }).parse(input);
  return termTransaction(sessionId, termId, ["ADMIN", "PUBLISHER"], ["ACTIVE"], async (tx, _term, actorId) => {
    const fact = await tx.participation.findUnique({ where: { id: data.participationId }, include: { activity: true, sources: true } });
    if (!fact || fact.activity.termId !== termId || !fact.registeredAt) throw new AccountError("后台参与登记不存在", 404);
    const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId } });
    assertActivityOwner(fact.activity, actor);
    if (!fact.activity.confirmed || fact.activity.scoreMode !== "INDIVIDUAL") throw new AccountError("该活动未确认或采用固定分，无需逐人录分", 409);
    if (fact.revision !== data.revision) throw new AccountError("参与或审核记录已变化，请刷新", 409);
    const value = Rational.from(data.value);
    if (value.compare(Rational.from("0")) < 0 || value.compare(Rational.from(fact.activity.points.toFixed())) > 0) throw new AccountError("个人分数须在0与活动分值上限之间");
    if (fact.score?.equals(data.value)) return { ...fact, score: fact.score.toFixed() };
    const entry = historyEntry(actorId, "SCORE_CHANGED", { before: fact.score?.toFixed() ?? null, after: data.value, reason: data.reason });
    const saved = await tx.participation.update({ where: { id: fact.id }, data: { score: data.value, revision: { increment: 1 }, history: appendHistory(fact.history, entry) } });
    for (const source of fact.sources.filter(source => source.status === "APPROVED")) await tx.recognitionSource.update({ where: { id: source.id }, data: { status: "PENDING", revision: { increment: 1 }, reviewerId: null, reviewedAt: null, reviewReason: null, history: appendHistory(source.history, historyEntry(actorId, "SCORE_REVIEW_REQUIRED", { reason: data.reason, before: "APPROVED", after: "PENDING" })) } });
    await tx.term.update({ where: { id: termId }, data: { inputRevision: { increment: 1 } } });
    await tx.auditEvent.create({ data: { actorId, action: "ACTIVITY_SCORE_SAVED", targetId: fact.id, details: { termId, activityId: fact.activityId, before: fact.score?.toFixed() ?? null, after: data.value, reason: data.reason } } });
    return { ...saved, score: saved.score?.toFixed() ?? null };
  });
}
