import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import archiver from "archiver";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { AccountError } from "@/server/account-error";
import { getCurrentSession, verifyAdminPassword } from "@/server/auth";
import { recordAudit } from "@/server/audit";
import { classKey } from "@/server/activity-policy";
import { attachmentRoot } from "@/server/activity-attachments";
import { evidenceRoot } from "@/server/evidence";
import { readRestoreStateSync } from "@/server/restore-state";

const maxExportFiles = 2_000;
const maxExportBytes = 2 * 1024 ** 3;
const pageSizes = [20, 50, 100] as const;

const scopeSchema = z.enum(["ALL", "COLLEGE", "MAJOR", "CLASS"]);
const activityStatusSchema = z.enum(["DRAFT", "WITHDRAWN", "ACTIVE", "ENDED"]);
const evidenceSourceSchema = z.enum(["RESULT", "CLAIM", "APPEAL", "ACTIVITY"]);
const referencedSchema = z.enum(["REFERENCED", "UNREFERENCED"]);

function scopeRefinement(data: { scope: z.infer<typeof scopeSchema>; college?: string; major?: string; className?: string }, ctx: z.RefinementCtx) {
  if (data.scope !== "ALL" && !data.college) ctx.addIssue({ code: "custom", path: ["college"], message: "请选择学院" });
  if ((data.scope === "MAJOR" || data.scope === "CLASS") && !data.major) ctx.addIssue({ code: "custom", path: ["major"], message: "请选择专业" });
  if (data.scope === "CLASS" && !data.className) ctx.addIssue({ code: "custom", path: ["className"], message: "请选择班级" });
}

const activityFilterBase = z.object({
  termId: z.string().trim().max(40).optional(),
  status: activityStatusSchema.optional(),
  keyword: z.string().trim().max(80).optional(),
  scope: scopeSchema.default("ALL"),
  college: z.string().trim().max(80).optional(),
  major: z.string().trim().max(80).optional(),
  className: z.string().trim().max(80).optional(),
  ownerCollegeId: z.string().trim().max(40).optional(),
  audienceScope: z.enum(["ALL", "COLLEGE", "CLASS"]).optional(),
  from: z.string().trim().max(40).optional(),
  to: z.string().trim().max(40).optional(),
}).strict();

const activityListSchema = activityFilterBase.extend({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().refine(value => (pageSizes as readonly number[]).includes(value), "分页大小无效").default(20),
}).superRefine(scopeRefinement);

const activityExportSchema = z.object({
  reason: z.string().trim().min(2, "请填写导出理由").max(500),
  password: z.string().min(1, "请输入当前密码").max(128),
  filters: activityFilterBase.superRefine(scopeRefinement),
}).strict();

const evidenceFilterBase = z.object({
  scope: scopeSchema.default("ALL"),
  college: z.string().trim().max(80).optional(),
  major: z.string().trim().max(80).optional(),
  className: z.string().trim().max(80).optional(),
  from: z.string().trim().max(40).optional(),
  to: z.string().trim().max(40).optional(),
  source: evidenceSourceSchema.optional(),
  referenced: referencedSchema.optional(),
  keyword: z.string().trim().max(80).optional(),
}).strict();

const evidenceListSchema = evidenceFilterBase.extend({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().refine(value => (pageSizes as readonly number[]).includes(value), "分页大小无效").default(20),
}).superRefine(scopeRefinement);

const evidenceExportSchema = z.object({
  reason: z.string().trim().min(2, "请填写导出理由").max(500),
  password: z.string().min(1, "请输入当前密码").max(128),
  filters: evidenceFilterBase.superRefine(scopeRefinement),
}).strict();

type ActivityFilterInput = z.infer<typeof activityFilterBase>;
type EvidenceFilterInput = z.infer<typeof evidenceFilterBase>;

function timeRange(from: string | undefined, to: string | undefined) {
  const parse = (value: string | undefined, label: string) => {
    if (!value) return undefined;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new AccountError(`${label}格式无效`, 400);
    return date;
  };
  const start = parse(from, "开始时间");
  const end = parse(to, "结束时间");
  if (start && end && start > end) throw new AccountError("开始时间不能晚于结束时间", 400);
  return { start, end };
}

async function requireAdmin(sessionId: string) {
  const current = await getCurrentSession(sessionId);
  if (!current || current.user.role !== "ADMIN" || current.user.mustChangePassword) throw new AccountError("没有管理权限", 403);
  return current;
}

function assertNoActiveRestore() {
  const state = readRestoreStateSync();
  if (state && !["completed", "failed", "rolled-back"].includes(state.phase)) throw new AccountError("数据库恢复任务正在进行，暂时不能导出附件", 409);
}

