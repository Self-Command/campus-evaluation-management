import { createHash } from "node:crypto";
import { z } from "zod";
import { db } from "@/server/db";
import { AccountError } from "@/server/account-error";
import { getCurrentSession, verifyAdminPassword } from "@/server/auth";
import { recordAudit } from "@/server/audit";
import {
  auditActions,
  auditActionMeta,
  auditCategories,
  auditCategoryLabels,
  auditResultLabels,
  isAuditAction,
  type AuditResult,
} from "@/server/audit-actions";
import type { Prisma } from "@/generated/prisma/client";

const roles = ["ADMIN", "COLLEGE", "COUNSELOR", "STUDENT", "PUBLISHER", "SYSTEM"] as const;
const results = ["SUCCESS", "FAILURE", "DENIED", "PARTIAL"] as const;
const pageSizes = [20, 50, 100] as const;
const maxRangeMs = 366 * 24 * 60 * 60_000;
const keywordRangeMs = 31 * 24 * 60 * 60_000;

const filterSchema = z.object({
  from: z.string().trim().max(40).optional(),
  to: z.string().trim().max(40).optional(),
  actor: z.string().trim().max(80).optional(),
  role: z.enum(roles).optional(),
  category: z.enum(auditCategories).optional(),
  action: z.string().trim().max(80).optional(),
  result: z.enum(results).optional(),
  targetType: z.string().trim().max(80).optional(),
  targetId: z.string().trim().max(200).optional(),
  requestId: z.string().trim().max(100).optional(),
  keyword: z.string().trim().max(100).optional(),
  reason: z.string().trim().max(200).optional(),
  cursor: z.string().trim().max(300).optional(),
  pageSize: z.coerce.number().int().refine(value => (pageSizes as readonly number[]).includes(value), "分页大小无效").default(20),
}).strict();

export type AuditFilters = z.infer<typeof filterSchema>;

function parseDate(value: string | undefined, fallback: Date) {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new AccountError("时间范围格式无效", 400);
  return date;
}

function rangeOf(filters: AuditFilters) {
  const now = new Date();
  const to = parseDate(filters.to, now);
  const from = parseDate(filters.from, new Date(to.getTime() - 7 * 24 * 60 * 60_000));
  if (from > to) throw new AccountError("开始时间不能晚于结束时间", 400);
  if (to.getTime() - from.getTime() > maxRangeMs) throw new AccountError("单次查询时间范围不能超过366天，请缩小范围", 400);
  if (filters.keyword && to.getTime() - from.getTime() > keywordRangeMs) throw new AccountError("关键词检索的时间范围不能超过31天，请先缩小时间范围", 400);
  return { from, to };
}

function actionCodesMatching(keyword: string) {
  const lowered = keyword.toLowerCase();
  return Object.entries(auditActions)
    .filter(([code, meta]) => code.toLowerCase().includes(lowered) || meta.label.includes(keyword))
    .map(([code]) => code)
    .slice(0, 30);
}

function keywordWhere(keyword: string): Prisma.AuditEventWhereInput[] {
  const clauses: Prisma.AuditEventWhereInput[] = [
    { actorName: { contains: keyword, mode: "insensitive" } },
    { actorLogin: { contains: keyword, mode: "insensitive" } },
    { targetId: { contains: keyword, mode: "insensitive" } },
    { targetLabel: { contains: keyword, mode: "insensitive" } },
    { requestId: { contains: keyword, mode: "insensitive" } },
    { reason: { contains: keyword, mode: "insensitive" } },
    { action: { contains: keyword.toUpperCase(), mode: "insensitive" } },
  ];
  const codes = actionCodesMatching(keyword);
  if (codes.length) clauses.push({ action: { in: codes } });
  return clauses;
}

export function auditWhere(filters: AuditFilters) {
  const { from, to } = rangeOf(filters);
  const and: Prisma.AuditEventWhereInput[] = [{ createdAt: { gte: from, lte: to } }];
  if (filters.actor) and.push({ OR: [{ actorName: { contains: filters.actor, mode: "insensitive" } }, { actorLogin: { contains: filters.actor, mode: "insensitive" } }] });
  if (filters.role) and.push({ actorRole: filters.role });
  if (filters.category) and.push({ category: filters.category });
  if (filters.action) and.push({ action: filters.action });
  if (filters.result) and.push({ result: filters.result });
  if (filters.targetType) and.push({ targetType: filters.targetType });
  if (filters.targetId) and.push({ targetId: filters.targetId });
  if (filters.requestId) and.push({ requestId: filters.requestId });
  if (filters.reason) and.push({ reason: { contains: filters.reason, mode: "insensitive" } });
  if (filters.keyword) and.push({ OR: keywordWhere(filters.keyword) });
  return { where: { AND: and } satisfies Prisma.AuditEventWhereInput, from, to };
}

function decodeCursor(cursor: string | undefined) {
  if (!cursor) return null;
  try {
    const parsed = z.object({ createdAt: z.string(), id: z.string() }).parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
    const createdAt = new Date(parsed.createdAt);
    if (Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id: parsed.id };
  } catch {
    return null;
  }
}

