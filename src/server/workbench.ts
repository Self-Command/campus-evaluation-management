import { z } from "zod";
import { db } from "@/server/db";
import { AccountError } from "@/server/accounts";
import { collectStudentResults, ranked, resultStudentSelect, type StudentResultPayload } from "@/server/results";
import type { Prisma, Term, Role } from "@/generated/prisma/client";
import { studentFeedWhere } from "@/server/activity-policy";
import { effectiveCheckingDeadline } from "@/server/publication-window";

export type WorkItem = {
  id: string; kind: "ACTIVITY" | "CLAIM" | "APPEAL"; title: string;
  description: string; status: string; at: Date; href: string;
};
const sourceSelect = {
  id: true, status: true, submitterId: true, reviewReason: true, createdAt: true, updatedAt: true,
  participation: { select: { studentId: true, activity: { select: { id: true, name: true } } } },
} as const;
const claimSelect = { id: true, status: true, studentId: true, reviewReason: true, createdAt: true, updatedAt: true, project: { select: { name: true } } } as const;
type Source = Prisma.RecognitionSourceGetPayload<{ select: typeof sourceSelect }>;
type Claim = Prisma.PersonalClaimGetPayload<{ select: typeof claimSelect }>;
type Identity = { id: string; name: string; login: string };
type Base = { role: Role; user: Identity; term: Pick<Term, "id" | "name" | "phase" | "revision" | "inputRevision"> | null };
export type AdminWorkbench = Base & {
  role: "ADMIN";
  stats: { pendingRecognitions: number; pendingClaims: number; unconfirmedActivities: number; openAppeals: number; activeStudents: number };
  reviewQueue: WorkItem[]; appeals: WorkItem[];
  periods: { id: string; name: string; phase: Term["phase"]; revision: number; pendingRecognitions: number; pendingClaims: number; openAppeals: number; publishedStudents: number; confirmedStudents: number; checkingEndsAt: Date | null }[];
};
export type PublisherWorkbench = Base & {
  role: "PUBLISHER";
  stats: { activities: number; unconfirmedActivities: number; pendingRecognitions: number; needsChanges: number; approvedRecognitions: number };
  activities: { id: string; name: string; organizer: string; startsAt: Date; endsAt: Date; confirmed: boolean; points: string; participantCount: number; pendingCount: number; approvedCount: number }[];
  followUps: WorkItem[];
};
export type StudentWorkbench = Base & {
  role: "STUDENT";
  stats: { pendingRecognitions: number; pendingClaims: number; needsChanges: number; approvedRecognitions: number; approvedClaims: number; openAppeals: number };
  outcome: {
    state: "NO_TERM" | "NO_PROFILE" | "CONFIGURATION" | "ACTIVE" | "PUBLISHED" | "NOT_INCLUDED";
    total: string | null; provisionalTotal: string | null; complete: boolean | null;
    missing: { id: string; name: string }[];
    publication: { id: string; sequence: number; checkingEndsAt: Date; requireConfirmation: boolean } | null;
    confirmedAt: Date | null; rank: number | null; population: number | null;
  };
  modules: { id: string; name: string; score: string; complete: boolean; parentContribution: string }[];
  followUps: WorkItem[]; recent: WorkItem[];
  opportunities: { id: string; name: string; organizer: string; startsAt: Date; endsAt: Date; points: string }[];
};
export type WorkbenchData = AdminWorkbench | PublisherWorkbench | StudentWorkbench;
const attention = ["NEEDS_CHANGES", "REJECTED"] as const;
function url(path: string, termId: string, status?: string) {
  return `${path}?${new URLSearchParams({ termId, ...(status ? { status } : {}) })}`;
}
function sourceItem(row: Source, termId: string, member?: Identity): WorkItem {
  return { id: row.id, kind: "ACTIVITY", title: row.participation.activity.name,
    description: member ? `${member.name} · ${member.login}` : row.reviewReason || "活动参与认定",
    status: row.status, at: row.updatedAt, href: url("/recognitions", termId, row.status) };
}
function claimItem(row: Claim, termId: string, member?: Identity): WorkItem {
  return { id: row.id, kind: "CLAIM", title: row.project.name,
    description: member ? `${member.name} · ${member.login}` : row.reviewReason || "个人成果申报",
    status: row.status, at: row.updatedAt, href: url("/claims", termId, row.status) };
}
function newest(rows: WorkItem[], size = 8) { return rows.sort((a, b) => b.at.getTime() - a.at.getTime() || a.id.localeCompare(b.id)).slice(0, size); }

