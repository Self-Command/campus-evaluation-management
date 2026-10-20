import { createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { AccountError } from "@/server/accounts";
import { termTransaction } from "@/server/terms";
import { validateScheme } from "@/lib/scoring/validate";
import { Rational } from "@/lib/scoring/rational";
import { decimalSchema } from "@/lib/scoring/types";
const rowsSchema = z.array(z.object({ login: z.string().trim().min(1).max(64), value: z.string().trim().max(200) })).min(1).max(100);
export type GradePreviewRow = { line: number; login: string; name: string; before: string | null; value: string; state: "NEW" | "SAME" | "OVERWRITE" | "SKIP" | "ERROR"; message: string };
async function inspect(tx: Prisma.TransactionClient, termId: string, nodeId: string, rows: z.infer<typeof rowsSchema>) {
  const term = await tx.term.findUniqueOrThrow({ where: { id: termId } });
  const node = validateScheme(term.scheme).nodes.get(nodeId);
  if (!node || node.kind !== "GRADE") throw new AccountError("目标必须为成绩输入模块");
  const students = term.cohortPolicy === "PREVIOUS" && term.cohortPublicationId
    ? (await tx.publishedResult.findMany({ where: { publicationId: term.cohortPublicationId, login: { in: rows.map(row => row.login) } }, orderBy: { studentId: "asc" } })).map(row => ({ id: row.studentId, login: row.login, name: row.name, role: "STUDENT" as const, disabled: false, revision: 0, studentProfile: { userId: row.studentId, studentNumber: row.login, college: row.college, major: row.major, className: row.className } }))
    : await tx.user.findMany({ where: { login: { in: rows.map(row => row.login) } }, select: { id: true, login: true, name: true, role: true, disabled: true, revision: true, studentProfile: true }, orderBy: { id: "asc" } });
  const grades = await tx.gradeInput.findMany({ where: { termId, nodeId, studentId: { in: students.map(student => student.id) } }, orderBy: { id: "asc" } });
  const known = new Map(students.map(student => [student.login, student])), previous = new Map(grades.map(grade => [grade.studentId, grade]));
  const seen = new Map<string, string>();
  const preview: GradePreviewRow[] = rows.map((row, index) => {
    const student = known.get(row.login), grade = student ? previous.get(student.id) : undefined;
    const base = { line: index + 2, login: row.login, name: student?.name ?? "", before: grade?.value.toFixed() ?? null, value: row.value };
    if (!student || student.role !== "STUDENT" || student.disabled || !student.studentProfile) return { ...base, state: "ERROR", message: "学号未匹配有效学生档案" };
    if (!decimalSchema.safeParse(row.value).success) return { ...base, state: "ERROR", message: "成绩必须为合法十进制数，最多12位小数" };
    const value = Rational.from(row.value);
    if (value.compare(Rational.from(node.minimum)) < 0 || value.compare(Rational.from(node.maximum)) > 0) return { ...base, state: "ERROR", message: `成绩应在${node.minimum}至${node.maximum}范围内` };
    const duplicate = seen.get(row.login);
    if (duplicate !== undefined) return { ...base, state: Rational.from(duplicate).compare(value) === 0 ? "SKIP" : "ERROR", message: Rational.from(duplicate).compare(value) === 0 ? "文件内相同成绩，跳过" : "同一学号出现不同成绩，请先核对" };
    seen.set(row.login, row.value);
    if (grade && Rational.from(grade.value.toFixed()).compare(value) === 0) return { ...base, state: "SAME", message: "与当前值相同，不重复写入" };
    return { ...base, state: grade ? "OVERWRITE" : "NEW", message: grade ? "覆盖当前成绩并保留更正记录" : "新增成绩输入" };
  });
  return { rows: preview, known, previous, snapshot: createHash("sha256").update(JSON.stringify({ revision: term.revision, node, students, grades })).digest("hex") };
}
export async function previewGradeImport(sessionId: string, termId: string, input: unknown) {
  const data = z.object({ nodeId: z.string().min(1), rows: rowsSchema, reason: z.string().trim().min(2).max(1000) }).parse(input);
  return termTransaction(sessionId, termId, ["ADMIN"], ["ACTIVE"], async (tx, term, actorId) => {
    const preview = await inspect(tx, termId, data.nodeId, data.rows);
    const batch = await tx.gradeImport.create({ data: { termId: term.id, actorId, nodeId: data.nodeId, rows: data.rows, reason: data.reason, snapshot: preview.snapshot, expiresAt: new Date(Date.now() + 15 * 60_000) } });
    return { id: batch.id, rows: preview.rows, errors: preview.rows.filter(row => row.state === "ERROR").length, expiresAt: batch.expiresAt };
  });
}
export async function commitGradeImport(sessionId: string, termId: string, id: string) {
  return termTransaction(sessionId, termId, ["ADMIN"], ["ACTIVE"], async (tx, term, actorId) => {
    const batch = await tx.gradeImport.findUnique({ where: { id } });
    if (!batch || batch.termId !== term.id) throw new AccountError("成绩导入批次不存在", 404);
    if (batch.actorId !== actorId) throw new AccountError("不能提交他人的成绩批次", 403);
    if (batch.status === "COMMITTED") return { ...(batch.result as { written: number; skipped: number }), replay: true };
    if (batch.expiresAt <= new Date()) throw new AccountError("成绩预览已过期", 409);
    const preview = await inspect(tx, termId, batch.nodeId, rowsSchema.parse(batch.rows));
    if (preview.snapshot !== batch.snapshot) throw new AccountError("预览后成绩或学生记录已变化，请重新预览", 409);
    if (preview.rows.some(row => row.state === "ERROR")) throw new AccountError("成绩存在错误行，本批次未写入");
    let written = 0;
    for (const row of preview.rows.filter(row => row.state === "NEW" || row.state === "OVERWRITE")) {
      const student = preview.known.get(row.login)!, previous = preview.previous.get(student.id);
      const saved = previous ? await tx.gradeInput.update({ where: { id: previous.id }, data: { value: row.value, revision: { increment: 1 } } }) : await tx.gradeInput.create({ data: { termId, studentId: student.id, nodeId: batch.nodeId, value: row.value } });
      await tx.auditEvent.create({ data: { actorId, action: "GRADE_IMPORTED", targetId: saved.id, details: { termId, batchId: id, studentId: student.id, nodeId: batch.nodeId, before: row.before, after: row.value, reason: batch.reason } } });
      written++;
    }
    const result = { written, skipped: preview.rows.length - written };
    if (written) await tx.term.update({ where: { id: termId }, data: { inputRevision: { increment: 1 } } });
    await tx.gradeImport.update({ where: { id }, data: { status: "COMMITTED", result } });
    await tx.auditEvent.create({ data: { actorId, action: "GRADE_IMPORT_COMMITTED", targetId: id, details: { ...result, termId } } });
    return { ...result, replay: false };
  });
}
