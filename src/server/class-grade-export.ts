import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { AccountError } from "@/server/account-error";
import { termTransaction } from "@/server/terms";
import { scopedStudentWhere } from "@/server/access-scope";
import { buildClassSheet, type ClassStudent } from "@/lib/xlsx/class-sheet";
import { buildMultiSheetWorkbook } from "@/lib/xlsx/workbook";
import { validateScheme } from "@/lib/scoring/validate";

// School-style class sheet: one row per student in one authorized workbook. The scope is
// resolved from stored class / counselor / college relations, and the values come from the
// same tables the scoring engine reads, so the sheet reconciles with the system results.

const allPhases = ["CONFIGURATION", "ACTIVE", "CHECKING", "LOCKED"] as const;

export async function exportClassGradeWorkbook(sessionId: string, termId: string, input: unknown) {
  const { classId } = z.object({ classId: z.string().min(1).max(100).optional() }).parse(input);
  return termTransaction(sessionId, termId, ["ADMIN", "COLLEGE", "COUNSELOR"], [...allPhases], async (tx, term, actorId) => {
    const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId }, select: { id: true, role: true, collegeId: true } });
    if (!classId && actor.role !== "ADMIN") throw new AccountError("请指定要导出的班级", 400);
    const where: Prisma.UserWhereInput = { AND: [scopedStudentWhere(actor), ...(classId ? [{ studentProfile: { is: { classId } } }] : [])] };
    const students = await tx.user.findMany({
      where,
      select: { id: true, login: true, name: true, studentProfile: { select: { studentNumber: true, college: true, major: true, className: true } } },
      orderBy: [{ login: "asc" }, { id: "asc" }],
      take: classId ? 500 : 3000,
    });
    if (!students.length) throw new AccountError("该班级没有可导出的学生", 404);
    const { nodes } = validateScheme(term.scheme);
    const ids = students.map((student) => student.id);
    const [grades, participations, claims, deductions] = await Promise.all([
      tx.gradeInput.findMany({ where: { termId, studentId: { in: ids } }, select: { studentId: true, nodeId: true, value: true } }),
      tx.participation.findMany({ where: { studentId: { in: ids }, removedAt: null, activity: { termId, confirmed: true }, sources: { some: { status: "APPROVED" } } }, select: { studentId: true, score: true, activity: { select: { nodeId: true, points: true, scoreMode: true } } } }),
      tx.personalClaim.findMany({ where: { termId, studentId: { in: ids }, status: "APPROVED" }, select: { studentId: true, score: true, scoreNodeId: true, project: { select: { nodeId: true, points: true } } } }),
      tx.deductionInput.findMany({ where: { termId, studentId: { in: ids }, revoked: false }, select: { studentId: true, projectId: true, amount: true } }),
    ]);

    const rows: ClassStudent[] = students.map((student) => {
      const values: Record<string, string> = {};
      const add = (nodeId: string, points: string) => {
        values[nodeId] = (Number(values[nodeId] ?? 0) + Number(points)).toFixed(2);
      };
      for (const grade of grades) if (grade.studentId === student.id) values[grade.nodeId] = grade.value.toFixed();
      for (const fact of participations) {
        if (fact.studentId !== student.id) continue;
        if (nodes.get(fact.activity.nodeId)?.kind !== "ACTIVITY") continue;
        const points = fact.activity.scoreMode === "INDIVIDUAL" ? fact.score : fact.activity.points;
        if (points !== null) add(fact.activity.nodeId, points.toFixed());
      }
      for (const claim of claims) {
        if (claim.studentId !== student.id) continue;
        const nodeId = claim.scoreNodeId ?? claim.project?.nodeId;
        const points = claim.score ?? claim.project?.points;
        if (!nodeId || points === null || points === undefined) continue;
        if (nodes.get(nodeId)?.kind === "ACTIVITY") add(nodeId, points.toFixed());
      }
      const deductionValues: Record<string, string> = {};
      for (const item of deductions) {
        if (item.studentId !== student.id) continue;
        deductionValues[item.projectId] = (Number(deductionValues[item.projectId] ?? 0) + Number(item.amount.toFixed())).toFixed(2);
      }
      return {
        login: student.login,
        name: student.name,
        studentNumber: student.studentProfile?.studentNumber || student.login,
        values,
        deductions: deductionValues,
      };
    });

    const scopeLabel = classId
      ? students[0].studentProfile
        ? `${students[0].studentProfile.college}${students[0].studentProfile.major}${students[0].studentProfile.className}`
        : "班级"
      : "全校";
    const sheet = buildClassSheet({
      title: `${scopeLabel}综合素质测评成绩明细表`,
      batchLabel: term.publishedResultSetId ? `${term.name} · 已发布` : `${term.name} · 当前录入进度`,
      scheme: term.scheme as never,
      students: rows,
    });
    const buffer = buildMultiSheetWorkbook([sheet]);
    const safe = (value: string) => value.replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 60);
    const fileName = `成绩明细表_${safe(scopeLabel)}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    return { buffer, fileName, count: rows.length };
  }, "read");
}
