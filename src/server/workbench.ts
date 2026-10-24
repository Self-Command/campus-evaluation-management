import { z } from "zod";
import { db } from "@/server/db";
import { AccountError } from "@/server/accounts";
import { collectStudentResults, ranked, resultStudentSelect, type StudentResultPayload } from "@/server/results";
import type { Prisma, Term, Role, RecognitionStatus, ClaimStatus } from "@/generated/prisma/client";
import { studentFeedWhere } from "@/server/activity-policy";
import { effectiveCheckingDeadline } from "@/server/publication-window";
import { claimPendingStatuses, claimAttentionStatuses } from "@/server/claims";
import { validateScheme } from "@/lib/scoring/validate";

export type WorkItem = {
  id: string; kind: "ACTIVITY" | "CLAIM" | "APPEAL" | "GRADE" | "DEDUCTION"; title: string;
  description: string; status: string; at: Date; href: string;
};
const sourceSelect = {
  id: true, status: true, submitterId: true, reviewReason: true, createdAt: true, updatedAt: true,
  participation: { select: { studentId: true, activity: { select: { id: true, name: true } } } },
} as const;
const claimSelect = { id: true, status: true, studentId: true, reviewReason: true, createdAt: true, updatedAt: true, title: true } as const;
type Source = Prisma.RecognitionSourceGetPayload<{ select: typeof sourceSelect }>;
type Claim = Prisma.PersonalClaimGetPayload<{ select: typeof claimSelect }>;
type Identity = { id: string; name: string; login: string };
type Base = { role: Role; user: Identity; term: Pick<Term, "id" | "name" | "phase" | "revision" | "inputRevision"> | null };
export type AdminWorkbench = Base & {
  role: "ADMIN";
  stats: { pendingRecognitions: number; pendingClaims: number; ongoingActivities: number; openAppeals: number; activeStudents: number };
  reviewQueue: WorkItem[]; appeals: WorkItem[];
  periods: { id: string; name: string; phase: Term["phase"]; revision: number; pendingRecognitions: number; pendingClaims: number; openAppeals: number; publishedStudents: number; confirmedStudents: number; checkingEndsAt: Date | null }[];
};
export type PublisherWorkbench = Base & {
  role: "PUBLISHER";
  stats: { activities: number; unpublishedActivities: number; pendingRecognitions: number; needsChanges: number; approvedRecognitions: number };
  activities: { id: string; name: string; organizer: string; startsAt: Date; endsAt: Date; publishedAt: Date | null; points: string; participantCount: number; pendingCount: number; approvedCount: number }[];
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
export type ClassProgress = {
  id: string; name: string; major: string; students: number; gradeComplete: number;
  pendingRecognitions: number; pendingClaims: number; pendingGradeChanges: number; pendingDeductionChanges: number;
};
export type CounselorWorkbench = Base & {
  role: "COUNSELOR";
  stats: { pendingRecognitions: number; pendingClaims: number; returnedChanges: number; gradeIncomplete: number; classes: number; students: number };
  todos: WorkItem[]; classes: ClassProgress[];
};
export type CollegeWorkbench = Base & {
  role: "COLLEGE";
  stats: {
    pendingRecognitions: number; pendingClaims: number; pendingGradeChanges: number; pendingDeductionChanges: number;
    awaitingRoster: number; gradeIncomplete: number; classes: number; students: number;
  };
  todos: WorkItem[]; classes: ClassProgress[];
  activities: { id: string; name: string; organizer: string; startsAt: Date; endsAt: Date; points: string; participantCount: number }[];
};
export type WorkbenchData = AdminWorkbench | PublisherWorkbench | StudentWorkbench | CounselorWorkbench | CollegeWorkbench;
const attention = ["RETURNED", "REJECTED"] as const;
function url(path: string, termId: string, status?: string) {
  return `${path}?${new URLSearchParams({ termId, ...(status ? { status } : {}) })}`;
}
function sourceItem(row: Source, termId: string, member?: Identity): WorkItem {
  return { id: row.id, kind: "ACTIVITY", title: row.participation.activity.name,
    description: member ? `${member.name} · ${member.login}` : row.reviewReason || "活动参与认定",
    status: row.status, at: row.updatedAt, href: url("/recognitions", termId, row.status) };
}
function claimItem(row: Claim, termId: string, member?: Identity): WorkItem {
  return { id: row.id, kind: "CLAIM", title: row.title,
    description: member ? `${member.name} · ${member.login}` : row.reviewReason || "个人成果申报",
    status: row.status, at: row.updatedAt, href: url("/claims", termId, row.status) };
}
function newest(rows: WorkItem[], size = 8) { return rows.sort((a, b) => b.at.getTime() - a.at.getTime() || a.id.localeCompare(b.id)).slice(0, size); }

async function administrator(tx: Prisma.TransactionClient, base: Base): Promise<AdminWorkbench> {
  const id = base.term?.id;
  const [activeStudents, pendingRecognitions, pendingClaims, ongoingActivities, openAppeals, sources, claims, appeals, terms] = await Promise.all([
    tx.user.count({ where: { role: "STUDENT", disabled: false, studentProfile: { isNot: null } } }),
    id ? tx.recognitionSource.count({ where: { status: { in: ["PENDING_COUNSELOR", "PENDING_COLLEGE"] }, participation: { activity: { termId: id } } } }) : 0,
    id ? tx.personalClaim.count({ where: { termId: id, status: { in: [...claimPendingStatuses] } } }) : 0,
    id ? tx.activity.count({ where: { termId: id, publishedAt: { not: null }, startsAt: { lte: new Date() }, endsAt: { gte: new Date() } } }) : 0,
    id ? tx.resultAppeal.count({ where: { termId: id, status: { in: ["OPEN", "PROCESSING"] } } }) : 0,
    id ? tx.recognitionSource.findMany({ where: { status: { in: ["PENDING_COUNSELOR", "PENDING_COLLEGE"] }, participation: { activity: { termId: id } } }, select: sourceSelect, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 8 }) : [],
    id ? tx.personalClaim.findMany({ where: { termId: id, status: { in: [...claimPendingStatuses] } }, select: claimSelect, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 8 }) : [],
    id ? tx.resultAppeal.findMany({ where: { termId: id, status: { in: ["OPEN", "PROCESSING"] } }, select: { id: true, studentId: true, target: true, status: true, createdAt: true, publication: { select: { sequence: true } } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 6 }) : [],
    tx.term.findMany({ where: { disposition: "NORMAL" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 8, select: { id: true, name: true, phase: true, revision: true, publishedResultSetId: true } }),
  ]);
  const studentIds = [...new Set([...sources.map(row => row.participation.studentId), ...claims.map(row => row.studentId), ...appeals.map(row => row.studentId)])];
  const students = await tx.user.findMany({ where: { id: { in: studentIds } }, select: { id: true, name: true, login: true } });
  const known = new Map(students.map(row => [row.id, row]));
  const periods = await Promise.all(terms.map(async term => {
    const [recognitions, personal, unresolved, publication, confirmed] = await Promise.all([
      tx.recognitionSource.count({ where: { status: { in: ["PENDING_COUNSELOR", "PENDING_COLLEGE"] }, participation: { activity: { termId: term.id } } } }),
      tx.personalClaim.count({ where: { termId: term.id, status: { in: [...claimPendingStatuses] } } }),
      tx.resultAppeal.count({ where: { termId: term.id, status: { in: ["OPEN", "PROCESSING"] } } }),
      term.publishedResultSetId ? tx.resultPublication.findUnique({ where: { id: term.publishedResultSetId }, select: { id: true, studentCount: true, checkingEndsAt: true } }) : null,
      term.publishedResultSetId ? tx.resultConfirmation.count({ where: { result: { publicationId: term.publishedResultSetId } } }) : 0,
    ]);
    return { id: term.id, name: term.name, phase: term.phase, revision: term.revision, pendingRecognitions: recognitions, pendingClaims: personal, openAppeals: unresolved, publishedStudents: publication?.studentCount ?? 0, confirmedStudents: confirmed, checkingEndsAt: publication ? await effectiveCheckingDeadline(tx, publication) : null };
  }));
  // Oldest submissions first, regardless of whether they are activity or personal claims.
  const reviewQueue = [...sources.map(row => ({ ...sourceItem(row, id!, known.get(row.participation.studentId)), at: row.createdAt })), ...claims.map(row => ({ ...claimItem(row, id!, known.get(row.studentId)), at: row.createdAt }))].sort((a, b) => a.at.getTime() - b.at.getTime() || a.id.localeCompare(b.id)).slice(0, 8);
  return { ...base, role: "ADMIN", stats: { activeStudents, pendingRecognitions, pendingClaims, ongoingActivities, openAppeals }, reviewQueue, periods,
    appeals: appeals.map(row => ({ id: row.id, kind: "APPEAL", title: row.target, description: `${known.get(row.studentId)?.name || "学生档案不可用"} · 发布版本 ${row.publication.sequence}`, status: row.status, at: row.createdAt, href: url("/appeals", id!, row.status) })) };
}

async function publisher(tx: Prisma.TransactionClient, base: Base): Promise<PublisherWorkbench> {
  const id = base.term?.id;
  const empty: PublisherWorkbench = { ...base, role: "PUBLISHER", stats: { activities: 0, unpublishedActivities: 0, pendingRecognitions: 0, needsChanges: 0, approvedRecognitions: 0 }, activities: [], followUps: [] };
  if (!id) return empty;
  const owned = { termId: id, ownerId: base.user.id };
  const sourceWhere = { participation: { activity: owned } };
  const [activities, unpublishedActivities, pendingRecognitions, needsChanges, approvedRecognitions, rows, followUps] = await Promise.all([
    tx.activity.count({ where: owned }), tx.activity.count({ where: { ...owned, publishedAt: null } }),
    tx.recognitionSource.count({ where: { ...sourceWhere, status: { in: ["PENDING_COUNSELOR", "PENDING_COLLEGE"] } } }),
    tx.recognitionSource.count({ where: { ...sourceWhere, status: { in: [...attention] } } }),
    tx.participation.count({ where: { activity: owned, removedAt: null, sources: { some: { status: "APPROVED" } } } }),
    tx.activity.findMany({ where: owned, orderBy: [{ startsAt: "desc" }, { id: "desc" }], take: 8, select: { id: true, name: true, organizer: true, startsAt: true, endsAt: true, publishedAt: true, points: true, _count: { select: { participations: true } } } }),
    tx.recognitionSource.findMany({ where: { ...sourceWhere, status: { in: [...attention] } }, select: sourceSelect, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 8 }),
  ]);
  const activityRows = await Promise.all(rows.map(async row => {
    const [pendingCount, approvedCount] = await Promise.all([
      tx.recognitionSource.count({ where: { participation: { activityId: row.id }, status: { in: ["PENDING_COUNSELOR", "PENDING_COLLEGE"] } } }),
      tx.participation.count({ where: { activityId: row.id, removedAt: null, sources: { some: { status: "APPROVED" } } } }),
    ]);
    return { id: row.id, name: row.name, organizer: row.organizer, startsAt: row.startsAt, endsAt: row.endsAt, publishedAt: row.publishedAt, points: row.points.toFixed(), participantCount: row._count.participations, pendingCount, approvedCount };
  }));
  return { ...empty, stats: { activities, unpublishedActivities, pendingRecognitions, needsChanges, approvedRecognitions }, activities: activityRows, followUps: followUps.map(row => sourceItem(row, id)) };
}

async function student(tx: Prisma.TransactionClient, base: Base, term: Term | null): Promise<StudentWorkbench> {
  const empty: StudentWorkbench = { ...base, role: "STUDENT", stats: { pendingRecognitions: 0, pendingClaims: 0, needsChanges: 0, approvedRecognitions: 0, approvedClaims: 0, openAppeals: 0 }, outcome: { state: "NO_TERM", total: null, provisionalTotal: null, complete: null, missing: [], publication: null, confirmedAt: null, rank: null, population: null }, modules: [], followUps: [], recent: [], opportunities: [] };
  if (!term) return empty;
  const id = term.id, actorId = base.user.id;
  const ownFacts = { studentId: actorId, activity: { termId: id } };
  const ownSources = { participation: ownFacts };
  const ownClaims = { studentId: actorId, termId: id };
  const currentStudent = await tx.user.findUniqueOrThrow({ where: { id: actorId }, include: { studentProfile: true } });
  const [pendingRecognitions, pendingClaims, approvedRecognitions, approvedClaims, sourceAttention, claimAttention, openAppeals, sources, claims, profile, opportunities] = await Promise.all([
    tx.recognitionSource.count({ where: { ...ownSources, status: { in: ["PENDING_COUNSELOR", "PENDING_COLLEGE"] } } }),
    tx.personalClaim.count({ where: { ...ownClaims, status: { in: [...claimPendingStatuses] } } }),
    tx.participation.count({ where: { ...ownFacts, removedAt: null, activity: { termId: id, confirmed: true }, sources: { some: { status: "APPROVED" } } } }),
    tx.personalClaim.count({ where: { ...ownClaims, status: "APPROVED" } }),
    tx.recognitionSource.count({ where: { ...ownSources, status: { in: [...attention] } } }),
    tx.personalClaim.count({ where: { ...ownClaims, status: { in: [...claimAttentionStatuses] } } }),
    tx.resultAppeal.count({ where: { termId: id, studentId: actorId, status: { in: ["OPEN", "PROCESSING"] } } }),
    tx.recognitionSource.findMany({ where: ownSources, select: sourceSelect, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 8 }),
    tx.personalClaim.findMany({ where: ownClaims, select: claimSelect, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 8 }),
    tx.user.findUniqueOrThrow({ where: { id: actorId }, select: resultStudentSelect }),
    term.phase === "ACTIVE" ? tx.activity.findMany({ where: { termId: id, ...studentFeedWhere(currentStudent) }, orderBy: [{ startsAt: "asc" }, { id: "asc" }], take: 5, select: { id: true, name: true, organizer: true, startsAt: true, endsAt: true, points: true } }) : [],
  ]);
  const [neededSources, neededClaims] = await Promise.all([
    tx.recognitionSource.findMany({ where: { ...ownSources, status: { in: [...attention] } }, select: sourceSelect, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 8 }),
    tx.personalClaim.findMany({ where: { ...ownClaims, status: { in: [...claimAttentionStatuses] } }, select: claimSelect, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 8 }),
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

type StaffActor = { id: string; role: Role; collegeId: string | null };

// College and counselor share one workload shape: what waits for them, which
// classes they own, and how complete the grade entry is per class.
async function staff(
  tx: Prisma.TransactionClient,
  base: Base,
  term: Term | null,
  actor: StaffActor,
): Promise<CounselorWorkbench | CollegeWorkbench> {
  const college = actor.role === "COLLEGE";
  const emptyClasses: ClassProgress[] = [];
  const noTerm: CounselorWorkbench | CollegeWorkbench = college
    ? { ...base, role: "COLLEGE", stats: { pendingRecognitions: 0, pendingClaims: 0, pendingGradeChanges: 0, pendingDeductionChanges: 0, awaitingRoster: 0, gradeIncomplete: 0, classes: 0, students: 0 }, todos: [], classes: emptyClasses, activities: [] }
    : { ...base, role: "COUNSELOR", stats: { pendingRecognitions: 0, pendingClaims: 0, returnedChanges: 0, gradeIncomplete: 0, classes: 0, students: 0 }, todos: [], classes: emptyClasses };
  if (!term) return noTerm;
  if (!actor.collegeId) throw new AccountError("学院归属未配置或已停用，请联系学校管理员", 403);
  const enabledCollege = await tx.college.findUnique({ where: { id: actor.collegeId }, select: { enabled: true } });
  if (!enabledCollege?.enabled) throw new AccountError("学院归属未配置或已停用，请联系学校管理员", 403);
  const classWhere: Prisma.SchoolClassWhereInput = college
    ? actor.collegeId
      ? { enabled: true, major: { is: { enabled: true, collegeId: actor.collegeId, college: { is: { enabled: true } } } } }
      : { id: { in: [] } }
    : { enabled: true, counselorId: actor.id, major: { is: { enabled: true, college: { is: { enabled: true } } } } };
  const classes = await tx.schoolClass.findMany({
    where: classWhere,
    select: { id: true, name: true, major: { select: { name: true } } },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  if (!classes.length) return noTerm;
  const classIds = classes.map(row => row.id);
  const students = await tx.user.findMany({
    where: { role: "STUDENT", disabled: false, studentProfile: { is: { classId: { in: classIds } } } },
    select: { id: true, login: true, name: true, studentProfile: { select: { classId: true, className: true } } },
  });
  const studentIds = students.map(row => row.id);
  const studentById = new Map(students.map(row => [row.id, row]));
  const scheme = validateScheme(term.scheme);
  const gradeNodes = scheme.scheme.nodes.filter(node => node.kind === "GRADE");
  const requiredNodes = gradeNodes.filter(node => node.required);
  const requiredGradeCount = (requiredNodes.length ? requiredNodes : gradeNodes).length;
  const recognitionStatuses: RecognitionStatus[] = college ? ["PENDING_COLLEGE"] : ["PENDING_COUNSELOR"];
  const claimStatuses: ClaimStatus[] = college ? ["PENDING_COLLEGE"] : ["PENDING_COUNSELOR", "RESCORING"];
  const sourceScope: Prisma.RecognitionSourceWhereInput = { participation: { studentId: { in: studentIds }, activity: { termId: term.id } } };
  const changeScope = college
    ? { studentId: { in: studentIds } }
    : { submittedBy: actor.id };
  const [inputs, sources, claims, gradeChanges, deductionChanges, counts, activities] = await Promise.all([
    tx.gradeInput.groupBy({ by: ["studentId"], where: { termId: term.id, studentId: { in: studentIds } }, _count: { _all: true } }),
    tx.recognitionSource.findMany({
      where: { ...sourceScope, status: { in: recognitionStatuses } },
      select: { id: true, status: true, createdAt: true, participation: { select: { studentId: true, activity: { select: { name: true } } } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 40,
    }),
    tx.personalClaim.findMany({
      where: { termId: term.id, studentId: { in: studentIds }, status: { in: claimStatuses } },
      select: { id: true, title: true, status: true, createdAt: true, studentId: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 40,
    }),
    tx.gradeChange.findMany({
      where: { termId: term.id, ...changeScope, status: college ? "PENDING_COLLEGE" : "RETURNED" },
      select: { id: true, studentId: true, nodeId: true, value: true, baseValue: true, reason: true, status: true, submittedAt: true, reviewReason: true },
      orderBy: [{ submittedAt: "asc" }, { id: "asc" }], take: 40,
    }),
    tx.deductionChange.findMany({
      where: { termId: term.id, ...changeScope, status: college ? "PENDING_COLLEGE" : "RETURNED" },
      select: { id: true, studentId: true, projectId: true, action: true, amount: true, reason: true, status: true, submittedAt: true, reviewReason: true },
      orderBy: [{ submittedAt: "asc" }, { id: "asc" }], take: 40,
    }),
    Promise.all([
      tx.recognitionSource.count({ where: { ...sourceScope, status: { in: recognitionStatuses } } }),
      tx.personalClaim.count({ where: { termId: term.id, studentId: { in: studentIds }, status: { in: claimStatuses } } }),
      tx.gradeChange.count({ where: { termId: term.id, ...changeScope, status: college ? "PENDING_COLLEGE" : "RETURNED" } }),
      tx.deductionChange.count({ where: { termId: term.id, ...changeScope, status: college ? "PENDING_COLLEGE" : "RETURNED" } }),
      college && actor.collegeId
        ? tx.activity.count({ where: { termId: term.id, collegeId: actor.collegeId, publishedAt: { not: null }, rosterCommittedAt: null } })
        : Promise.resolve(0),
    ]),
    tx.activity.findMany({
      where: college && actor.collegeId
        ? { termId: term.id, collegeId: actor.collegeId, publishedAt: { not: null }, rosterCommittedAt: null }
        : { id: { in: [] } },
      select: { id: true, name: true, organizer: true, startsAt: true, endsAt: true, points: true, _count: { select: { participations: true } } },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }], take: 6,
    }),
  ]);
  const [pendingRecognitions, pendingClaims, pendingGradeChanges, pendingDeductionChanges, awaitingRoster] = counts;
  const buckets = new Map(classIds.map(id => [id, { students: 0, gradeComplete: 0, pendingRecognitions: 0, pendingClaims: 0, pendingGradeChanges: 0, pendingDeductionChanges: 0 }]));
  const entered = new Map(inputs.map(row => [row.studentId, row._count._all]));
  for (const student of students) {
    const bucket = buckets.get(student.studentProfile?.classId ?? "");
    if (!bucket) continue;
    bucket.students += 1;
    if (requiredGradeCount > 0 && (entered.get(student.id) ?? 0) >= requiredGradeCount) bucket.gradeComplete += 1;
  }
  const bump = (studentId: string, key: "pendingRecognitions" | "pendingClaims" | "pendingGradeChanges" | "pendingDeductionChanges") => {
    const bucket = buckets.get(studentById.get(studentId)?.studentProfile?.classId ?? "");
    if (bucket) bucket[key] += 1;
  };
  for (const row of sources) bump(row.participation.studentId, "pendingRecognitions");
  for (const row of claims) bump(row.studentId, "pendingClaims");
  for (const row of gradeChanges) bump(row.studentId, "pendingGradeChanges");
  for (const row of deductionChanges) bump(row.studentId, "pendingDeductionChanges");
  const progress: ClassProgress[] = classes.map(row => ({
    id: row.id, name: row.name, major: row.major.name, ...buckets.get(row.id)!,
  }));
  const gradeIncomplete = students.length - [...buckets.values()].reduce((sum, bucket) => sum + bucket.gradeComplete, 0);
  const studentLabel = (studentId: string) => {
    const student = studentById.get(studentId);
    return student ? [student.name, student.login, student.studentProfile?.className].filter(Boolean).join(" · ") : "学生档案不可用";
  };
  const nodeName = (nodeId: string) => gradeNodes.find(node => node.id === nodeId)?.name ?? nodeId;
  const projectName = (projectId: string) => scheme.scheme.deductions.find(item => item.id === projectId)?.name ?? projectId;
  const todos: WorkItem[] = [
    ...sources.map(row => ({
      id: row.id, kind: "ACTIVITY" as const, title: row.participation.activity.name,
      description: studentLabel(row.participation.studentId), status: row.status, at: row.createdAt,
      href: url("/recognitions", term.id, row.status),
    })),
    ...claims.map(row => ({
      id: row.id, kind: "CLAIM" as const, title: row.title,
      description: studentLabel(row.studentId), status: row.status, at: row.createdAt,
      href: url("/claims", term.id, row.status),
    })),
    ...gradeChanges.map(row => ({
      id: row.id, kind: "GRADE" as const,
      title: `${nodeName(row.nodeId)} · ${studentById.get(row.studentId)?.name ?? "学生档案不可用"}`,
      description: row.status === "RETURNED"
        ? `学院退回：${row.reviewReason || "请修改后重新提交"}`
        : `${row.baseValue ? `当前 ${row.baseValue.toFixed()} 分 → ` : ""}修改后 ${row.value.toFixed()} 分；${row.reason}`,
      status: row.status, at: row.submittedAt, href: url("/grades", term.id),
    })),
    ...deductionChanges.map(row => ({
      id: row.id, kind: "DEDUCTION" as const,
      title: `${projectName(row.projectId)} · ${studentById.get(row.studentId)?.name ?? "学生档案不可用"}`,
      description: row.status === "RETURNED"
        ? `学院退回：${row.reviewReason || "请修改后重新提交"}`
        : `${row.action === "REVOKE" ? "申请取消扣分" : `新增扣分 ${row.amount?.toFixed() ?? ""} 分`}；${row.reason}`,
      status: row.status, at: row.submittedAt, href: url("/deductions", term.id),
    })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime() || a.id.localeCompare(b.id)).slice(0, 10);
  if (college) return {
    ...base, role: "COLLEGE",
    stats: { pendingRecognitions, pendingClaims, pendingGradeChanges, pendingDeductionChanges, awaitingRoster, gradeIncomplete, classes: classes.length, students: students.length },
    todos, classes: progress,
    activities: activities.map(row => ({
      id: row.id, name: row.name, organizer: row.organizer, startsAt: row.startsAt, endsAt: row.endsAt,
      points: row.points.toFixed(), participantCount: row._count.participations,
    })),
  };
  return {
    ...base, role: "COUNSELOR",
    stats: { pendingRecognitions, pendingClaims, returnedChanges: pendingGradeChanges + pendingDeductionChanges, gradeIncomplete, classes: classes.length, students: students.length },
    todos, classes: progress,
  };
}

export async function getWorkbench(sessionId: string, requestedTermId?: string): Promise<WorkbenchData> {
  const termId = z.string().min(1).max(100).optional().parse(requestedTermId);
  return db.$transaction(async tx => {
    // Lock in the same account -> period order as writes. READ COMMITTED makes
    // authorization observe any writer that completed while these locks waited.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(72109312)`;
    if (termId) await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${termId}, 72109313))`;
    const session = await tx.authSession.findUnique({ where: { id: sessionId }, select: { userId: true, revokedAt: true, expiresAt: true, version: true, user: { select: { id: true, login: true, name: true, role: true, disabled: true, mustChangePassword: true, authVersion: true, collegeId: true } } } });
    if (!session || session.revokedAt || session.expiresAt <= new Date() || session.user.disabled || session.version !== session.user.authVersion) throw new AccountError("会话已失效，请重新登录", 401);
    if (session.user.mustChangePassword) throw new AccountError("请先修改初始密码", 403);
    const term = termId ? await tx.term.findUnique({ where: { id: termId } }) : null;
    if (termId && (!term || term.disposition === "DELETED")) throw new AccountError("测评周期不存在", 404);
    const base: Base = { role: session.user.role, user: { id: session.user.id, name: session.user.name, login: session.user.login }, term: term ? { id: term.id, name: term.name, phase: term.phase, revision: term.revision, inputRevision: term.inputRevision } : null };
    if (session.user.role === "ADMIN") return administrator(tx, base);
    if (session.user.role === "PUBLISHER") return publisher(tx, base);
    if (session.user.role === "COLLEGE" || session.user.role === "COUNSELOR") return staff(tx, base, term, { id: session.user.id, role: session.user.role, collegeId: session.user.collegeId });
    return student(tx, base, term);
  }, { isolationLevel: "ReadCommitted", timeout: 15_000 });
}
