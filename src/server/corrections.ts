import { z } from "zod";
import type { Prisma, Term } from "@/generated/prisma/client";
import { AccountError } from "@/server/accounts";
import { termTransaction } from "@/server/terms";
import { collectStudentResults, resultStudentSelect, type ScoringOverride } from "@/server/results";
import { validateScheme } from "@/lib/scoring/validate";
import { decimalSchema, schemeSchema } from "@/lib/scoring/types";
import { Rational } from "@/lib/scoring/rational";
import { jsonValue } from "@/server/claims";
import { issueFlowToken, verifyFlowToken, stateDigest } from "@/server/flow-token";
import { schemeReferences, schemeReferenceErrors } from "@/server/scheme-references";

const correctionSchema = z.object({ action: z.enum(["preview", "commit"]), kind: z.enum(["scheme", "activity", "project"]), revision: z.number().int().nonnegative().optional(), reason: z.string().trim().min(2).max(1000).optional(), token: z.string().max(4000).optional(), id: z.string().optional(), scheme: schemeSchema.optional(), nodeId: z.string().optional(), points: decimalSchema.optional(), scoreMode: z.enum(["FIXED", "INDIVIDUAL"]).optional() });
async function impactedStudents(tx: Prisma.TransactionClient, term: Term) {
  const [facts, claims, grades, deductions, frozen] = await Promise.all([
    tx.participation.findMany({ where: { activity: { termId: term.id } }, select: { studentId: true }, distinct: ["studentId"] }),
    tx.personalClaim.findMany({ where: { project: { termId: term.id } }, select: { studentId: true }, distinct: ["studentId"] }),
    tx.gradeInput.findMany({ where: { termId: term.id }, select: { studentId: true }, distinct: ["studentId"] }),
    tx.deductionInput.findMany({ where: { termId: term.id }, select: { studentId: true }, distinct: ["studentId"] }),
    term.cohortPublicationId ? tx.publishedResult.findMany({ where: { publicationId: term.cohortPublicationId }, select: { studentId: true } }) : [],
  ]);
  const ids = [...new Set([...facts, ...claims, ...grades, ...deductions, ...frozen].map(item => item.studentId))];
  const where: Prisma.UserWhereInput = { OR: [{ role: "STUDENT", disabled: false, studentProfile: { isNot: null } }, { id: { in: ids } }] };
  if (await tx.user.count({ where }) > 2000) throw new AccountError("影响范围超过2000人，本次未更正；请联系管理员调整处理容量", 409);
  return tx.user.findMany({ where, select: resultStudentSelect, orderBy: { id: "asc" } });
}
export async function correctScoring(sessionId: string, termId: string, input: unknown) {
  const data = correctionSchema.parse(input);
  return termTransaction(sessionId, termId, ["ADMIN"], ["ACTIVE"], async (tx, term, actorId) => {
    const students = await impactedStudents(tx, term);
    const override: ScoringOverride = {};
    let nextTerm = term;
    let original: unknown = null;
    const errors: string[] = [];
    if (data.kind === "scheme") {
      if (!data.scheme) throw new AccountError("请提供完整评分制度");
      const { scheme } = validateScheme(data.scheme);
      errors.push(...schemeReferenceErrors(scheme, await schemeReferences(tx, termId)));
      original = term.scheme; nextTerm = { ...term, scheme: JSON.parse(JSON.stringify(scheme)) as Prisma.JsonValue };
    } else {
      if (!data.id || !data.nodeId || data.points === undefined) throw new AccountError("请选择更正对象、评分模块并填写分值");
      if (Rational.from(data.points).compare(Rational.from("0")) < 0) throw new AccountError("分值不能为负");
      if (validateScheme(term.scheme).nodes.get(data.nodeId)?.kind !== "ACTIVITY") throw new AccountError("更正目标须为活动最底层模块");
      if (data.kind === "activity") {
        const activity = await tx.activity.findUnique({ where: { id: data.id } });
        if (!activity || activity.termId !== termId) throw new AccountError("活动不存在", 404);
        original = activity;
        const scoreMode = data.scoreMode ?? activity.scoreMode;
        if (scoreMode !== activity.scoreMode && await tx.participation.count({ where: { activityId: activity.id } })) errors.push("已有参与记录的活动不可切换计分方式；请保留原方式并更正分值或归属");
        if (scoreMode === "INDIVIDUAL" && await tx.participation.count({ where: { activityId: activity.id, score: { gt: data.points } } })) errors.push("存在超过新分值上限的个人分数，请先由发布者按依据更正并重新审核");
        override.activity = { id: activity.id, nodeId: data.nodeId, points: data.points, scoreMode };
      } else {
        const project = await tx.recognitionProject.findUnique({ where: { id: data.id } });
        if (!project || project.termId !== termId) throw new AccountError("申报项目不存在", 404);
        original = project; override.project = { id: project.id, nodeId: data.nodeId, points: data.points };
      }
    }
    const before = await collectStudentResults(tx, term, students);
    let after = before;
    if (!errors.length) {
      try { after = await collectStudentResults(tx, nextTerm, students, override); }
      catch (error) { errors.push(error instanceof Error ? error.message : "更正后计分失败，请检查规则和已有输入"); }
    }
    const changes = students.map((student, index) => ({ studentId: student.id, login: student.login, name: student.name, before: before[index].result.total, after: after[index].result.total, beforeComplete: before[index].result.complete, afterComplete: after[index].result.complete })).filter((change, index) => stateDigest(before[index].result) !== stateDigest(after[index].result));
    const state = { termId, revision: term.revision, inputRevision: term.inputRevision, kind: data.kind, id: data.id, original, nextScheme: nextTerm.scheme, override, students, before, after, errors };
    if (data.action === "preview") return { affectedStudents: changes.length, changes, errors: [...new Set(errors)], revision: term.revision, ...issueFlowToken(actorId, "SCORING_CORRECTION", state) };
    if (term.revision !== data.revision) throw new AccountError("周期已变化，请重新预览更正", 409);
    if (!data.reason) throw new AccountError("请填写更正理由");
    verifyFlowToken(data.token ?? "", actorId, "SCORING_CORRECTION", state);
    if (errors.length) throw new AccountError([...new Set(errors)].join("；"), 409);
    if (override.activity) { const { id, ...fields } = override.activity; await tx.activity.update({ where: { id }, data: { ...fields, revision: { increment: 1 } } }); }
    if (override.project) { const { id, ...fields } = override.project; await tx.recognitionProject.update({ where: { id }, data: { ...fields, revision: { increment: 1 } } }); }
    const updated = await tx.term.update({ where: { id: termId }, data: { ...(data.kind === "scheme" ? { scheme: jsonValue(nextTerm.scheme) } : {}), revision: { increment: 1 }, inputRevision: { increment: 1 } } });
    await tx.auditEvent.create({ data: { actorId, action: "SCORING_CORRECTED", targetId: data.id ?? termId, details: jsonValue({ termId, kind: data.kind, reason: data.reason, original, next: data.kind === "scheme" ? nextTerm.scheme : override, changes, beforeRevision: term.revision, afterRevision: updated.revision }) } });
    return { revision: updated.revision, affectedStudents: changes.length, changes };
  });
}