async function classScopeKeys(scope: { scope: z.infer<typeof scopeSchema>; college?: string; major?: string; className?: string }) {
  if (scope.scope === "ALL" || scope.scope === "COLLEGE") {
    if (scope.scope === "COLLEGE") {
      const rows = await db.schoolClass.findMany({
        where: { major: { college: { name: scope.college } } },
        select: { name: true, major: { select: { name: true, college: { select: { name: true } } } } },
        take: 5_000,
      });
      return rows.map(row => classKey({ college: row.major.college.name, major: row.major.name, className: row.name }));
    }
    return [];
  }
  if (scope.scope === "MAJOR") {
    const rows = await db.schoolClass.findMany({
      where: { major: { name: scope.major, college: { name: scope.college } } },
      select: { name: true, major: { select: { name: true, college: { select: { name: true } } } } },
      take: 5_000,
    });
    return rows.map(row => classKey({ college: row.major.college.name, major: row.major.name, className: row.name }));
  }
  return [classKey({ college: scope.college!, major: scope.major!, className: scope.className! })];
}

async function audienceWhere(scope: ActivityFilterInput): Promise<Prisma.ActivityWhereInput | null> {
  if (scope.scope === "ALL") return null;
  const keys = await classScopeKeys(scope);
  return {
    OR: [
      { audienceScope: "ALL" },
      { audienceScope: "COLLEGE", audienceColleges: { has: scope.college! } },
      { audienceScope: "CLASS", audienceClasses: { hasSome: keys } },
    ],
  };
}

function statusWhere(status: ActivityFilterInput["status"], now: Date): Prisma.ActivityWhereInput | null {
  if (!status) return null;
  if (status === "DRAFT") return { publishedAt: null, publishRevision: 0 };
  if (status === "WITHDRAWN") return { publishedAt: null, publishRevision: { gt: 0 } };
  if (status === "ACTIVE") return { publishedAt: { not: null }, endedAt: null, endsAt: { gte: now } };
  return { publishedAt: { not: null }, OR: [{ endedAt: { not: null } }, { endsAt: { lt: now } }] };
}

async function activityWhere(filters: ActivityFilterInput): Promise<Prisma.ActivityWhereInput> {
  const { start, end } = timeRange(filters.from, filters.to);
  const and: Prisma.ActivityWhereInput[] = [{ attachments: { some: {} } }];
  if (filters.termId) and.push({ termId: filters.termId });
  const status = statusWhere(filters.status, new Date());
  if (status) and.push(status);
  if (filters.audienceScope) and.push({ audienceScope: filters.audienceScope });
  if (filters.ownerCollegeId === "NONE") and.push({ collegeId: null });
  else if (filters.ownerCollegeId) and.push({ collegeId: filters.ownerCollegeId });
  if (filters.keyword) {
    const keyword = filters.keyword;
    and.push({
      OR: [
        { name: { contains: keyword, mode: "insensitive" } },
        { organizer: { contains: keyword, mode: "insensitive" } },
        { attachments: { some: { name: { contains: keyword, mode: "insensitive" } } } },
      ],
    });
  }
  if (start || end) {
    and.push({ attachments: { some: { createdAt: { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) } } } });
  }
  const audience = await audienceWhere(filters);
  if (audience) and.push(audience);
  return { AND: and };
}

function activityStatus(row: { publishedAt: Date | null; publishRevision: number; endedAt: Date | null; endsAt: Date }) {
  if (!row.publishedAt) return row.publishRevision > 0 ? ("WITHDRAWN" as const) : ("DRAFT" as const);
  if (row.endedAt || row.endsAt.getTime() < Date.now()) return "ENDED" as const;
  return "ACTIVE" as const;
}

const statusLabels = { DRAFT: "未发布", WITHDRAWN: "已撤回", ACTIVE: "进行中", ENDED: "已结束" } as const;
const audienceScopeLabels = { ALL: "全校", COLLEGE: "学院", CLASS: "班级" } as const;

function parseClassKey(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 3) return null;
    const [college, major, className] = parsed;
    if (typeof college !== "string" || typeof major !== "string" || typeof className !== "string") return null;
    if (!college || !major || !className) return null;
    return { college, major, className };
  } catch {
    return null;
  }
}

type Directory = { colleges: Set<string>; classes: Set<string> };
let directoryCache: { at: number; value: Directory } | null = null;

async function currentDirectory(): Promise<Directory> {
  if (directoryCache && Date.now() - directoryCache.at < 30_000) return directoryCache.value;
  const [colleges, classes] = await Promise.all([
    db.college.findMany({ select: { name: true } }),
    db.schoolClass.findMany({ select: { name: true, major: { select: { name: true, college: { select: { name: true } } } } } }),
  ]);
  const value = {
    colleges: new Set(colleges.map(row => row.name)),
    classes: new Set(classes.map(row => classKey({ college: row.major.college.name, major: row.major.name, className: row.name }))),
  };
  directoryCache = { at: Date.now(), value };
  return value;
}

