import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { AccountError } from "@/server/accounts";
import { termTransaction } from "@/server/terms";
import { collectStudentResults, resultStudentSelect, ranked } from "@/server/results";
import { jsonValue } from "@/server/claims";
import type { Prisma, Term } from "@/generated/prisma/client";
import { issueFlowToken, verifyFlowToken } from "@/server/flow-token";
import { effectiveCheckingDeadline } from "@/server/publication-window";

const phases = ["CONFIGURATION", "ACTIVE", "CHECKING", "LOCKED"] as const;
const revisionSchema = z.number().int().nonnegative();
function canonical(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if ("toJSON" in value && typeof value.toJSON === "function") return canonical(value.toJSON());
  if (Array.isArray(value)) return value.map(canonical);
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, canonical(v)]));
}
export const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
export const publicationSelect = { id: true, termId: true, sequence: true, actorId: true, publishedAt: true, checkingEndsAt: true, requireConfirmation: true, studentCount: true, termRevision: true, inputRevision: true } as const;
async function candidate(tx: Prisma.TransactionClient, term: Term) {
  const where = { role: "STUDENT" as const, disabled: false, studentProfile: { isNot: null } };
  const studentCount = await tx.user.count({ where });
  if (studentCount > 2000) throw new AccountError("当前有效学生超过单周期2000人的处理上限，无法完整核对名录变化；请联系管理员调整处理容量，本次未发布", 409);
  const currentStudents = await tx.user.findMany({ where, select: resultStudentSelect, orderBy: { id: "asc" }, take: 2001 });
  const frozen = term.cohortPublicationId ? await tx.publishedResult.findMany({ where: { publicationId: term.cohortPublicationId }, orderBy: { studentId: "asc" } }) : [];
  const students = term.cohortPolicy === "PREVIOUS" && term.cohortPublicationId ? frozen.map(student => ({ id: student.studentId, login: student.login, name: student.name, studentProfile: { userId: student.studentId, studentNumber: student.login, college: student.college, major: student.major, className: student.className } })) : currentStudents;
  if (students.length > 2000) throw new AccountError("本次参评名单超过2000人的处理上限，本次未发布", 409);
  const records = await collectStudentResults(tx, term, students);
  const [recognitionsPending, recognitionsNeedsChanges, claimsPending, claimsNeedsChanges] = await Promise.all([
    tx.recognitionSource.count({ where: { participation: { activity: { termId: term.id } }, status: "PENDING" } }),
    tx.recognitionSource.count({ where: { participation: { activity: { termId: term.id } }, status: "NEEDS_CHANGES" } }),
    tx.personalClaim.count({ where: { project: { termId: term.id }, status: "PENDING" } }),
    tx.personalClaim.count({ where: { project: { termId: term.id }, status: "NEEDS_CHANGES" } }),
  ]);
  const reviewBreakdown = { recognitionsPending, recognitionsNeedsChanges, claimsPending, claimsNeedsChanges };
  const pendingReviews = Object.values(reviewBreakdown).reduce((sum, count) => sum + count, 0);
  const missing = records.filter(r => !r.result.complete).map(r => ({ studentId: r.student.id, login: r.student.login, name: r.student.name, nodes: r.result.missing }));
  const oldIds = new Set(frozen.map(student => student.studentId)), currentIds = new Set(currentStudents.map(student => student.id));
  const cohortChanges = { added: currentStudents.filter(student => !oldIds.has(student.id)).map(student => ({ studentId: student.id, login: student.login, name: student.name })), removed: frozen.filter(student => !currentIds.has(student.studentId)).map(student => ({ studentId: student.studentId, login: student.login, name: student.name })) };
  const identities = await tx.user.findMany({ where: { id: { in: [...new Set([...students.map(student => student.id), ...currentStudents.map(student => student.id)])] } }, select: { id: true, login: true, name: true, role: true, disabled: true, revision: true, studentProfile: true }, orderBy: { id: "asc" } });
  return { records, studentCount: records.length, pendingReviews, reviewBreakdown, missing, cohortChanges, cohortPolicy: term.cohortPolicy, currentStudentCount: studentCount, canPublish: records.length > 0 && !pendingReviews && !missing.length, binding: { termId: term.id, termRevision: term.revision, inputRevision: term.inputRevision, cohortPolicy: term.cohortPolicy, cohortPublicationId: term.cohortPublicationId, identities, records, reviewBreakdown, currentStudentCount: studentCount } };
}
export async function previewPublication(sessionId: string, termId: string) {
  return termTransaction(sessionId, termId, ["ADMIN"], ["ACTIVE"], async (tx, term, actorId) => {
    const preview = await candidate(tx, term);
    return { termRevision: term.revision, inputRevision: term.inputRevision, studentCount: preview.studentCount, pendingReviews: preview.pendingReviews, reviewBreakdown: preview.reviewBreakdown, missing: preview.missing, canPublish: preview.canPublish, cohortPolicy: preview.cohortPolicy, cohortChanges: preview.cohortChanges, currentStudentCount: preview.currentStudentCount, ...issueFlowToken(actorId, "RESULT_PUBLICATION", preview.binding) };
  });
}
const publishSchema = z.object({ revision: revisionSchema, inputRevision: revisionSchema, checkingEndsAt: z.iso.datetime(), requireConfirmation: z.boolean(), requestId: z.uuid(), token: z.string().min(10).max(4000) });
export async function publishResults(sessionId: string, termId: string, input: unknown) {
  const data = publishSchema.parse(input);
  const requestHash = digest({ revision: data.revision, inputRevision: data.inputRevision, checkingEndsAt: data.checkingEndsAt, requireConfirmation: data.requireConfirmation });
  return termTransaction(sessionId, termId, ["ADMIN"], [...phases], async (tx, term, actorId) => {
    const previous = await tx.resultPublication.findUnique({ where: { termId_requestId: { termId, requestId: data.requestId } }, select: { ...publicationSelect, requestHash: true } });
    if (previous) {
      if (previous.actorId !== actorId || previous.requestHash !== requestHash) throw new AccountError("该请求标识已用于其他发布操作", 409);
      return { id: previous.id, termId: previous.termId, sequence: previous.sequence, actorId: previous.actorId, publishedAt: previous.publishedAt, checkingEndsAt: previous.checkingEndsAt, requireConfirmation: previous.requireConfirmation, studentCount: previous.studentCount, termRevision: previous.termRevision, inputRevision: previous.inputRevision, replay: true };
    }
    if (term.phase !== "ACTIVE") throw new AccountError("仅申报审核阶段可发布；更正请先填写理由重开", 409);
    if (term.revision !== data.revision || term.inputRevision !== data.inputRevision) throw new AccountError("周期或计分输入已变化，请重新预检", 409);
    const end = new Date(data.checkingEndsAt);
    if (end <= new Date() || end.getTime() > Date.now() + 366 * 86400_000) throw new AccountError("核对截止时间须晚于现在且在一年以内");
    const preview = await candidate(tx, term);
    verifyFlowToken(data.token, actorId, "RESULT_PUBLICATION", preview.binding);
    if (!preview.canPublish) throw new AccountError(`发布被阻断：${preview.studentCount ? "" : "没有有效参评学生；"}${preview.pendingReviews}项待审或待补充，${preview.missing.length}名学生缺少必需成绩`, 409);
    const publication = await tx.resultPublication.create({ data: { termId, sequence: term.publicationSequence + 1, actorId, requestId: data.requestId, requestHash, scheme: jsonValue(term.scheme), termRevision: term.revision + 1, inputRevision: term.inputRevision, studentCount: preview.studentCount, checkingEndsAt: end, requireConfirmation: data.requireConfirmation } });
    await tx.publishedResult.createMany({ data: preview.records.map(payload => {
      const profile = payload.student.profile!;
      const meaning = { student: payload.student, result: payload.result, grades: payload.grades, deductions: payload.deductions, participations: payload.participations, claims: payload.claims };
      return { publicationId: publication.id, studentId: payload.student.id, login: payload.student.login, name: payload.student.name, college: profile.college, major: profile.major, className: profile.className, total: payload.result.total!, resultHash: digest(meaning), payload: jsonValue(payload) };
    }) });
    await tx.term.update({ where: { id: termId }, data: { phase: "CHECKING", publishedResultSetId: publication.id, cohortPublicationId: publication.id, publicationSequence: publication.sequence, revision: { increment: 1 } } });
    await tx.auditEvent.create({ data: { actorId, action: "RESULTS_PUBLISHED", targetId: publication.id, details: { termId, sequence: publication.sequence, studentCount: preview.studentCount, inputRevision: term.inputRevision, checkingEndsAt: data.checkingEndsAt, requireConfirmation: data.requireConfirmation } } });
    return { id: publication.id, sequence: publication.sequence, publishedAt: publication.publishedAt, checkingEndsAt: publication.checkingEndsAt, studentCount: publication.studentCount, requireConfirmation: publication.requireConfirmation, replay: false };
  });
}
export async function publicationHistory(sessionId: string, termId: string) {
  return termTransaction(sessionId, termId, ["ADMIN"], [...phases], async (tx, term) => {
    const publications = await tx.resultPublication.findMany({ where: { termId }, select: publicationSelect, orderBy: { sequence: "desc" } });
    const history = await Promise.all(publications.map(async publication => ({ ...publication, effectiveCheckingEndsAt: await effectiveCheckingDeadline(tx, publication), extensions: await tx.publicationExtension.findMany({ where: { publicationId: publication.id }, select: { id: true, actorId: true, checkingEndsAt: true, reason: true, createdAt: true }, orderBy: { createdAt: "desc" } }) })));
    return { term: { id: term.id, name: term.name, phase: term.phase, revision: term.revision, inputRevision: term.inputRevision, cohortPolicy: term.cohortPolicy, cohortPublicationId: term.cohortPublicationId }, current: history.find(p => p.id === term.publishedResultSetId) ?? null, history };
  });
}
export async function confirmResult(sessionId: string, termId: string, publicationId: string, resultHash: string) {
  z.string().regex(/^[a-f0-9]{64}$/).parse(resultHash);
  return termTransaction(sessionId, termId, ["STUDENT"], ["CHECKING", "LOCKED"], async (tx, term, actorId) => {
    if (term.publishedResultSetId !== publicationId) throw new AccountError("发布结果已变化，请重新核对当前版本", 409);
    const result = await tx.publishedResult.findUnique({ where: { publicationId_studentId: { publicationId, studentId: actorId } }, include: { publication: true, confirmation: true } });
    if (!result || result.resultHash !== resultHash) throw new AccountError("结果已变化或不属于本人，请重新核对", 409);
    if (result.confirmation) return result.confirmation;
    if (term.phase !== "CHECKING" || await effectiveCheckingDeadline(tx, result.publication) <= new Date()) throw new AccountError("核对时间已结束", 409);
    const confirmation = await tx.resultConfirmation.create({ data: { resultId: result.id, studentId: actorId, resultHash } });
    await tx.auditEvent.create({ data: { actorId, action: "RESULT_CONFIRMED", targetId: result.id, details: { termId, publicationId, resultHash } } });
    return confirmation;
  });
}

