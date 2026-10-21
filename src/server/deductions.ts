import { z } from "zod";
import { AccountError } from "@/server/accounts";
import { termTransaction } from "@/server/terms";
import { validateScheme } from "@/lib/scoring/validate";
import { decimalSchema } from "@/lib/scoring/types";
import { Rational } from "@/lib/scoring/rational";
import { inputStudent } from "@/server/input-student";
export async function saveDeduction(sessionId: string, termId: string, input: unknown) {
  const data = z.object({ studentLogin: z.string().trim().min(1).max(64), projectId: z.string().min(1), occurrence: z.number().int().nonnegative().default(0), amount: decimalSchema, revision: z.number().int().nonnegative().nullable(), revoked: z.boolean().default(false), reason: z.string().trim().min(2).max(1000) }).parse(input);
  if (Rational.from(data.amount).compare(Rational.from("0")) <= 0) throw new AccountError("扣分额必须为正数");
  return termTransaction(sessionId, termId, ["ADMIN"], ["ACTIVE"], async (tx, term, actorId) => {
    const project = validateScheme(term.scheme).scheme.deductions.find(item => item.id === data.projectId);
    if (!project) throw new AccountError("扣分项目不存在");
    const student = await inputStudent(tx, term, data.studentLogin);
    const where = { termId_studentId_projectId_occurrence: { termId, studentId: student.id, projectId: project.id, occurrence: data.occurrence } };
    const previous = await tx.deductionInput.findUnique({ where });
    if ((previous?.revision ?? null) !== data.revision) throw new AccountError("扣分记录已变化，请重新查询后保存", 409);
    if (!previous && data.revoked) throw new AccountError("没有可撤销的扣分记录");
    if (!previous && data.occurrence !== 0) throw new AccountError("该扣分事件不存在，请刷新后重新选择");
    if (previous && previous.revoked === data.revoked && previous.reason === data.reason && Rational.from(previous.amount.toFixed()).compare(Rational.from(data.amount)) === 0) return previous;
    const saved = previous ? await tx.deductionInput.update({ where, data: { amount: data.amount, reason: data.reason, revoked: data.revoked, revision: { increment: 1 } } }) : await tx.deductionInput.create({ data: { termId, studentId: student.id, projectId: project.id, occurrence: data.occurrence, amount: data.amount, reason: data.reason } });
    await tx.term.update({ where: { id: termId }, data: { inputRevision: { increment: 1 } } });
    await tx.auditEvent.create({ data: { actorId, action: data.revoked ? "DEDUCTION_REVOKED" : "DEDUCTION_SAVED", targetId: saved.id, details: { termId, studentId: student.id, projectId: project.id, occurrence: saved.occurrence, nodeId: project.nodeId, coefficient: project.coefficient, before: previous ? { amount: previous.amount.toFixed(), revoked: previous.revoked, reason: previous.reason } : null, after: { amount: saved.amount.toFixed(), revoked: saved.revoked }, reason: data.reason } } });
    return saved;
  });
}
export async function listDeductions(sessionId: string, termId: string, studentLogin: string) {
  return termTransaction(sessionId, termId, ["ADMIN"], ["CONFIGURATION", "ACTIVE", "CHECKING", "LOCKED"], async (tx, term) => {
    const student = await inputStudent(tx, term, studentLogin);
    const records = await tx.deductionInput.findMany({ where: { termId: term.id, studentId: student.id } });
    return { student: { login: student.login, name: student.name }, records: records.map(item => ({ ...item, amount: item.amount.toFixed() })) };
  }, "read");
}