async function audienceHealth(filters: Pick<ActivityFilterInput, "termId">) {
  const directory = await currentDirectory();
  const rows = await db.activity.findMany({
    where: { ...(filters.termId ? { termId: filters.termId } : {}), audienceScope: { in: ["COLLEGE", "CLASS"] } },
    select: { audienceScope: true, audienceColleges: true, audienceClasses: true },
  });
  let unmatchedCollegeActivities = 0;
  let unmatchedCollegeKeys = 0;
  let unmatchedClassActivities = 0;
  let unmatchedClassKeys = 0;
  for (const row of rows) {
    const unmatched = row.audienceScope === "COLLEGE"
      ? row.audienceColleges.filter(name => !directory.colleges.has(name))
      : row.audienceClasses.filter(key => !directory.classes.has(key));
    if (!unmatched.length) continue;
    if (row.audienceScope === "COLLEGE") {
      unmatchedCollegeActivities += 1;
      unmatchedCollegeKeys += unmatched.length;
    } else {
      unmatchedClassActivities += 1;
      unmatchedClassKeys += unmatched.length;
    }
  }
  return { unmatchedCollegeActivities, unmatchedCollegeKeys, unmatchedClassActivities, unmatchedClassKeys };
}

function audienceView(row: { audienceScope: "ALL" | "COLLEGE" | "CLASS"; audienceColleges: string[]; audienceClasses: string[] }, directory: Directory) {
  const targets = row.audienceScope === "CLASS"
    ? row.audienceClasses.map(key => {
        const parsed = parseClassKey(key);
        return { key, ...(parsed ?? { college: null, major: null, className: null }), matched: directory.classes.has(key) };
      })
    : [];
  return {
    scope: row.audienceScope,
    scopeLabel: audienceScopeLabels[row.audienceScope],
    colleges: row.audienceScope === "COLLEGE" ? row.audienceColleges : [],
    collegesUnmatched: row.audienceScope === "COLLEGE" ? row.audienceColleges.filter(name => !directory.colleges.has(name)) : [],
    classes: targets,
  };
}

function latestUploader(ids: string[], users: Map<string, { name: string; login: string }>) {
  if (!ids.length) return null;
  const user = users.get(ids[0]);
  return user ? user.name : "已删除账号";
}

export async function listAttachmentActivities(sessionId: string, rawFilters: Record<string, string>) {
  await requireAdmin(sessionId);
  const filters = activityListSchema.parse(rawFilters);
  const where = await activityWhere(filters);
  const [total, attachmentSummary] = await Promise.all([
    db.activity.count({ where }),
    db.activityAttachment.aggregate({
      where: { activityId: { not: null }, activity: { is: where } },
      _count: { _all: true },
      _sum: { size: true },
    }),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / filters.pageSize));
  const page = Math.min(filters.page, pageCount);
  const rows = await db.activity.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * filters.pageSize,
    take: filters.pageSize,
    select: {
      id: true, name: true, organizer: true, termId: true, collegeId: true,
      audienceScope: true, audienceColleges: true, audienceClasses: true,
      publishedAt: true, publishRevision: true, endedAt: true, startsAt: true, endsAt: true, updatedAt: true,
      term: { select: { name: true } },
      college: { select: { name: true } },
    },
  });
  const ids = rows.map(row => row.id);
  const attachments = ids.length
    ? await db.activityAttachment.findMany({
        where: { activityId: { in: ids } },
        select: { id: true, activityId: true, name: true, mime: true, size: true, kind: true, createdAt: true, uploaderId: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      })
    : [];
  const uploaderIds = [...new Set(attachments.map(row => row.uploaderId))];
  const users = uploaderIds.length
    ? await db.user.findMany({ where: { id: { in: uploaderIds } }, select: { id: true, name: true, login: true } })
    : [];
  const userMap = new Map(users.map(user => [user.id, user]));
  const grouped = new Map<string, typeof attachments>();
  for (const attachment of attachments) {
    if (!attachment.activityId) continue;
    const list = grouped.get(attachment.activityId) ?? [];
    list.push(attachment);
    grouped.set(attachment.activityId, list);
  }
  const directory = await currentDirectory();
  const [health] = await Promise.all([audienceHealth(filters)]);
  const items = rows.map(row => {
    const files = grouped.get(row.id) ?? [];
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    const latest = files[0];
    return {
      id: row.id,
      name: row.name,
      organizer: row.organizer,
      termId: row.termId,
      termName: row.term.name,
      collegeId: row.collegeId,
      collegeName: row.college?.name ?? "未指定",
      status: activityStatus(row),
      statusLabel: statusLabels[activityStatus(row)],
      audience: audienceView(row, directory),
      startAt: row.startsAt,
      endAt: row.endsAt,
      updatedAt: row.updatedAt,
      publishedAt: row.publishedAt,
      attachmentCount: files.length,
      imageCount: files.filter(file => file.kind === "IMAGE").length,
      fileCount: files.filter(file => file.kind !== "IMAGE").length,
      totalBytes,
      latestUploadAt: latest?.createdAt ?? null,
      latestUploader: latest ? latestUploader([latest.uploaderId], userMap) : null,
    };
  });
  return {
    items,
    total,
    page,
    pageSize: filters.pageSize,
    pageCount,
    summary: { activities: total, attachments: attachmentSummary._count._all, bytes: attachmentSummary._sum.size ?? 0 },
    audienceHealth: health,
  };
}

