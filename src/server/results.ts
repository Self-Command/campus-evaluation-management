import { AccountError } from "@/server/accounts";
import { termTransaction } from "@/server/terms";
import { calculate } from "@/lib/scoring/calculate";
import { Rational } from "@/lib/scoring/rational";
import { validateScheme } from "@/lib/scoring/validate";
import { Prisma, type Term } from "@/generated/prisma/client";
import { studentFilters, studentDirectoryWhere, studentScopeOptions } from "@/server/students";
import { effectiveCheckingDeadline } from "@/server/publication-window";

export const resultStudentSelect = { id: true, login: true, name: true, studentProfile: true } as const;
export type ResultStudent = Prisma.UserGetPayload<{ select: typeof resultStudentSelect }>;

export type ScoringOverride = { activity?: { id: string; nodeId: string; points: string; scoreMode: string }; project?: { id: string; nodeId: string; points: string } };
export async function collectStudentResults(tx: Prisma.TransactionClient, term: Term, students: ResultStudent[], override: ScoringOverride = {}) {
  const ids = students.map(s => s.id);
  const [facts, grades, deductions, claims] = await Promise.all([
    tx.participation.findMany({ where: { studentId: { in: ids }, activity: { termId: term.id, confirmed: true }, sources: { some: { status: "APPROVED" } } }, include: { activity: true, sources: { where: { status: "APPROVED" }, select: { id: true, reviewReason: true, evidence: { select: { evidenceId: true } } } } }, orderBy: { id: "asc" } }),
    tx.gradeInput.findMany({ where: { termId: term.id, studentId: { in: ids } }, orderBy: { id: "asc" } }),
    tx.deductionInput.findMany({ where: { termId: term.id, studentId: { in: ids }, revoked: false }, orderBy: { id: "asc" } }),
    tx.personalClaim.findMany({ where: { studentId: { in: ids }, status: "APPROVED", project: { termId: term.id } }, include: { project: true, evidence: { select: { evidenceId: true } } }, orderBy: { id: "asc" } }),
  ]);
  for (const fact of facts) if (override.activity?.id === fact.activityId) fact.activity = { ...fact.activity, ...override.activity, points: new Prisma.Decimal(override.activity.points) };
  for (const claim of claims) if (override.project?.id === claim.projectId) claim.project = { ...claim.project, ...override.project, points: new Prisma.Decimal(override.project.points) };
  const { nodes, scheme } = validateScheme(term.scheme);
  return students.map(student => {
    const participations = facts.filter(f => f.studentId === student.id);
    const personal = claims.filter(c => c.studentId === student.id);
    const studentGrades = grades.filter(g => g.studentId === student.id);
    const studentDeductions = deductions.filter(d => d.studentId === student.id);
    const totals = new Map<string, Rational>();
    const missingActivityScores: { id: string; name: string }[] = [];
    for (const fact of participations) {
      if (nodes.get(fact.activity.nodeId)?.kind !== "ACTIVITY") throw new AccountError("有效参与记录的评分归属无效，请联系管理员", 409);
      if (fact.activity.scoreMode === "INDIVIDUAL" && fact.score === null) { missingActivityScores.push({ id: fact.id, name: `${fact.activity.name}：个人活动分数未录入` }); continue; }
      const points = fact.activity.scoreMode === "INDIVIDUAL" ? fact.score! : fact.activity.points;
      totals.set(fact.activity.nodeId, (totals.get(fact.activity.nodeId) ?? Rational.from("0")).add(Rational.from(points.toFixed())));
    }
    for (const claim of personal) {
      if (nodes.get(claim.project.nodeId)?.kind !== "ACTIVITY") throw new AccountError("个人申报的评分归属无效，请联系管理员", 409);
      totals.set(claim.project.nodeId, (totals.get(claim.project.nodeId) ?? Rational.from("0")).add(Rational.from(claim.project.points.toFixed())));
    }
    const values = Object.fromEntries([...totals].map(([id, value]) => [id, value.fixed(12)]));
    for (const grade of studentGrades) {
      if (nodes.get(grade.nodeId)?.kind !== "GRADE") throw new AccountError("成绩记录的评分归属无效，请联系管理员", 409);
      values[grade.nodeId] = grade.value.toFixed();
    }
    const result = calculate(term.scheme, { values, deductions: Object.fromEntries(studentDeductions.map(d => [d.projectId, d.amount.toFixed()])) });
    if (missingActivityScores.length) { result.complete = false; result.total = null; result.missing.push(...missingActivityScores); }
    return {
      term: { id: term.id, name: term.name, phase: term.phase, revision: term.revision, inputRevision: term.inputRevision },
      student: { id: student.id, login: student.login, name: student.name, profile: student.studentProfile }, result,
      grades: studentGrades.map(g => ({ id: g.id, nodeId: g.nodeId, name: nodes.get(g.nodeId)!.name, value: g.value.toFixed(), revision: g.revision })),
      deductions: studentDeductions.map(item => {
        const project = scheme.deductions.find(project => project.id === item.projectId);
        if (!project) throw new AccountError("扣分项目已失效", 409);
        return { id: item.id, projectId: item.projectId, name: project.name, nodeName: nodes.get(project.nodeId)!.name, coefficient: project.coefficient, amount: item.amount.toFixed(), reason: item.reason };
      }),
      participations: participations.map(fact => ({ id: fact.id, activityId: fact.activity.id, name: fact.activity.name, nodeId: fact.activity.nodeId, points: (fact.activity.scoreMode === "INDIVIDUAL" ? fact.score : fact.activity.points)?.toFixed() ?? null, approvedSourceCount: fact.sources.length, sources: fact.sources })),
      claims: personal.map(c => ({ id: c.id, projectId: c.projectId, name: c.project.name, factKey: c.factKey, occurredOn: c.occurredOn, nodeId: c.project.nodeId, points: c.project.points.toFixed(), note: c.note, reviewReason: c.reviewReason, evidenceIds: c.evidence.map(e => e.evidenceId) })),
    };
  });
}
export type StudentResultPayload = Awaited<ReturnType<typeof collectStudentResults>>[number];
export function cents(value: string) { const sign = value.startsWith("-") ? -1n : 1n; const [whole, fraction = ""] = value.replace(/^-/, "").split("."); return sign * (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2))); }
export function ranked<T extends { total: { toFixed(places: number): string }; login: string; studentId: string }>(rows: T[]) {
  const sorted = [...rows].sort((a, b) => { const av = cents(a.total.toFixed(2)), bv = cents(b.total.toFixed(2)); return av > bv ? -1 : av < bv ? 1 : a.login.localeCompare(b.login, "en"); });
  let previous: bigint | undefined, rank = 0;
  return sorted.map((row, index) => { const value = cents(row.total.toFixed(2)); if (value !== previous) rank = index + 1; previous = value; return { ...row, rank }; });
}
export async function pageResultStudents(sessionId: string, termId: string, input: unknown) {
  const filters = studentFilters.parse(input);
  return termTransaction(sessionId, termId, ["ADMIN"], ["CONFIGURATION", "ACTIVE", "CHECKING", "LOCKED"], async (tx, term) => {
    if (term.phase === "CHECKING" || term.phase === "LOCKED") {
      if (!term.publishedResultSetId) throw new AccountError("本周期尚未发布结果", 409);
      const publication = await tx.resultPublication.findUniqueOrThrow({ where: { id: term.publishedResultSetId }, select: { id: true, sequence: true } });
      // Publication size is bounded at creation. Read frozen identity and scores only,
      // so disabled/transferred accounts cannot change the historical directory.
      const all = await tx.publishedResult.findMany({ where: { publicationId: publication.id }, select: { studentId: true, name: true, login: true, college: true, major: true, className: true, total: true, confirmation: { select: { confirmedAt: true } } }, orderBy: [{ login: "asc" }, { studentId: "asc" }] });
      const q = filters.q.toLocaleLowerCase();
      const matching = all.filter(row => (!q || row.name.toLocaleLowerCase().includes(q) || row.login.toLocaleLowerCase().includes(q)) && (!filters.college || row.college === filters.college) && (!filters.major || row.major === filters.major) && (!filters.className || row.className === filters.className));
      return { items: matching.slice((filters.page - 1) * 20, filters.page * 20).map(row => ({ id: row.studentId, login: row.login, name: row.name, college: row.college, major: row.major, className: row.className, total: row.total.toFixed(2), complete: true, confirmedAt: row.confirmation?.confirmedAt ?? null })), total: matching.length, page: filters.page, phase: term.phase, publication, scopeOptions: studentScopeOptions(all, filters) };
    }
    if (term.phase === "ACTIVE" && term.cohortPolicy === "PREVIOUS" && term.cohortPublicationId) {
      const frozen = await tx.publishedResult.findMany({ where: { publicationId: term.cohortPublicationId }, orderBy: [{ login: "asc" }, { studentId: "asc" }] });
      const q = filters.q.toLocaleLowerCase();
      const matching = frozen.filter(row => (!q || row.name.toLocaleLowerCase().includes(q) || row.login.toLocaleLowerCase().includes(q)) && (!filters.college || row.college === filters.college) && (!filters.major || row.major === filters.major) && (!filters.className || row.className === filters.className));
      const students = matching.slice((filters.page - 1) * 20, filters.page * 20).map(row => frozenResultStudent(row));
      const computed = await collectStudentResults(tx, term, students);
      return { items: students.map((student, index) => ({ id: student.id, login: student.login, name: student.name, college: student.studentProfile!.college, major: student.studentProfile!.major, className: student.studentProfile!.className, total: computed[index].result.total, complete: computed[index].result.complete, confirmedAt: null })), total: matching.length, page: filters.page, phase: term.phase, publication: null, scopeOptions: studentScopeOptions(frozen, filters) };
    }
    const where = studentDirectoryWhere(filters, true);
    const [students, total, scope] = await Promise.all([
      tx.user.findMany({ where, select: resultStudentSelect, orderBy: [{ login: "asc" }, { id: "asc" }], take: 20, skip: (filters.page - 1) * 20 }),
      tx.user.count({ where }),
      tx.studentProfile.findMany({ where: { user: { role: "STUDENT", disabled: false } }, select: { college: true, major: true, className: true }, distinct: ["college", "major", "className"] }),
    ]);
    const computed = term.phase === "ACTIVE" ? await collectStudentResults(tx, term, students) : [];
    return { items: students.map((student, index) => ({ id: student.id, login: student.login, name: student.name, college: student.studentProfile!.college, major: student.studentProfile!.major, className: student.studentProfile!.className, total: computed[index]?.result.total ?? null, complete: computed[index]?.result.complete ?? null, confirmedAt: null })), total, page: filters.page, phase: term.phase, publication: null, scopeOptions: studentScopeOptions(scope, filters) };
  });
}
export async function getStudentResult(sessionId: string, termId: string, studentId?: string) {
  return termTransaction(sessionId, termId, ["ADMIN", "STUDENT"], ["ACTIVE", "CHECKING", "LOCKED"], async (tx, term, actorId) => {
    const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId } });
    if (actor.role === "STUDENT" && studentId && studentId !== actorId) throw new AccountError("只能查看本人测评结果", 403);
    const targetId = actor.role === "STUDENT" ? actorId : studentId;
    if (!targetId) throw new AccountError("请选择学生");
    if (term.phase !== "ACTIVE") {
      if (!term.publishedResultSetId) throw new AccountError("本周期尚未发布结果", 409);
      const record = await tx.publishedResult.findUnique({ where: { publicationId_studentId: { publicationId: term.publishedResultSetId, studentId: targetId } }, include: { publication: true, confirmation: true } });
      if (!record) throw new AccountError("该学生不在本次发布范围内", 404);
      const ranking = ranked(await tx.publishedResult.findMany({ where: { publicationId: term.publishedResultSetId }, select: { total: true, login: true, studentId: true } }));
      const payload = record.payload as unknown as StudentResultPayload;
      return { ...payload, term: { ...payload.term, phase: term.phase }, publication: { id: record.publication.id, sequence: record.publication.sequence, publishedAt: record.publication.publishedAt, checkingEndsAt: await effectiveCheckingDeadline(tx, record.publication), requireConfirmation: record.publication.requireConfirmation }, resultHash: record.resultHash, confirmation: record.confirmation, rank: ranking.find(r => r.studentId === targetId)?.rank ?? null, population: ranking.length };
    }
    const frozen = term.cohortPolicy === "PREVIOUS" && term.cohortPublicationId ? await tx.publishedResult.findUnique({ where: { publicationId_studentId: { publicationId: term.cohortPublicationId, studentId: targetId } } }) : null;
    const student = frozen ? frozenResultStudent(frozen) : term.cohortPolicy === "PREVIOUS" && term.cohortPublicationId ? null : await tx.user.findFirst({ where: { id: targetId, role: "STUDENT", disabled: false, studentProfile: { isNot: null } }, select: resultStudentSelect });
    if (!student) throw new AccountError("学生账号或档案无效", 404);
    return (await collectStudentResults(tx, term, [student]))[0];
  });
}
function frozenResultStudent(row: { studentId: string; login: string; name: string; college: string; major: string; className: string }): ResultStudent {
  return { id: row.studentId, login: row.login, name: row.name, studentProfile: { userId: row.studentId, studentNumber: row.login, college: row.college, major: row.major, className: row.className } };
}
