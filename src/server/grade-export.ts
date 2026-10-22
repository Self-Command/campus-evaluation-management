import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { AccountError } from "@/server/account-error";
import { termTransaction } from "@/server/terms";
import { scopedStudentWhere } from "@/server/access-scope";
import { buildGradeSheets } from "@/lib/xlsx/grade-model";
import { buildMultiSheetWorkbook, createZip } from "@/lib/xlsx/workbook";
import { validateScheme } from "@/lib/scoring/validate";

// Authorized single-student grade workbook. Scope is resolved from the stored class /
// counselor / college relations, never from request parameters, and the values are the
// same inputs the result service scores so the workbook can be reconciled with it.

const allPhases = ["CONFIGURATION", "ACTIVE", "CHECKING", "LOCKED"] as const;

/**
 * Class-scoped bulk export: one authorized workbook per student, packed into a single
 * ZIP so a counselor can hand out individual sheets without seeing other classes.
 * The school-style single table is a separate layout and is not faked here.
 */
export async function exportClassGradeWorkbooks(sessionId: string, termId: string, input: unknown) {
  const { classId } = z.object({ classId: z.string().min(1).max(100) }).parse(input);
  const single = await termTransaction(sessionId, termId, ["ADMIN", "COLLEGE", "COUNSELOR"], [...allPhases], async (tx, term, actorId) => {
    const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId }, select: { id: true, role: true, collegeId: true } });
    const where: Prisma.UserWhereInput = { AND: [scopedStudentWhere(actor), { studentProfile: { is: { classId } } }] };
    const students = await tx.user.findMany({ where, select: { id: true }, orderBy: [{ login: "asc" }, { id: "asc" }], take: 500 });
    if (!students.length) throw new AccountError("该班级没有可导出的学生", 404);
    return { studentIds: students.map((student) => student.id), termName: term.name };
  }, "read");
  const files: { name: string; data: Buffer }[] = [];
  for (const studentId of single.studentIds) {
    const workbook = await exportStudentGradeWorkbook(sessionId, termId, { studentId });
    files.push({ name: workbook.fileName, data: workbook.buffer });
  }
  const safe = (value: string) => value.replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 60);
  const fileName = `成绩_${safe(single.termName)}_${files.length}人_${new Date().toISOString().slice(0, 10)}.zip`;
  return { buffer: createZip(files), fileName, count: files.length };
}

export async function exportStudentGradeWorkbook(sessionId: string, termId: string, input: unknown) {
  const { studentId } = z.object({ studentId: z.string().min(1).max(100) }).parse(input);
  return termTransaction(sessionId, termId, ["ADMIN", "COLLEGE", "COUNSELOR", "STUDENT"], [...allPhases], async (tx, term, actorId) => {
    const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId }, select: { id: true, role: true, collegeId: true } });
    const where: Prisma.UserWhereInput = { AND: [scopedStudentWhere(actor), { id: studentId }] };
    const student = await tx.user.findFirst({ where, select: { id: true, login: true, name: true, studentProfile: { select: { studentNumber: true, college: true, major: true, className: true } } } });
    if (!student || !student.studentProfile) throw new AccountError("学生不在可导出范围", 403);

    const { nodes } = validateScheme(term.scheme);
    const [grades, participations, claims, deductions, publication] = await Promise.all([
      tx.gradeInput.findMany({ where: { termId, studentId }, select: { nodeId: true, value: true } }),
      tx.participation.findMany({ where: { studentId, removedAt: null, activity: { termId, confirmed: true }, sources: { some: { status: "APPROVED" } } }, select: { score: true, activity: { select: { nodeId: true, points: true, scoreMode: true } } } }),
      tx.personalClaim.findMany({ where: { termId, studentId, status: "APPROVED" }, select: { score: true, scoreNodeId: true, project: { select: { nodeId: true, points: true } } } }),
      tx.deductionInput.findMany({ where: { termId, studentId, revoked: false }, select: { projectId: true, amount: true } }),
      term.publishedResultSetId ? tx.resultPublication.findUnique({ where: { id: term.publishedResultSetId }, select: { sequence: true, publishedAt: true } }) : null,
    ]);

    const values: Record<string, string> = {};
    for (const grade of grades) values[grade.nodeId] = grade.value.toFixed();
    for (const fact of participations) {
      if (nodes.get(fact.activity.nodeId)?.kind !== "ACTIVITY") continue;
      const points = fact.activity.scoreMode === "INDIVIDUAL" ? fact.score : fact.activity.points;
      if (points === null) continue;
      values[fact.activity.nodeId] = (Number(values[fact.activity.nodeId] ?? 0) + Number(points.toFixed())).toFixed(2);
    }
    for (const claim of claims) {
      const nodeId = claim.scoreNodeId ?? claim.project?.nodeId;
      const points = claim.score ?? claim.project?.points;
      if (!nodeId || points === null || points === undefined) continue;
      if (nodes.get(nodeId)?.kind !== "ACTIVITY") continue;
      values[nodeId] = (Number(values[nodeId] ?? 0) + Number(points.toFixed())).toFixed(2);
    }
    const deductionValues: Record<string, string> = {};
    for (const item of deductions) deductionValues[item.projectId] = (Number(deductionValues[item.projectId] ?? 0) + Number(item.amount.toFixed())).toFixed(2);

    const sheets = buildGradeSheets({
      termName: term.name,
      schemeRevision: term.revision,
      batchLabel: publication ? `第 ${publication.sequence} 次发布（${publication.publishedAt.toISOString().slice(0, 10)}）` : `未发布 · 当前录入进度（${term.phase}）`,
      student: {
        login: student.login,
        name: student.name,
        college: student.studentProfile.college,
        major: student.studentProfile.major,
        className: student.studentProfile.className,
      },
      scheme: term.scheme as never,
      values,
      deductions: deductionValues,
    });
    const buffer = buildMultiSheetWorkbook([sheets.score, sheets.params]);
    const safe = (value: string) => value.replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 60);
    const fileName = `成绩_${safe(term.name)}_${safe(student.login)}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    return { buffer, fileName, studentName: student.name, studentLogin: student.login };
  }, "read");
}