export async function getAttachmentActivity(sessionId: string, id: string) {
  await requireAdmin(sessionId);
  const row = await db.activity.findUnique({
    where: { id },
    select: {
      id: true, name: true, organizer: true, termId: true, collegeId: true,
      audienceScope: true, audienceColleges: true, audienceClasses: true,
      publishedAt: true, publishRevision: true, endedAt: true, startsAt: true, endsAt: true, updatedAt: true,
      term: { select: { name: true } },
      college: { select: { name: true } },
      attachments: {
        select: { id: true, name: true, mime: true, size: true, kind: true, createdAt: true, uploaderId: true, sha256: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      },
    },
  });
  if (!row) throw new AccountError("活动不存在", 404);
  const uploaderIds = [...new Set(row.attachments.map(file => file.uploaderId))];
  const users = uploaderIds.length
    ? await db.user.findMany({ where: { id: { in: uploaderIds } }, select: { id: true, name: true, login: true } })
    : [];
  const userMap = new Map(users.map(user => [user.id, user]));
  const directory = await currentDirectory();
  return {
    id: row.id,
    name: row.name,
    organizer: row.organizer,
    termName: row.term.name,
    collegeName: row.college?.name ?? "未指定",
    status: activityStatus(row),
    statusLabel: statusLabels[activityStatus(row)],
    audience: audienceView(row, directory),
    startAt: row.startsAt,
    endAt: row.endsAt,
    attachments: row.attachments.map(file => ({
      id: file.id,
      name: file.name,
      mime: file.mime,
      size: file.size,
      kind: file.kind,
      createdAt: file.createdAt,
      sha256: file.sha256,
      uploader: userMap.get(file.uploaderId)?.name ?? "已删除账号",
      url: `/api/activity-attachments/${file.id}`,
    })),
  };
}

async function evidenceOwnerIds(filters: EvidenceFilterInput) {
  if (filters.scope === "ALL") return null;
  const profiles = await db.studentProfile.findMany({
    where: {
      college: filters.college,
      ...(filters.major ? { major: filters.major } : {}),
      ...(filters.className ? { className: filters.className } : {}),
    },
    select: { userId: true },
  });
  return profiles.map(row => row.userId);
}

function evidenceRelations(filters: EvidenceFilterInput): Prisma.EvidenceWhereInput[] {
  const clauses: Prisma.EvidenceWhereInput[] = [];
  if (filters.source === "RESULT") clauses.push({ references: { some: {} } });
  if (filters.source === "CLAIM") clauses.push({ claimReferences: { some: {} } });
  if (filters.source === "APPEAL") clauses.push({ appealReferences: { some: {} } });
  if (filters.source === "ACTIVITY") clauses.push({ activityEvidence: { some: {} } });
  if (filters.referenced === "REFERENCED") {
    clauses.push({
      OR: [
        { references: { some: {} } },
        { claimReferences: { some: {} } },
        { appealReferences: { some: {} } },
        { activityEvidence: { some: {} } },
      ],
    });
  }
  if (filters.referenced === "UNREFERENCED") {
    clauses.push({ references: { none: {} } });
    clauses.push({ claimReferences: { none: {} } });
    clauses.push({ appealReferences: { none: {} } });
    clauses.push({ activityEvidence: { none: {} } });
  }
  return clauses;
}

async function evidenceWhere(filters: EvidenceFilterInput): Promise<Prisma.EvidenceWhereInput> {
  const { start, end } = timeRange(filters.from, filters.to);
  const and: Prisma.EvidenceWhereInput[] = [...evidenceRelations(filters)];
  if (start || end) and.push({ createdAt: { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) } });
  const owners = await evidenceOwnerIds(filters);
  if (owners) and.push({ ownerId: { in: owners } });
  if (filters.keyword) {
    const keyword = filters.keyword;
    const users = await db.user.findMany({
      where: {
        OR: [
          { name: { contains: keyword, mode: "insensitive" } },
          { studentProfile: { studentNumber: { contains: keyword, mode: "insensitive" } } },
        ],
      },
      select: { id: true },
      take: 5_000,
    });
    and.push({
      OR: [
        { name: { contains: keyword, mode: "insensitive" } },
        ...(users.length ? [{ ownerId: { in: users.map(user => user.id) } }] : []),
      ],
    });
  }
  return { AND: and };
}