async function administrator(tx: Prisma.TransactionClient, base: Base): Promise<AdminWorkbench> {
  const id = base.term?.id;
  const [activeStudents, pendingRecognitions, pendingClaims, unconfirmedActivities, openAppeals, sources, claims, appeals, terms] = await Promise.all([
    tx.user.count({ where: { role: "STUDENT", disabled: false, studentProfile: { isNot: null } } }),
    id ? tx.recognitionSource.count({ where: { status: "PENDING", participation: { activity: { termId: id } } } }) : 0,
    id ? tx.personalClaim.count({ where: { status: "PENDING", project: { termId: id } } }) : 0,
    id ? tx.activity.count({ where: { termId: id, confirmed: false } }) : 0,
    id ? tx.resultAppeal.count({ where: { termId: id, status: { in: ["OPEN", "PROCESSING"] } } }) : 0,
    id ? tx.recognitionSource.findMany({ where: { status: "PENDING", participation: { activity: { termId: id } } }, select: sourceSelect, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 8 }) : [],
    id ? tx.personalClaim.findMany({ where: { status: "PENDING", project: { termId: id } }, select: claimSelect, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 8 }) : [],
    id ? tx.resultAppeal.findMany({ where: { termId: id, status: { in: ["OPEN", "PROCESSING"] } }, select: { id: true, studentId: true, target: true, status: true, createdAt: true, publication: { select: { sequence: true } } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 6 }) : [],
    tx.term.findMany({ where: { disposition: "NORMAL" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 8, select: { id: true, name: true, phase: true, revision: true, publishedResultSetId: true } }),
  ]);
  const studentIds = [...new Set([...sources.map(row => row.participation.studentId), ...claims.map(row => row.studentId), ...appeals.map(row => row.studentId)])];
  const students = await tx.user.findMany({ where: { id: { in: studentIds } }, select: { id: true, name: true, login: true } });
  const known = new Map(students.map(row => [row.id, row]));
  const periods = await Promise.all(terms.map(async term => {
    const [recognitions, personal, unresolved, publication, confirmed] = await Promise.all([
      tx.recognitionSource.count({ where: { status: "PENDING", participation: { activity: { termId: term.id } } } }),
      tx.personalClaim.count({ where: { status: "PENDING", project: { termId: term.id } } }),
      tx.resultAppeal.count({ where: { termId: term.id, status: { in: ["OPEN", "PROCESSING"] } } }),
      term.publishedResultSetId ? tx.resultPublication.findUnique({ where: { id: term.publishedResultSetId }, select: { id: true, studentCount: true, checkingEndsAt: true } }) : null,
      term.publishedResultSetId ? tx.resultConfirmation.count({ where: { result: { publicationId: term.publishedResultSetId } } }) : 0,
    ]);
    return { id: term.id, name: term.name, phase: term.phase, revision: term.revision, pendingRecognitions: recognitions, pendingClaims: personal, openAppeals: unresolved, publishedStudents: publication?.studentCount ?? 0, confirmedStudents: confirmed, checkingEndsAt: publication ? await effectiveCheckingDeadline(tx, publication) : null };
  }));
  // Oldest submissions first, regardless of whether they are activity or personal claims.
  const reviewQueue = [...sources.map(row => ({ ...sourceItem(row, id!, known.get(row.participation.studentId)), at: row.createdAt })), ...claims.map(row => ({ ...claimItem(row, id!, known.get(row.studentId)), at: row.createdAt }))].sort((a, b) => a.at.getTime() - b.at.getTime() || a.id.localeCompare(b.id)).slice(0, 8);
  return { ...base, role: "ADMIN", stats: { activeStudents, pendingRecognitions, pendingClaims, unconfirmedActivities, openAppeals }, reviewQueue, periods,
    appeals: appeals.map(row => ({ id: row.id, kind: "APPEAL", title: row.target, description: `${known.get(row.studentId)?.name || "学生档案不可用"} · 发布版本 ${row.publication.sequence}`, status: row.status, at: row.createdAt, href: url("/appeals", id!, row.status) })) };
}

async function publisher(tx: Prisma.TransactionClient, base: Base): Promise<PublisherWorkbench> {
  const id = base.term?.id;
  const empty: PublisherWorkbench = { ...base, role: "PUBLISHER", stats: { activities: 0, unconfirmedActivities: 0, pendingRecognitions: 0, needsChanges: 0, approvedRecognitions: 0 }, activities: [], followUps: [] };
  if (!id) return empty;
  const owned = { termId: id, ownerId: base.user.id };
  const sourceWhere = { participation: { activity: owned } };
  const [activities, unconfirmedActivities, pendingRecognitions, needsChanges, approvedRecognitions, rows, followUps] = await Promise.all([
    tx.activity.count({ where: owned }), tx.activity.count({ where: { ...owned, confirmed: false } }),
    tx.recognitionSource.count({ where: { ...sourceWhere, status: "PENDING" } }),
    tx.recognitionSource.count({ where: { ...sourceWhere, submitterId: base.user.id, status: { in: [...attention] } } }),
    tx.participation.count({ where: { activity: owned, sources: { some: { status: "APPROVED" } } } }),
    tx.activity.findMany({ where: owned, orderBy: [{ startsAt: "desc" }, { id: "desc" }], take: 8, select: { id: true, name: true, organizer: true, startsAt: true, endsAt: true, confirmed: true, points: true, _count: { select: { participations: true } } } }),
    tx.recognitionSource.findMany({ where: { ...sourceWhere, submitterId: base.user.id, status: { in: [...attention] } }, select: sourceSelect, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 8 }),
  ]);
  const activityRows = await Promise.all(rows.map(async row => {
    const [pendingCount, approvedCount] = await Promise.all([
      tx.recognitionSource.count({ where: { participation: { activityId: row.id }, status: "PENDING" } }),
      tx.participation.count({ where: { activityId: row.id, sources: { some: { status: "APPROVED" } } } }),
    ]);
    return { id: row.id, name: row.name, organizer: row.organizer, startsAt: row.startsAt, endsAt: row.endsAt, confirmed: row.confirmed, points: row.points.toFixed(), participantCount: row._count.participations, pendingCount, approvedCount };
  }));
  return { ...empty, stats: { activities, unconfirmedActivities, pendingRecognitions, needsChanges, approvedRecognitions }, activities: activityRows, followUps: followUps.map(row => sourceItem(row, id)) };
}

async function student(tx: Prisma.TransactionClient, base: Base, term: Term | null): Promise<StudentWorkbench> {
  const empty: StudentWorkbench = { ...base, role: "STUDENT", stats: { pendingRecognitions: 0, pendingClaims: 0, needsChanges: 0, approvedRecognitions: 0, approvedClaims: 0, openAppeals: 0 }, outcome: { state: "NO_TERM", total: null, provisionalTotal: null, complete: null, missing: [], publication: null, confirmedAt: null, rank: null, population: null }, modules: [], followUps: [], recent: [], opportunities: [] };
  if (!term) return empty;
  const id = term.id, actorId = base.user.id;
  const ownFacts = { studentId: actorId, activity: { termId: id } };
  const ownSources = { participation: ownFacts };
  const ownClaims = { studentId: actorId, project: { termId: id } };
  const currentStudent = await tx.user.findUniqueOrThrow({ where: { id: actorId }, include: { studentProfile: true } });
  const [pendingRecognitions, pendingClaims, approvedRecognitions, approvedClaims, sourceAttention, claimAttention, openAppeals, sources, claims, profile, opportunities] = await Promise.all([
    tx.recognitionSource.count({ where: { ...ownSources, status: "PENDING" } }),
    tx.personalClaim.count({ where: { ...ownClaims, status: "PENDING" } }),
    tx.participation.count({ where: { ...ownFacts, activity: { termId: id, confirmed: true }, sources: { some: { status: "APPROVED" } } } }),
    tx.personalClaim.count({ where: { ...ownClaims, status: "APPROVED" } }),
    tx.recognitionSource.count({ where: { ...ownSources, submitterId: actorId, status: { in: [...attention] } } }),
    tx.personalClaim.count({ where: { ...ownClaims, status: { in: [...attention] } } }),
    tx.resultAppeal.count({ where: { termId: id, studentId: actorId, status: { in: ["OPEN", "PROCESSING"] } } }),
    tx.recognitionSource.findMany({ where: ownSources, select: sourceSelect, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 8 }),
    tx.personalClaim.findMany({ where: ownClaims, select: claimSelect, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 8 }),
    tx.user.findUniqueOrThrow({ where: { id: actorId }, select: resultStudentSelect }),
    term.phase === "ACTIVE" ? tx.activity.findMany({ where: { termId: id, ...studentFeedWhere(currentStudent), endsAt: { gte: new Date() } }, orderBy: [{ startsAt: "asc" }, { id: "asc" }], take: 5, select: { id: true, name: true, organizer: true, startsAt: true, endsAt: true, points: true } }) : [],
  ]);
  const [neededSources, neededClaims] = await Promise.all([
    tx.recognitionSource.findMany({ where: { ...ownSources, submitterId: actorId, status: { in: [...attention] } }, select: sourceSelect, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 8 }),
    tx.personalClaim.findMany({ where: { ...ownClaims, status: { in: [...attention] } }, select: claimSelect, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 8 }),
  ]);
  const data: StudentWorkbench = { ...empty,
    stats: { pendingRecognitions, pendingClaims, approvedRecognitions, approvedClaims, needsChanges: sourceAttention + claimAttention, openAppeals },
    followUps: newest([...neededSources.map(row => sourceItem(row, id)), ...neededClaims.map(row => claimItem(row, id))]),
    recent: newest([...sources.map(row => sourceItem(row, id)), ...claims.map(row => claimItem(row, id))]),
    opportunities: opportunities.map(row => ({ ...row, points: row.points.toFixed() })),
  };
  let payload: StudentResultPayload | undefined;
  if (term.phase === "CHECKING" || term.phase === "LOCKED") {
    const record = term.publishedResultSetId ? await tx.publishedResult.findUnique({ where: { publicationId_studentId: { publicationId: term.publishedResultSetId, studentId: actorId } }, include: { publication: { select: { id: true, sequence: true, checkingEndsAt: true, requireConfirmation: true } }, confirmation: { select: { confirmedAt: true } } } }) : null;
    if (!record) data.outcome.state = "NOT_INCLUDED";
    else {
      payload = record.payload as unknown as StudentResultPayload;
      const ranking = ranked(await tx.publishedResult.findMany({ where: { publicationId: record.publicationId }, select: { studentId: true, login: true, total: true } }));
      data.outcome = { ...data.outcome, state: "PUBLISHED", publication: { ...record.publication, checkingEndsAt: await effectiveCheckingDeadline(tx, record.publication) }, confirmedAt: record.confirmation?.confirmedAt ?? null, rank: ranking.find(row => row.studentId === actorId)?.rank ?? null, population: ranking.length };
    }
  } else if (!profile.studentProfile) data.outcome.state = "NO_PROFILE";
  else if (term.phase === "CONFIGURATION") data.outcome.state = "CONFIGURATION";
  else { payload = (await collectStudentResults(tx, term, [profile]))[0]; data.outcome.state = "ACTIVE"; }
  if (payload) {
    data.outcome = { ...data.outcome, total: payload.result.total, provisionalTotal: payload.result.provisionalTotal, complete: payload.result.complete, missing: payload.result.missing };
    const root = payload.result.details.find(row => row.parentId === null);
    data.modules = payload.result.details.filter(row => row.parentId === root?.id || row.id === root?.id && payload!.result.details.length === 1).map(row => ({ id: row.id, name: row.name, score: row.score!, complete: row.complete, parentContribution: row.parentContribution }));
  }
  return data;
}

export async function getWorkbench(sessionId: string, requestedTermId?: string): Promise<WorkbenchData> {
  const termId = z.string().min(1).max(100).optional().parse(requestedTermId);
  return db.$transaction(async tx => {
    // Lock in the same account -> period order as writes. READ COMMITTED makes
    // authorization observe any writer that completed while these locks waited.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(72109312)`;
    if (termId) await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${termId}, 72109313))`;
    const session = await tx.authSession.findUnique({ where: { id: sessionId }, select: { userId: true, revokedAt: true, expiresAt: true, version: true, user: { select: { id: true, login: true, name: true, role: true, disabled: true, mustChangePassword: true, authVersion: true } } } });
    if (!session || session.revokedAt || session.expiresAt <= new Date() || session.user.disabled || session.version !== session.user.authVersion) throw new AccountError("会话已失效，请重新登录", 401);
    if (session.user.mustChangePassword) throw new AccountError("请先修改初始密码", 403);
    const term = termId ? await tx.term.findUnique({ where: { id: termId } }) : null;
    if (termId && (!term || term.disposition === "DELETED")) throw new AccountError("测评周期不存在", 404);
    const base: Base = { role: session.user.role, user: { id: session.user.id, name: session.user.name, login: session.user.login }, term: term ? { id: term.id, name: term.name, phase: term.phase, revision: term.revision, inputRevision: term.inputRevision } : null };
    if (session.user.role === "ADMIN") return administrator(tx, base);
    if (session.user.role === "PUBLISHER") return publisher(tx, base);
    return student(tx, base, term);
  }, { isolationLevel: "ReadCommitted", timeout: 15_000 });
}