async function settlementState(tx: Prisma.TransactionClient, term: Term) {
  const publication = term.publishedResultSetId ? await tx.resultPublication.findUnique({ where: { id: term.publishedResultSetId } }) : null;
  const blockers: { type: string; message: string; count: number }[] = [];
  if (term.phase !== "CHECKING") blockers.push({ type: "PHASE", message: "仅核对阶段可锁定结算", count: 1 });
  if (!publication) blockers.push({ type: "PUBLICATION", message: "尚未发布完整结果", count: 1 });
  else {
    if (publication.inputRevision !== term.inputRevision || digest(publication.scheme) !== digest(term.scheme)) blockers.push({ type: "STALE", message: "当前输入或评分规则与发布版本不一致", count: 1 });
    if (await effectiveCheckingDeadline(tx, publication) > new Date()) blockers.push({ type: "DEADLINE", message: "核对截止时间尚未到达", count: 1 });
  }
  const confirmedCount = publication ? await tx.resultConfirmation.count({ where: { result: { publicationId: publication.id } } }) : 0;
  if (publication?.requireConfirmation && confirmedCount < publication.studentCount) blockers.push({ type: "CONFIRMATIONS", message: "仍有学生未确认本次结果", count: publication.studentCount - confirmedCount });
  const appeals = await tx.resultAppeal.count({ where: { termId: term.id, status: { in: ["OPEN", "PROCESSING"] } } });
  if (appeals) blockers.push({ type: "APPEALS", message: "仍有未处理完毕的异议", count: appeals });
  const [recognitionsPending, recognitionsNeedsChanges, claimsPending, claimsNeedsChanges] = await Promise.all([
    tx.recognitionSource.count({ where: { participation: { activity: { termId: term.id } }, status: "PENDING" } }),
    tx.recognitionSource.count({ where: { participation: { activity: { termId: term.id } }, status: "NEEDS_CHANGES" } }),
    tx.personalClaim.count({ where: { project: { termId: term.id }, status: "PENDING" } }),
    tx.personalClaim.count({ where: { project: { termId: term.id }, status: "NEEDS_CHANGES" } }),
  ]);
  const reviewBreakdown = { recognitionsPending, recognitionsNeedsChanges, claimsPending, claimsNeedsChanges };
  const pending = Object.values(reviewBreakdown).reduce((sum, count) => sum + count, 0);
  if (pending) blockers.push({ type: "REVIEWS", message: "仍有待审或待补充的申报", count: pending });
  return { revision: term.revision, inputRevision: term.inputRevision, publicationId: publication?.id ?? null, studentCount: publication?.studentCount ?? 0, confirmedCount, reviewBreakdown, blockers };
}
function signature(content: string) {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new AccountError("服务安全配置不完整", 500);
  return createHmac("sha256", secret).update(content).digest("base64url");
}
export async function previewSettlement(sessionId: string, termId: string) {
  return termTransaction(sessionId, termId, ["ADMIN"], [...phases], async (tx, term, actorId) => {
    const state = await settlementState(tx, term), expiresAt = new Date(Date.now() + 900_000).toISOString();
    const encoded = Buffer.from(JSON.stringify({ actorId, termId, stateHash: digest(state), expiresAt })).toString("base64url");
    return { ...state, token: `${encoded}.${signature(encoded)}`, expiresAt };
  });
}
export async function lockSettlement(sessionId: string, termId: string, input: unknown) {
  const data = z.object({ revision: revisionSchema, token: z.string().min(10).max(4000), requestId: z.uuid() }).parse(input);
  return termTransaction(sessionId, termId, ["ADMIN"], ["CHECKING", "LOCKED"], async (tx, term, actorId) => {
    const previous = await tx.settlementSnapshot.findUnique({ where: { termId_requestId: { termId, requestId: data.requestId } } });
    if (previous) {
      if (previous.actorId !== actorId) throw new AccountError("该请求标识已使用", 409);
      return { id: previous.id, sha256: previous.sha256, createdAt: previous.createdAt, replay: true };
    }
    if (term.phase !== "CHECKING" || term.revision !== data.revision) throw new AccountError("周期已变化，请重新预检", 409);
    const [encoded, supplied] = data.token.split(".");
    const expected = signature(encoded);
    if (!supplied || supplied.length !== expected.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) throw new AccountError("锁定预检无效，请重新预检", 409);
    let token: { actorId: string; termId: string; stateHash: string; expiresAt: string };
    try { token = JSON.parse(Buffer.from(encoded, "base64url").toString()); } catch { throw new AccountError("锁定预检无效", 409); }
    const state = await settlementState(tx, term);
    if (token.actorId !== actorId || token.termId !== termId || new Date(token.expiresAt) <= new Date() || token.stateHash !== digest(state)) throw new AccountError("锁定预检已过期或业务状态已变化，请重新预检", 409);
    if (state.blockers.length || !state.publicationId) throw new AccountError(state.blockers.map(b => b.message).join("；"), 409);
    const publication = await tx.resultPublication.findUniqueOrThrow({ where: { id: state.publicationId } });
    const results = ranked(await tx.publishedResult.findMany({ where: { publicationId: publication.id }, include: { confirmation: true } }));
    const appeals = await tx.resultAppeal.findMany({ where: { termId }, orderBy: { createdAt: "asc" } });
    const extensions = await tx.publicationExtension.findMany({ where: { publicationId: publication.id }, orderBy: { createdAt: "asc" } });
    const payload = jsonValue({ format: 1, term: { id: term.id, name: term.name, revision: term.revision, inputRevision: term.inputRevision }, publication: { ...publication, requestHash: undefined }, effectiveCheckingEndsAt: await effectiveCheckingDeadline(tx, publication), extensions, rankingPolicy: "DISPLAY_TWO_DECIMALS_COMPETITION", results, appeals });
    const snapshot = await tx.settlementSnapshot.create({ data: { termId, publicationId: publication.id, actorId, requestId: data.requestId, payload, sha256: digest(payload) } });
    await tx.term.update({ where: { id: termId }, data: { phase: "LOCKED", revision: { increment: 1 } } });
    await tx.auditEvent.create({ data: { actorId, action: "TERM_LOCKED", targetId: snapshot.id, details: { termId, publicationId: publication.id, sha256: snapshot.sha256 } } });
    return { id: snapshot.id, sha256: snapshot.sha256, createdAt: snapshot.createdAt, replay: false };
  });
}
export async function reopenTerm(sessionId: string, termId: string, input: unknown) {
  const data = z.object({ revision: revisionSchema, reason: z.string().trim().min(2).max(1000) }).parse(input);
  return termTransaction(sessionId, termId, ["ADMIN"], ["CHECKING", "LOCKED"], async (tx, term, actorId) => {
    if (term.revision !== data.revision) throw new AccountError("周期已变化，请刷新", 409);
    const snapshot = term.publishedResultSetId ? await tx.settlementSnapshot.findUnique({ where: { publicationId: term.publishedResultSetId } }) : null;
    const reopening = await tx.termReopen.create({ data: { termId, publicationId: term.publishedResultSetId, snapshotId: snapshot?.id, actorId, reason: data.reason, previousPhase: term.phase } });
    const updated = await tx.term.update({ where: { id: termId }, data: { phase: "ACTIVE", cohortPublicationId: term.publishedResultSetId, cohortPolicy: "PREVIOUS", publishedResultSetId: null, revision: { increment: 1 } } });
    await tx.auditEvent.create({ data: { actorId, action: "TERM_REOPENED", targetId: reopening.id, details: { termId, reason: data.reason, previousPhase: term.phase, snapshotId: snapshot?.id ?? null } } });
    return updated;
  });
}
export async function listSnapshots(sessionId: string, termId: string) {
  return termTransaction(sessionId, termId, ["ADMIN"], [...phases], (tx) => tx.settlementSnapshot.findMany({ where: { termId }, select: { id: true, termId: true, publicationId: true, actorId: true, sha256: true, createdAt: true }, orderBy: { createdAt: "desc" } }));
}
export async function extendChecking(sessionId: string, termId: string, input: unknown) {
  const data = z.object({ revision: revisionSchema, publicationId: z.string(), checkingEndsAt: z.iso.datetime(), reason: z.string().trim().min(2).max(1000) }).parse(input);
  return termTransaction(sessionId, termId, ["ADMIN"], ["CHECKING"], async (tx, term, actorId) => {
    if (term.revision !== data.revision || term.publishedResultSetId !== data.publicationId) throw new AccountError("核对状态或发布版本已变化，请刷新", 409);
    const publication = await tx.resultPublication.findUniqueOrThrow({ where: { id: data.publicationId } });
    const previousDeadline = await effectiveCheckingDeadline(tx, publication), next = new Date(data.checkingEndsAt);
    if (next <= previousDeadline || next <= new Date() || next.getTime() > Date.now() + 366 * 86400_000) throw new AccountError("新截止时间须晚于当前截止及现在，且在一年以内");
    const extension = await tx.publicationExtension.create({ data: { publicationId: publication.id, actorId, checkingEndsAt: next, reason: data.reason } });
    await tx.term.update({ where: { id: termId }, data: { revision: { increment: 1 } } });
    await tx.auditEvent.create({ data: { actorId, action: "CHECKING_EXTENDED", targetId: extension.id, details: { termId, publicationId: publication.id, before: previousDeadline.toISOString(), after: next.toISOString(), reason: data.reason } } });
    return { id: extension.id, publicationId: publication.id, effectiveCheckingEndsAt: next };
  });
}
export async function setPublicationCohort(sessionId: string, termId: string, input: unknown) {
  const data = z.object({ revision: revisionSchema, policy: z.enum(["PREVIOUS", "CURRENT"]), reason: z.string().trim().min(2).max(1000) }).parse(input);
  return termTransaction(sessionId, termId, ["ADMIN"], ["ACTIVE"], async (tx, term, actorId) => {
    if (term.revision !== data.revision) throw new AccountError("周期已变化，请重新核对名单", 409);
    if (!term.cohortPublicationId) throw new AccountError("首次发布使用当前有效学生名单，无历史名单可切换", 409);
    if (term.cohortPolicy === data.policy) return term;
    const updated = await tx.term.update({ where: { id: termId }, data: { cohortPolicy: data.policy, revision: { increment: 1 } } });
    await tx.auditEvent.create({ data: { actorId, action: "PUBLICATION_COHORT_CHANGED", targetId: termId, details: { before: term.cohortPolicy, after: data.policy, basis: term.cohortPublicationId, reason: data.reason } } });
    return updated;
  });
}