type EvidenceSourceType = "RESULT" | "CLAIM" | "APPEAL" | "ACTIVITY";
const evidenceSourceLabels: Record<EvidenceSourceType, string> = {
  RESULT: "成果认定",
  CLAIM: "个人申报",
  APPEAL: "异议",
  ACTIVITY: "活动",
};

function evidenceSources(row: { references: number; claimReferences: number; appealReferences: number; activityEvidence: number }) {
  const sources: EvidenceSourceType[] = [];
  if (row.references) sources.push("RESULT");
  if (row.claimReferences) sources.push("CLAIM");
  if (row.appealReferences) sources.push("APPEAL");
  if (row.activityEvidence) sources.push("ACTIVITY");
  return sources;
}

async function evidenceUsers(ids: string[]) {
  if (!ids.length) return new Map<string, { id: string; name: string; login: string; role: string; disabled: boolean; studentProfile: { studentNumber: string; college: string; major: string; className: string } | null }>();
  const rows = await db.user.findMany({
    where: { id: { in: ids } },
    select: {
      id: true, name: true, login: true, role: true, disabled: true,
      studentProfile: { select: { studentNumber: true, college: true, major: true, className: true } },
    },
  });
  return new Map(rows.map(row => [row.id, row]));
}

export async function listEvidence(sessionId: string, rawFilters: Record<string, string>) {
  await requireAdmin(sessionId);
  const filters = evidenceListSchema.parse(rawFilters);
  const where = await evidenceWhere(filters);
  const [total, summary] = await Promise.all([
    db.evidence.count({ where }),
    db.evidence.aggregate({ where, _sum: { size: true } }),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / filters.pageSize));
  const page = Math.min(filters.page, pageCount);
  const rows = await db.evidence.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * filters.pageSize,
    take: filters.pageSize,
    select: {
      id: true, ownerId: true, name: true, mime: true, size: true, sha256: true, createdAt: true,
      _count: { select: { references: true, claimReferences: true, appealReferences: true, activityEvidence: true } },
    },
  });
  const users = await evidenceUsers([...new Set(rows.map(row => row.ownerId))]);
  const items = rows.map(row => {
    const owner = users.get(row.ownerId);
    const profile = owner?.role === "STUDENT" ? owner.studentProfile : null;
    const sources = evidenceSources({
      references: row._count.references,
      claimReferences: row._count.claimReferences,
      appealReferences: row._count.appealReferences,
      activityEvidence: row._count.activityEvidence,
    });
    return {
      id: row.id,
      ownerId: row.ownerId,
      ownerName: owner?.name ?? null,
      ownerLogin: owner?.login ?? null,
      ownerStatus: !owner ? "MISSING" as const : owner.role !== "STUDENT" ? "NOT_STUDENT" as const : !owner.studentProfile ? "NO_PROFILE" as const : "OK" as const,
      studentNumber: profile?.studentNumber ?? null,
      college: profile?.college ?? null,
      major: profile?.major ?? null,
      className: profile?.className ?? null,
      name: row.name,
      mime: row.mime,
      size: row.size,
      sha256: row.sha256,
      createdAt: row.createdAt,
      sources,
      sourcesLabel: sources.map(source => evidenceSourceLabels[source]).join("、") || "未引用",
      referenced: sources.length > 0,
      referenceCount: row._count.references + row._count.claimReferences + row._count.appealReferences + row._count.activityEvidence,
      url: `/api/evidence/${row.id}`,
    };
  });
  return {
    items,
    total,
    page,
    pageSize: filters.pageSize,
    pageCount,
    summary: { files: total, bytes: summary._sum.size ?? 0 },
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

function safeFilePart(name: string) {
  const base = name
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
    .replace(/\.+$/, "")
    .trim()
    .slice(0, 100);
  if (!base) return "未命名文件";
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i.test(base)) return `_${base}`;
  return base;
}