function cursorWhere(cursor: string | undefined): Prisma.AuditEventWhereInput | null {
  const decoded = decodeCursor(cursor);
  if (!decoded) return null;
  return { OR: [{ createdAt: { lt: decoded.createdAt } }, { createdAt: decoded.createdAt, id: { lt: decoded.id } }] };
}

function encodeCursor(row: { createdAt: Date; id: string }) {
  return Buffer.from(JSON.stringify({ createdAt: row.createdAt.toISOString(), id: row.id }), "utf8").toString("base64url");
}

function reasonOf(row: { reason: string | null; details: Prisma.JsonValue | null }) {
  if (row.reason) return row.reason;
  if (row.details && typeof row.details === "object" && !Array.isArray(row.details)) {
    const value = (row.details as Record<string, unknown>).reason;
    if (typeof value === "string") return value;
  }
  return null;
}

const listSelect = {
  id: true,
  actorId: true,
  actorName: true,
  actorLogin: true,
  actorRole: true,
  action: true,
  category: true,
  targetType: true,
  targetId: true,
  targetLabel: true,
  reason: true,
  result: true,
  requestId: true,
  route: true,
  method: true,
  ip: true,
  details: true,
  createdAt: true,
} as const;

function present(row: Prisma.AuditEventGetPayload<{ select: typeof listSelect }>) {
  const meta = isAuditAction(row.action) ? auditActionMeta(row.action) : null;
  return {
    ...row,
    reason: reasonOf(row),
    actionLabel: meta?.label ?? row.action,
    categoryLabel: auditCategoryLabels[row.category as keyof typeof auditCategoryLabels] ?? row.category,
    resultLabel: auditResultLabels[row.result as AuditResult] ?? row.result,
    highRisk: meta?.highRisk ?? false,
  };
}

export async function listAuditLogs(sessionId: string, rawFilters: unknown) {
  const current = await getCurrentSession(sessionId);
  if (!current || current.user.role !== "ADMIN" || current.user.mustChangePassword) throw new AccountError("没有管理权限", 403);
  const filters = filterSchema.parse(rawFilters);
  const { where } = auditWhere(filters);
  const cursor = cursorWhere(filters.cursor);
  const finalWhere: Prisma.AuditEventWhereInput = cursor ? { AND: [where, cursor] } : where;
  const [rows, total] = await Promise.all([
    db.auditEvent.findMany({ where: finalWhere, select: listSelect, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: filters.pageSize + 1 }),
    db.auditEvent.count({ where }),
  ]);
  const hasMore = rows.length > filters.pageSize;
  const page = hasMore ? rows.slice(0, filters.pageSize) : rows;
  return {
    items: page.map(present),
    total,
    pageSize: filters.pageSize,
    nextCursor: hasMore ? encodeCursor(page.at(-1)!) : null,
    filters: { ...filters, cursor: undefined },
  };
}

export async function getAuditLog(sessionId: string, id: string) {
  const current = await getCurrentSession(sessionId);
  if (!current || current.user.role !== "ADMIN" || current.user.mustChangePassword) throw new AccountError("没有管理权限", 403);
  const row = await db.auditEvent.findUnique({ where: { id: z.string().min(1).max(100).parse(id) } });
  if (!row) throw new AccountError("操作记录不存在", 404);
  const meta = isAuditAction(row.action) ? auditActionMeta(row.action) : null;
  return {
    ...row,
    reason: reasonOf(row),
    actionLabel: meta?.label ?? row.action,
    categoryLabel: auditCategoryLabels[row.category as keyof typeof auditCategoryLabels] ?? row.category,
    resultLabel: auditResultLabels[row.result as AuditResult] ?? row.result,
  };
}

export async function auditFilterOptions(sessionId: string) {
  const current = await getCurrentSession(sessionId);
  if (!current || current.user.role !== "ADMIN" || current.user.mustChangePassword) throw new AccountError("没有管理权限", 403);
  const [actions, roles] = await Promise.all([
    db.auditEvent.groupBy({ by: ["action"], _count: { _all: true }, orderBy: { _count: { action: "desc" } }, take: 200 }),
    db.auditEvent.groupBy({ by: ["actorRole"], _count: { _all: true } }),
  ]);
  return {
    actions: actions.map(row => ({ value: row.action, label: isAuditAction(row.action) ? auditActionMeta(row.action).label : row.action, count: row._count._all })),
    roles: roles.filter(row => row.actorRole).map(row => ({ value: row.actorRole, count: row._count._all })),
    categories: auditCategories.map(value => ({ value, label: auditCategoryLabels[value] })),
    results: results.map(value => ({ value, label: auditResultLabels[value] })),
  };
}

function csvCell(value: unknown) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function csvLine(values: unknown[]) {
  return `${values.map(csvCell).join(",")}\r\n`;
}

