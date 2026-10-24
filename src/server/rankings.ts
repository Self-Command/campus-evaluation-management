import { createHash } from "node:crypto";
import { z } from "zod";
import { exportDateText } from "@/lib/business-labels";
import { validateScheme } from "@/lib/scoring/validate";
import type { Scheme } from "@/lib/scoring/types";
import { buildClassSheet } from "@/lib/xlsx/class-sheet";
import { buildMultiSheetWorkbook } from "@/lib/xlsx/workbook";
import { AccountError } from "@/server/accounts";
import { db } from "@/server/db";
import { termTransaction } from "@/server/terms";
import { EXPORT_TRANSACTION_TIMEOUT_MS, assertExportCapacity } from "@/server/export-limits";
import { ranked } from "@/server/results";
import { publicationSelect } from "@/server/publications";
import { loadAllPublishedGradeStudents } from "@/server/grade-export-data";
import { recordAudit } from "@/server/audit";

const filterSchema = z.object({
  publicationId: z.string().max(100).optional(),
  college: z.string().max(80).optional(),
  major: z.string().max(80).optional(),
  className: z.string().max(80).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
});

export async function getRankings(sessionId: string, termId: string, input: unknown) {
  const filters = filterSchema.parse(input);
  return termTransaction(sessionId, termId, ["ADMIN", "STUDENT"], ["ACTIVE", "CHECKING", "LOCKED"], async (tx, term, actorId) => {
    const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId } });
    const publicationId = filters.publicationId || term.publishedResultSetId;
    if (!publicationId) throw new AccountError("本周期尚未发布结果", 409);
    if (actor.role === "STUDENT" && publicationId !== term.publishedResultSetId) throw new AccountError("只能查看本人当前发布结果的排名", 403);
    const publication = await tx.resultPublication.findUnique({ where: { id: publicationId }, select: publicationSelect });
    if (!publication || publication.termId !== termId) throw new AccountError("发布版本不存在", 404);
    const all = await tx.publishedResult.findMany({
      where: { publicationId },
      select: { studentId: true, name: true, login: true, college: true, major: true, className: true, total: true },
    });
    const rows = ranked(all.filter((row) => (!filters.college || row.college === filters.college) && (!filters.major || row.major === filters.major) && (!filters.className || row.className === filters.className)));
    if (actor.role === "STUDENT") {
      const own = rows.find((row) => row.studentId === actorId);
      return {
        items: own ? [{ ...own, total: own.total.toFixed(2) }] : [],
        total: rows.length,
        page: 1,
        term: { name: term.name },
        publication,
        scopeOptions: { colleges: [], majors: [], classes: [] },
      };
    }
    const items = rows.slice((filters.page - 1) * 20, filters.page * 20).map((row) => ({ ...row, total: row.total.toFixed(2) }));
    return {
      items,
      total: rows.length,
      page: filters.page,
      term: { name: term.name },
      publication,
      scopeOptions: {
        colleges: [...new Set(all.map((row) => row.college))].sort(),
        majors: [...new Set(all.filter((row) => !filters.college || row.college === filters.college).map((row) => row.major))].sort(),
        classes: [...new Set(all.filter((row) => (!filters.college || row.college === filters.college) && (!filters.major || row.major === filters.major)).map((row) => row.className))].sort(),
      },
    };
  }, "read");
}

const exportSchema = z.object({ publicationId: z.string().max(100).optional() });

export async function exportRankingGradeWorkbook(sessionId: string, termId: string, input: unknown) {
  const { publicationId: requestedId } = exportSchema.parse(input);
  const job = await termTransaction(sessionId, termId, ["ADMIN"], ["ACTIVE", "CHECKING", "LOCKED"], async (tx, term, actorId) => {
    const publicationId = requestedId || term.publishedResultSetId;
    if (!publicationId) throw new AccountError("本周期尚未发布结果，不能导出全校成绩", 409);
    const publication = await tx.resultPublication.findUnique({
      where: { id: publicationId },
      select: { id: true, termId: true, sequence: true, publishedAt: true, scheme: true },
    });
    if (!publication || publication.termId !== termId) throw new AccountError("发布版本不存在", 404);
    const scheme = publication.scheme as unknown as Scheme;
    validateScheme(scheme);
    const count = await tx.publishedResult.count({ where: { publicationId } });
    if (!count) throw new AccountError("当前发布版本中没有可导出的学生", 409);
    assertExportCapacity(count, "请通过成绩明细表按学院或班级分批导出");
    const rows = await loadAllPublishedGradeStudents(tx, publicationId, scheme);
    return {
      termName: term.name,
      actorId,
      publication: { id: publication.id, sequence: publication.sequence, publishedAt: publication.publishedAt },
      scheme,
      rows,
    };
  }, "read", { timeout: EXPORT_TRANSACTION_TIMEOUT_MS });

  const batchLabel = `第 ${job.publication.sequence} 次发布（${exportDateText(job.publication.publishedAt)}）· 正式发布快照`;
  const classCount = new Set(job.rows.map((row) => `${row.college}\u0000${row.major}\u0000${row.className}`)).size;
  const sheets = buildClassSheet({
    title: `全校综合素质测评成绩明细表（${classCount}个班级）`,
    termName: job.termName,
    batchLabel,
    scheme: job.scheme,
    showOrganization: true,
    mode: "published",
    students: job.rows.map((row) => ({
      login: row.login,
      name: row.name,
      studentNumber: row.studentNumber,
      college: row.college,
      major: row.major,
      className: row.className,
      values: row.values,
      deductions: row.deductions,
    })),
  });
  const buffer = buildMultiSheetWorkbook([sheets.detail, sheets.rules]);
  await recordAudit(db, {
      actorId: job.actorId,
      action: "GRADE_DETAIL_EXPORTED",
      targetId: job.publication.id,
      details: {
        termId,
        scope: "school",
        source: "rankings",
        studentCount: job.rows.length,
        published: true,
        publicationId: job.publication.id,
        publicationSequence: job.publication.sequence,
        sha256: createHash("sha256").update(buffer).digest("hex"),
      },
    });
  const safe = (value: string) => value.replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 60);
  const fileName = `成绩明细表_全校_${safe(job.termName)}_正式发布_${exportDateText()}.xlsx`;
  return { buffer, fileName, count: job.rows.length, batchLabel };
}