function exportStamp(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function downloadName(filename: string) {
  return { "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}` };
}

async function inspectFile(root: string, storageKey: string, size: number, sha256: string, pattern: RegExp) {
  if (!pattern.test(storageKey)) return { ok: false as const, code: "STORAGE_KEY_INVALID" };
  const path = join(root, storageKey);
  const info = await stat(path).catch(() => null);
  if (!info || !info.isFile()) return { ok: false as const, code: "FILE_MISSING" };
  if (info.size !== size) return { ok: false as const, code: "SIZE_MISMATCH" };
  try {
    const hash = createHash("sha256");
    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(path);
      stream.on("data", chunk => hash.update(chunk));
      stream.on("error", reject);
      stream.on("end", resolve);
    });
    if (hash.digest("hex") !== sha256) return { ok: false as const, code: "HASH_MISMATCH" };
  } catch {
    return { ok: false as const, code: "READ_FAILED" };
  }
  return { ok: true as const, path };
}

function zipStream(archive: archiver.Archiver): ReadableStream<Uint8Array> {
  return Readable.toWeb(archive) as unknown as ReadableStream<Uint8Array>;
}

function finalizeAudit(action: "ACTIVITY_ATTACHMENTS_EXPORTED" | "STUDENT_EVIDENCE_EXPORTED" | "ACTIVITY_ATTACHMENTS_EXPORT_FAILED" | "STUDENT_EVIDENCE_EXPORT_FAILED", actor: { id: string; name: string; login: string; role: string }, reason: string, details: Record<string, unknown>) {
  void recordAudit(db, {
    actorId: actor.id,
    actor: { id: actor.id, name: actor.name, login: actor.login, role: actor.role },
    action,
    reason,
    result: details.partial ? "PARTIAL" : action.endsWith("FAILED") ? "FAILURE" : "SUCCESS",
    details,
  }).catch(error => console.error("附件导出审计写入失败", error instanceof Error ? error.name : "UnknownError"));
}