function detailsSummary(details: Prisma.JsonValue | null) {
  if (!details) return "";
  const text = JSON.stringify(details);
  return text.length > 600 ? `${text.slice(0, 600)}…` : text;
}

const activeExports = new Set<string>();

const exportInput = z.object({
  reason: z.string().trim().min(2, "请填写导出理由").max(500),
  password: z.string().min(1, "请输入当前密码").max(128),
  filters: z.record(z.string(), z.unknown()).default({}),
}).strict();

export async function exportAuditLogs(sessionId: string, input: unknown) {
  const data = exportInput.parse(input);
  if (!(await verifyAdminPassword(sessionId, data.password))) throw new AccountError("当前密码不正确", 401);
  const current = await getCurrentSession(sessionId);
  if (!current || current.user.role !== "ADMIN" || current.user.mustChangePassword) throw new AccountError("没有管理权限", 403);
  if (activeExports.has(current.userId)) throw new AccountError("已有日志导出任务正在进行，请等待完成", 409);
  const filters = filterSchema.parse(data.filters);
  if (filters.keyword && !filters.from && !filters.to) filters.from = new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString();
  const { where, from, to } = auditWhere(filters);
  const total = await db.auditEvent.count({ where });
  if (total > 100_000) throw new AccountError(`当前筛选命中 ${total} 条，超过单次导出上限 100000 条，请缩小时间范围或增加筛选条件`, 400);
  const actor = { id: current.user.id, name: current.user.name, login: current.user.login, role: current.user.role };
  const filterDetails = {
    from: from.toISOString(),
    to: to.toISOString(),
    actor: filters.actor ?? null,
    role: filters.role ?? null,
    category: filters.category ?? null,
    action: filters.action ?? null,
    result: filters.result ?? null,
    targetType: filters.targetType ?? null,
    targetId: filters.targetId ?? null,
    requestId: filters.requestId ?? null,
    keyword: filters.keyword ?? null,
    reason: filters.reason ?? null,
    total,
  };
  await recordAudit(db, { action: "AUDIT_LOG_EXPORT_STARTED", actorId: current.userId, actor, reason: data.reason, details: filterDetails });
  activeExports.add(current.userId);
  const startedAt = Date.now();
  const hash = createHash("sha256");
  let bytes = 0;
  let finished = false;
  let cursor: string | undefined;
  let first = true;
  const encoder = new TextEncoder();
  const filename = `audit-logs_${new Date().toISOString().replaceAll(/[-:]/g, "").slice(0, 15)}.csv`;

  const finalize = async (success: boolean) => {
    if (finished) return;
    finished = true;
    activeExports.delete(current.userId);
    try {
      await recordAudit(db, {
        action: success ? "AUDIT_LOG_EXPORTED" : "AUDIT_LOG_EXPORT_FAILED",
        actorId: current.userId,
        actor,
        reason: data.reason,
        result: success ? "SUCCESS" : "PARTIAL",
        details: { ...filterDetails, bytes, rows: total, durationMs: Date.now() - startedAt, sha256Prefix: hash.copy().digest("hex").slice(0, 16) },
      });
    } catch (error) {
      console.error("导出审计写入失败", error instanceof Error ? error.name : "UnknownError");
    }
  };

  const queryBatch = async () => {
    const cursorClause = cursorWhere(cursor);
    const rows = await db.auditEvent.findMany({
      where: cursorClause ? { AND: [where, cursorClause] } : where,
      select: listSelect,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 1_000,
    });
    if (rows.length) cursor = encodeCursor(rows.at(-1)!);
    return rows;
  };

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        let chunk = "";
        if (first) {
          first = false;
          chunk += "\uFEFF";
          chunk += csvLine(["时间（UTC）", "操作者姓名", "操作者账号", "角色", "分类", "动作", "目标类型", "目标名称", "目标ID", "理由", "结果", "IP", "请求ID", "路由", "详情摘要"]);
        }
        const rows = await queryBatch();
        if (!rows.length) {
          await finalize(true);
          controller.close();
          return;
        }
        for (const row of rows) {
          const item = present(row);
          chunk += csvLine([
            row.createdAt.toISOString(), row.actorName ?? "", row.actorLogin ?? "", row.actorRole ?? "",
            item.categoryLabel, item.actionLabel, row.targetType ?? "", row.targetLabel ?? "", row.targetId ?? "",
            item.reason ?? "", item.resultLabel, row.ip ?? "", row.requestId ?? "", row.route ?? "", detailsSummary(row.details),
          ]);
        }
        const bytesChunk = encoder.encode(chunk);
        hash.update(bytesChunk);
        bytes += bytesChunk.byteLength;
        controller.enqueue(bytesChunk);
      } catch (error) {
        await finalize(false);
        controller.error(error);
      }
    },
    async cancel() {
      await finalize(false);
    },
  });
  return { stream, filename, total };
}

export const auditExportContentType = "text/csv; charset=utf-8";
export const auditExportCountLimit = 100_000;
export { pageSizes as auditPageSizes };
