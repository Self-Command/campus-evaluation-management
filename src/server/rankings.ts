import { z } from "zod";
import { AccountError } from "@/server/accounts";
import { termTransaction } from "@/server/terms";
import { ranked } from "@/server/results";
import { publicationSelect, digest } from "@/server/publications";

const filterSchema = z.object({ publicationId: z.string().max(100).optional(), college: z.string().max(80).optional(), major: z.string().max(80).optional(), className: z.string().max(80).optional(), page: z.coerce.number().int().min(1).max(100000).default(1) });
export async function getRankings(sessionId: string, termId: string, input: unknown, exporting = false) {
  const filters = filterSchema.parse(input);
  return termTransaction(sessionId, termId, exporting ? ["ADMIN"] : ["ADMIN", "STUDENT"], ["ACTIVE", "CHECKING", "LOCKED"], async (tx, term, actorId) => {
    const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId } });
    const publicationId = filters.publicationId || term.publishedResultSetId;
    if (!publicationId) throw new AccountError("本周期尚未发布结果", 409);
    if (actor.role === "STUDENT" && publicationId !== term.publishedResultSetId) throw new AccountError("只能查看本人当前发布结果的排名", 403);
    const publication = await tx.resultPublication.findUnique({ where: { id: publicationId }, select: publicationSelect });
    if (!publication || publication.termId !== termId) throw new AccountError("发布版本不存在", 404);
    const all = await tx.publishedResult.findMany({ where: { publicationId }, select: { studentId: true, name: true, login: true, college: true, major: true, className: true, total: true } });
    const rows = ranked(all.filter(r => (!filters.college || r.college === filters.college) && (!filters.major || r.major === filters.major) && (!filters.className || r.className === filters.className)));
    if (actor.role === "STUDENT") {
      const own = rows.find(r => r.studentId === actorId);
      return { items: own ? [{ ...own, total: own.total.toFixed(2) }] : [], total: rows.length, page: 1, publication, scopeOptions: { colleges: [], majors: [], classes: [] } };
    }
    const items = (exporting ? rows : rows.slice((filters.page - 1) * 20, filters.page * 20)).map(r => ({ ...r, total: r.total.toFixed(2) }));
    if (exporting) await tx.auditEvent.create({ data: { actorId, action: "RANKINGS_EXPORTED", targetId: publicationId, details: { termId, count: rows.length, scope: { college: filters.college ?? null, major: filters.major ?? null, className: filters.className ?? null }, hash: digest(items) } } });
    return { items, total: rows.length, page: filters.page, publication, scopeOptions: { colleges: [...new Set(all.map(r => r.college))].sort(), majors: [...new Set(all.filter(r => !filters.college || r.college === filters.college).map(r => r.major))].sort(), classes: [...new Set(all.filter(r => (!filters.college || r.college === filters.college) && (!filters.major || r.major === filters.major)).map(r => r.className))].sort() } };
  });
}
export function csvText(value: string) { const safe = /^[\s\uFEFF]*[=+\-@]/.test(value) || /^[\t\r\n]/.test(value) ? "'" + value : value; return '"' + safe.replaceAll('"', '""') + '"'; }
export async function rankingCsv(sessionId: string, termId: string, input: unknown) {
  const result = await getRankings(sessionId, termId, input, true);
  const rows = result.items.map(r => [String(r.rank), csvText(r.login), csvText(r.name), csvText(r.college), csvText(r.major), csvText(r.className), r.total].join(","));
  return "\uFEFF名次,学号,姓名,学院,专业,班级,总分\r\n" + rows.join("\r\n") + "\r\n";
}
