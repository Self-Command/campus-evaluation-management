import { createHash } from "node:crypto";
import { z } from "zod";
import { exportDateText } from "@/lib/business-labels";
import { AccountError } from "@/server/account-error";
import { termTransaction } from "@/server/terms";
import { scopedStudentWhere } from "@/server/access-scope";
import { buildClassSheet } from "@/lib/xlsx/class-sheet";
import { buildMultiSheetWorkbook } from "@/lib/xlsx/workbook";
import { loadLiveGradeStudents, loadPublishedGradeStudents, resolveExportSnapshot } from "@/server/grade-export-data";
import { recordAudit } from "@/server/audit";

// Authorized single-student detail workbook. Scope is resolved from the stored class /
// counselor / college relations, never from request parameters. For a published/locked
// term the identity and inputs come from the frozen publication payload. The layout is
// the same unified detail table used by every other export, with only the scope changed.

const allPhases = ["CONFIGURATION", "ACTIVE", "CHECKING", "LOCKED"] as const;

export async function exportStudentGradeWorkbook(sessionId: string, termId: string, input: unknown) {
  const { studentId } = z.object({ studentId: z.string().min(1).max(100) }).parse(input);
  return termTransaction(sessionId, termId, ["ADMIN", "COLLEGE", "COUNSELOR", "STUDENT"], [...allPhases], async (tx, term, actorId) => {
    const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId }, select: { id: true, role: true, collegeId: true } });
    const student = await tx.user.findFirst({
      where: { AND: [scopedStudentWhere(actor), { id: studentId }] },
      select: { id: true, login: true, studentProfile: { select: { studentNumber: true, college: true, major: true, className: true } } },
    });
    if (!student?.studentProfile) throw new AccountError("学生不在可导出范围", 403);
    const snapshot = await resolveExportSnapshot(tx, term);
    const [row] = snapshot.published
      ? await loadPublishedGradeStudents(snapshot, tx, [studentId])
      : await loadLiveGradeStudents(tx, term, [studentId]);
    if (!row) throw new AccountError(snapshot.published ? "该生不在当前发布版本中，请联系管理员" : "该生没有可导出的成绩数据", 404);
    const sheets = buildClassSheet({
      title: `${row.name}综合素质测评成绩明细表`,
      termName: term.name,
      batchLabel: snapshot.batchLabel,
      scheme: snapshot.scheme,
      showOrganization: true,
      mode: snapshot.published ? "published" : "live",
      students: [{
        login: row.login,
        name: row.name,
        studentNumber: row.studentNumber,
        college: row.college,
        major: row.major,
        className: row.className,
        values: row.values,
        deductions: row.deductions,
      }],
    });
    const buffer = buildMultiSheetWorkbook([sheets.detail, sheets.rules]);
    await recordAudit(tx, {
        actorId,
        action: "GRADE_STATEMENT_EXPORTED",
        targetId: studentId,
        details: {
          termId,
          published: snapshot.published,
          publicationId: snapshot.publicationId,
          publicationSequence: snapshot.publicationSequence,
          sha256: createHash("sha256").update(buffer).digest("hex"),
        },
      });
    const safe = (value: string) => value.replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 60);
    const fileName = `成绩明细表_${safe(term.name)}_${safe(row.name)}_${safe(row.login)}_${snapshot.published ? "正式发布" : "当前阶段"}_${exportDateText()}.xlsx`;
    return { buffer, fileName, studentName: row.name, studentLogin: row.login, published: snapshot.published };
  }, "read");
}
