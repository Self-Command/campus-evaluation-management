import { z } from "zod";
import { AccountError } from "@/server/accounts";
import { termTransaction } from "@/server/terms";
import { validateScheme } from "@/lib/scoring/validate";
import { decimalSchema } from "@/lib/scoring/types";
import { Rational } from "@/lib/scoring/rational";
import { inputStudent } from "@/server/input-student";
export async function saveGrade(sessionId: string, termId: string, input: unknown) {
  const data = z.object({ studentLogin: z.string().trim().min(1).max(64), nodeId: z.string().min(1), value: decimalSchema, revision: z.number().int().nonnegative().nullable(), reason: z.string().trim().min(2).max(1000) }).parse(input);
  return termTransaction(sessionId, termId, ["ADMIN"], ["ACTIVE"], async (tx, term, actorId) => {
    const node = validateScheme(term.scheme).nodes.get(data.nodeId);
    if (!node || node.kind !== "GRADE") throw new AccountError("只能向成绩输入最底层模块录入");
    const value = Rational.from(data.value);
    if (value.compare(Rational.from(node.minimum)) < 0 || value.compare(Rational.from(node.maximum)) > 0) throw new AccountError(`成绩应在${node.minimum}至${node.maximum}范围内`);
    const student = await inputStudent(tx, term, data.studentLogin);
    const where = { termId_studentId_nodeId: { termId, studentId: student.id, nodeId: node.id } };
    const previous = await tx.gradeInput.findUnique({ where });
    if ((previous?.revision ?? null) !== data.revision) throw new AccountError("成绩记录已变化，请重新查询后保存", 409);
    if (previous && Rational.from(previous.value.toFixed()).compare(value) === 0) return previous;
    const saved = previous ? await tx.gradeInput.update({ where, data: { value: data.value, revision: { increment: 1 } } }) : await tx.gradeInput.create({ data: { termId, studentId: student.id, nodeId: node.id, value: data.value } });
    await tx.term.update({ where: { id: termId }, data: { inputRevision: { increment: 1 } } });
    await tx.auditEvent.create({ data: { actorId, action: "GRADE_SAVED", targetId: saved.id, details: { termId, studentId: student.id, nodeId: node.id, before: previous?.value.toFixed() ?? null, after: saved.value.toFixed(), reason: data.reason } } });
    return saved;
  });
}
export async function listGrades(sessionId: string, termId: string, studentLogin: string) {
  return termTransaction(sessionId, termId, ["ADMIN"], ["CONFIGURATION", "ACTIVE", "CHECKING", "LOCKED"], async (tx, term) => {
    const student = await inputStudent(tx, term, studentLogin);
    const inputs = await tx.gradeInput.findMany({ where: { termId: term.id, studentId: student.id } });
    return { student: { login: student.login, name: student.name }, inputs: inputs.map(item => ({ ...item, value: item.value.toFixed() })) };
  });
}