export async function exportActivityAttachments(sessionId: string, input: unknown) {
  const data = activityExportSchema.parse(input);
  if (!(await verifyAdminPassword(sessionId, data.password))) throw new AccountError("当前密码不正确", 401);
  const current = await requireAdmin(sessionId);
  assertNoActiveRestore();
  const filters = data.filters;
  const where = await activityWhere(filters);
  const [activityCount, fileCount, sizeSum] = await Promise.all([
    db.activity.count({ where }),
    db.activityAttachment.count({ where: { activityId: { not: null }, activity: { is: where } } }),
    db.activityAttachment.aggregate({ where: { activityId: { not: null }, activity: { is: where } }, _sum: { size: true } }),
  ]);
  if (!fileCount) throw new AccountError("当前筛选范围内没有可导出的附件", 404);
  if (fileCount > maxExportFiles) throw new AccountError(`当前筛选命中 ${fileCount} 个附件，超过单次 ${maxExportFiles} 个上限，请缩小范围`, 413);
  if ((sizeSum._sum.size ?? 0) > maxExportBytes) throw new AccountError("当前筛选附件总大小超过 2 GiB，请缩小范围后导出", 413);
  const activities = await db.activity.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    select: {
      id: true, name: true, organizer: true,
      term: { select: { name: true } },
      college: { select: { name: true } },
      attachments: {
        select: { id: true, name: true, mime: true, size: true, kind: true, sha256: true, storageKey: true, createdAt: true, uploaderId: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      },
    },
  });
  const uploaderIds = [...new Set(activities.flatMap(activity => activity.attachments.map(file => file.uploaderId)))];
  const users = uploaderIds.length
    ? await db.user.findMany({ where: { id: { in: uploaderIds } }, select: { id: true, name: true } })
    : [];
  const userMap = new Map(users.map(user => [user.id, user.name]));
  const actor = { id: current.user.id, name: current.user.name, login: current.user.login, role: current.user.role };
  const filterDetails = {
    termId: filters.termId ?? null,
    status: filters.status ?? null,
    keyword: filters.keyword ?? null,
    scope: filters.scope,
    college: filters.college ?? null,
    major: filters.major ?? null,
    className: filters.className ?? null,
    ownerCollegeId: filters.ownerCollegeId ?? null,
    audienceScope: filters.audienceScope ?? null,
    from: filters.from ?? null,
    to: filters.to ?? null,
    activities: activityCount,
    files: fileCount,
    bytes: sizeSum._sum.size ?? 0,
  };
  await recordAudit(db, { action: "ACTIVITY_ATTACHMENTS_EXPORT_STARTED", actorId: actor.id, actor, reason: data.reason, details: filterDetails });
  const startedAt = Date.now();
  const manifest: unknown[][] = [["活动ID", "活动名称", "学期", "组织者", "归属学院", "附件ID", "文件名", "类型", "大小（字节）", "SHA-256", "上传时间", "上传人", "状态"]];
  const failures: unknown[][] = [["活动ID", "活动名称", "附件ID", "文件名", "错误码"]];
  const entries: { path: string; name: string }[] = [];
  let failed = 0;
  for (const activity of activities) {
    const folder = `activities/${activity.id}_${safeFilePart(activity.name)}`;
    for (const [index, file] of activity.attachments.entries()) {
      const inspected = await inspectFile(attachmentRoot(), file.storageKey, file.size, file.sha256, /^[a-f0-9]{48}\.[a-z0-9]{1,10}$/);
      const uploader = userMap.get(file.uploaderId) ?? "已删除账号";
      if (!inspected.ok) {
        failed += 1;
        manifest.push([activity.id, activity.name, activity.term.name, activity.organizer, activity.college?.name ?? "", file.id, file.name, file.kind, file.size, file.sha256, file.createdAt.toISOString(), uploader, `失败：${inspected.code}`]);
        failures.push([activity.id, activity.name, file.id, file.name, inspected.code]);
        continue;
      }
      const zipName = `${folder}/${String(index + 1).padStart(4, "0")}_${safeFilePart(file.name)}`;
      entries.push({ path: inspected.path, name: zipName });
      manifest.push([activity.id, activity.name, activity.term.name, activity.organizer, activity.college?.name ?? "", file.id, file.name, file.kind, file.size, file.sha256, file.createdAt.toISOString(), uploader, "成功"]);
    }
  }
  const partial = failed > 0;
  const exportDetails = { ...filterDetails, failed, exported: entries.length, durationMs: Date.now() - startedAt, partial };
  const archive = archiver("zip", { zlib: { level: 6 } });
  let finished = false;
  const finish = (action: "ACTIVITY_ATTACHMENTS_EXPORTED" | "ACTIVITY_ATTACHMENTS_EXPORT_FAILED", extra: Record<string, unknown> = {}) => {
    if (finished) return;
    finished = true;
    finalizeAudit(action, actor, data.reason, { ...exportDetails, ...extra, durationMs: Date.now() - startedAt });
  };
  archive.on("warning", error => console.error("附件导出压缩警告", error.name));
  archive.on("error", error => {
    console.error("附件导出压缩失败", error.name);
    finish("ACTIVITY_ATTACHMENTS_EXPORT_FAILED", { errorCode: "ZIP_FAILED" });
  });
  archive.once("end", () => finish("ACTIVITY_ATTACHMENTS_EXPORTED"));
  archive.append(`\uFEFF${manifest.map(csvLine).join("")}`, { name: "manifest.csv" });
  if (partial) archive.append(`\uFEFF${failures.map(csvLine).join("")}`, { name: "errors.csv" });
  for (const entry of entries) {
    const file = createReadStream(entry.path);
    file.on("error", error => archive.destroy(error));
    archive.append(file, { name: entry.name });
  }
  void archive.finalize().catch(() => undefined);
  const filename = `activity-attachments_${exportStamp()}.zip`;
  return {
    stream: zipStream(archive),
    filename,
    headers: {
      ...downloadName(filename),
      "Content-Type": "application/zip",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Export-Status": partial ? "PARTIAL" : "SUCCEEDED",
      "X-Export-Files": String(entries.length),
      "X-Export-Failed": String(failed),
      "X-Export-Activities": String(activities.length),
    },
  };
}

export async function exportStudentEvidence(sessionId: string, input: unknown) {
  const data = evidenceExportSchema.parse(input);
  if (!(await verifyAdminPassword(sessionId, data.password))) throw new AccountError("当前密码不正确", 401);
  const current = await requireAdmin(sessionId);
  assertNoActiveRestore();
  const filters = data.filters;
  const where = await evidenceWhere(filters);
  const [total, sizeSum] = await Promise.all([
    db.evidence.count({ where }),
    db.evidence.aggregate({ where, _sum: { size: true } }),
  ]);
  if (!total) throw new AccountError("当前筛选范围内没有可导出的学生证明", 404);
  if (total > maxExportFiles) throw new AccountError(`当前筛选命中 ${total} 个证明，超过单次 ${maxExportFiles} 个上限，请缩小范围`, 413);
  if ((sizeSum._sum.size ?? 0) > maxExportBytes) throw new AccountError("当前筛选证明总大小超过 2 GiB，请缩小范围后导出", 413);
  const rows = await db.evidence.findMany({
    where,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true, ownerId: true, name: true, mime: true, size: true, sha256: true, storageKey: true, createdAt: true,
      _count: { select: { references: true, claimReferences: true, appealReferences: true, activityEvidence: true } },
    },
  });
  const users = await evidenceUsers([...new Set(rows.map(row => row.ownerId))]);
  const actor = { id: current.user.id, name: current.user.name, login: current.user.login, role: current.user.role };
  const filterDetails = {
    scope: filters.scope,
    college: filters.college ?? null,
    major: filters.major ?? null,
    className: filters.className ?? null,
    from: filters.from ?? null,
    to: filters.to ?? null,
    source: filters.source ?? null,
    referenced: filters.referenced ?? null,
    keyword: filters.keyword ?? null,
    files: total,
    bytes: sizeSum._sum.size ?? 0,
  };
  await recordAudit(db, { action: "STUDENT_EVIDENCE_EXPORT_STARTED", actorId: actor.id, actor, reason: data.reason, details: filterDetails });
  const startedAt = Date.now();
  const manifest: unknown[][] = [["证明ID", "文件名", "学生姓名", "学号", "学院", "专业", "班级", "档案状态", "大小（字节）", "SHA-256", "上传时间", "引用类型", "状态"]];
  const failures: unknown[][] = [["证明ID", "文件名", "学生姓名", "学号", "错误码"]];
  const entries: { path: string; name: string }[] = [];
  let failed = 0;
  for (const row of rows) {
    const owner = users.get(row.ownerId);
    const profile = owner?.role === "STUDENT" ? owner.studentProfile : null;
    const profileStatus = !owner ? "档案缺失" : owner.role !== "STUDENT" ? "非学生" : !profile ? "档案缺失" : "正常";
    const sources = evidenceSources({
      references: row._count.references,
      claimReferences: row._count.claimReferences,
      appealReferences: row._count.appealReferences,
      activityEvidence: row._count.activityEvidence,
    });
    const inspected = await inspectFile(evidenceRoot(), row.storageKey, row.size, row.sha256, /^[a-f0-9]{48}$/);
    if (!inspected.ok) {
      failed += 1;
      manifest.push([row.id, row.name, owner?.name ?? "", profile?.studentNumber ?? "", profile?.college ?? "", profile?.major ?? "", profile?.className ?? "", profileStatus, row.size, row.sha256, row.createdAt.toISOString(), sources.map(source => evidenceSourceLabels[source]).join("、"), `失败：${inspected.code}`]);
      failures.push([row.id, row.name, owner?.name ?? "", profile?.studentNumber ?? "", inspected.code]);
      continue;
    }
    const zipName = `evidence/${row.id}_${safeFilePart(row.name)}`;
    entries.push({ path: inspected.path, name: zipName });
    manifest.push([row.id, row.name, owner?.name ?? "", profile?.studentNumber ?? "", profile?.college ?? "", profile?.major ?? "", profile?.className ?? "", profileStatus, row.size, row.sha256, row.createdAt.toISOString(), sources.map(source => evidenceSourceLabels[source]).join("、"), "成功"]);
  }
  const partial = failed > 0;
  const exportDetails = { ...filterDetails, failed, exported: entries.length, durationMs: Date.now() - startedAt, partial };
  const archive = archiver("zip", { zlib: { level: 6 } });
  let finished = false;
  const finish = (action: "STUDENT_EVIDENCE_EXPORTED" | "STUDENT_EVIDENCE_EXPORT_FAILED", extra: Record<string, unknown> = {}) => {
    if (finished) return;
    finished = true;
    finalizeAudit(action, actor, data.reason, { ...exportDetails, ...extra, durationMs: Date.now() - startedAt });
  };
  archive.on("warning", error => console.error("证明导出压缩警告", error.name));
  archive.on("error", error => {
    console.error("证明导出压缩失败", error.name);
    finish("STUDENT_EVIDENCE_EXPORT_FAILED", { errorCode: "ZIP_FAILED" });
  });
  archive.once("end", () => finish("STUDENT_EVIDENCE_EXPORTED"));
  archive.append(`\uFEFF${manifest.map(csvLine).join("")}`, { name: "manifest.csv" });
  if (partial) archive.append(`\uFEFF${failures.map(csvLine).join("")}`, { name: "errors.csv" });
  for (const entry of entries) {
    const file = createReadStream(entry.path);
    file.on("error", error => archive.destroy(error));
    archive.append(file, { name: entry.name });
  }
  void archive.finalize().catch(() => undefined);
  const filename = `student-evidence_${exportStamp()}.zip`;
  return {
    stream: zipStream(archive),
    filename,
    headers: {
      ...downloadName(filename),
      "Content-Type": "application/zip",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Export-Status": partial ? "PARTIAL" : "SUCCEEDED",
      "X-Export-Files": String(entries.length),
      "X-Export-Failed": String(failed),
    },
  };
}
