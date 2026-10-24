import { z } from "zod";
import { db } from "@/server/db";
import { AccountError } from "@/server/account-error";
import { getCurrentSession, verifyAdminPassword } from "@/server/auth";
import { adminTransaction } from "@/server/accounts";
import { recordAudit } from "@/server/audit";
import { diskSpace, OpsError, withOpsLock, backupRoot } from "@/server/ops-common";

export const defaultOpsPolicy = {
  auditRetentionDays: 180,
  auditAutoPurgeEnabled: true,
  backupRetentionCount: 14,
  backupSafetyRetentionDays: 7,
  previousDatabaseRetentionDays: 7,
  restoreReportRetentionDays: 180,
  restoreCandidateTtlMinutes: 30,
} as const;

const policySelect = {
  id: true,
  auditRetentionDays: true,
  auditAutoPurgeEnabled: true,
  backupRetentionCount: true,
  backupSafetyRetentionDays: true,
  previousDatabaseRetentionDays: true,
  restoreReportRetentionDays: true,
  restoreCandidateTtlMinutes: true,
  lastPurgeAt: true,
  lastPurgeCount: true,
  lastPurgeResult: true,
  lastRestoreAt: true,
  revision: true,
  updatedAt: true,
} as const;

export type OpsPolicy = Awaited<ReturnType<typeof readOpsPolicy>>;

export async function readOpsPolicy() {
  const existing = await db.systemPolicy.findUnique({ where: { id: "system" }, select: policySelect });
  if (existing) return existing;
  return db.systemPolicy.upsert({
    where: { id: "system" },
    create: { id: "system", ...defaultOpsPolicy },
    update: {},
    select: policySelect,
  });
}

const policyInput = z.object({
  revision: z.number().int().nonnegative(),
  auditRetentionDays: z.number().int().min(30).max(3650),
  auditAutoPurgeEnabled: z.boolean(),
  backupRetentionCount: z.number().int().min(1).max(100),
  backupSafetyRetentionDays: z.number().int().min(1).max(30),
  previousDatabaseRetentionDays: z.number().int().min(1).max(30),
  restoreReportRetentionDays: z.number().int().min(7).max(3650),
  restoreCandidateTtlMinutes: z.number().int().min(10).max(120),
  reason: z.string().trim().min(2, "请填写修改理由").max(500),
  password: z.string().min(1, "请输入当前密码").max(128),
}).strict();

export async function updateOpsPolicy(sessionId: string, input: unknown) {
  const data = policyInput.parse(input);
  if (!(await verifyAdminPassword(sessionId, data.password))) throw new AccountError("当前密码不正确", 401);
  return adminTransaction(sessionId, async (tx, actorId) => {
    const current = await tx.systemPolicy.findUnique({ where: { id: "system" } });
    const before = current ?? { id: "system", ...defaultOpsPolicy, revision: 0, lastPurgeAt: null, lastPurgeCount: null, lastPurgeResult: null, lastRestoreAt: null };
    if (data.revision !== before.revision) throw new AccountError("运行策略已变化，请刷新后重试", 409);
    const updated = await tx.systemPolicy.upsert({
      where: { id: "system" },
      create: {
        id: "system",
        auditRetentionDays: data.auditRetentionDays,
        auditAutoPurgeEnabled: data.auditAutoPurgeEnabled,
        backupRetentionCount: data.backupRetentionCount,
        backupSafetyRetentionDays: data.backupSafetyRetentionDays,
        previousDatabaseRetentionDays: data.previousDatabaseRetentionDays,
        restoreReportRetentionDays: data.restoreReportRetentionDays,
        restoreCandidateTtlMinutes: data.restoreCandidateTtlMinutes,
        revision: 0,
      },
      update: {
        auditRetentionDays: data.auditRetentionDays,
        auditAutoPurgeEnabled: data.auditAutoPurgeEnabled,
        backupRetentionCount: data.backupRetentionCount,
        backupSafetyRetentionDays: data.backupSafetyRetentionDays,
        previousDatabaseRetentionDays: data.previousDatabaseRetentionDays,
        restoreReportRetentionDays: data.restoreReportRetentionDays,
        restoreCandidateTtlMinutes: data.restoreCandidateTtlMinutes,
        revision: { increment: 1 },
      },
      select: policySelect,
    });
    const details = {
      before: {
        auditRetentionDays: before.auditRetentionDays,
        auditAutoPurgeEnabled: before.auditAutoPurgeEnabled,
        backupRetentionCount: before.backupRetentionCount,
        backupSafetyRetentionDays: before.backupSafetyRetentionDays,
        previousDatabaseRetentionDays: before.previousDatabaseRetentionDays,
        restoreReportRetentionDays: before.restoreReportRetentionDays,
        restoreCandidateTtlMinutes: before.restoreCandidateTtlMinutes,
      },
      after: {
        auditRetentionDays: updated.auditRetentionDays,
        auditAutoPurgeEnabled: updated.auditAutoPurgeEnabled,
        backupRetentionCount: updated.backupRetentionCount,
        backupSafetyRetentionDays: updated.backupSafetyRetentionDays,
        previousDatabaseRetentionDays: updated.previousDatabaseRetentionDays,
        restoreReportRetentionDays: updated.restoreReportRetentionDays,
        restoreCandidateTtlMinutes: updated.restoreCandidateTtlMinutes,
      },
    };
    const retentionChanged = before.auditRetentionDays !== updated.auditRetentionDays || before.auditAutoPurgeEnabled !== updated.auditAutoPurgeEnabled;
    await recordAudit(tx, {
      actorId,
      action: retentionChanged ? "AUDIT_RETENTION_CHANGED" : "SYSTEM_POLICY_UPDATED",
      targetType: "SystemPolicy",
      targetId: "system",
      targetLabel: "运行策略",
      reason: data.reason,
      details,
    });
    if (retentionChanged && (before.backupRetentionCount !== updated.backupRetentionCount || before.previousDatabaseRetentionDays !== updated.previousDatabaseRetentionDays || before.restoreReportRetentionDays !== updated.restoreReportRetentionDays)) {
      await recordAudit(tx, {
        actorId,
        action: "SYSTEM_POLICY_UPDATED",
        targetType: "SystemPolicy",
        targetId: "system",
        targetLabel: "运行策略",
        reason: data.reason,
        details,
      });
    }
    return updated;
  });
}

export function purgeCutoff(policy: Pick<OpsPolicy, "auditRetentionDays">, now = new Date()) {
  const retention = Math.max(30, policy.auditRetentionDays);
  return new Date(now.getTime() - retention * 24 * 60 * 60_000);
}

async function auditTableMetrics() {
  const [row] = await db.$queryRaw<{ tableBytes: bigint; databaseBytes: bigint; total: bigint }[]>`
    SELECT pg_total_relation_size('"AuditEvent"')::bigint AS "tableBytes",
           pg_database_size(current_database())::bigint AS "databaseBytes",
           (SELECT COUNT(*) FROM "AuditEvent")::bigint AS total`;
  return {
    tableBytes: Number(row?.tableBytes ?? 0),
    databaseBytes: Number(row?.databaseBytes ?? 0),
    total: Number(row?.total ?? 0),
  };
}

export async function previewAuditPurge(sessionId: string, retentionDays?: number) {
  const current = await getCurrentSession(sessionId);
  if (!current || current.user.role !== "ADMIN" || current.user.mustChangePassword) throw new AccountError("没有管理权限", 403);
  const policy = await readOpsPolicy();
  const days = retentionDays ? z.number().int().min(30).max(3650).parse(retentionDays) : policy.auditRetentionDays;
  const cutoff = purgeCutoff({ auditRetentionDays: days });
  const [count, first, last, metrics, disk] = await Promise.all([
    db.auditEvent.count({ where: { createdAt: { lt: cutoff } } }),
    db.auditEvent.findFirst({ where: { createdAt: { lt: cutoff } }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    db.auditEvent.findFirst({ where: { createdAt: { lt: cutoff } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    auditTableMetrics(),
    diskSpace(backupRoot()).catch(() => null),
  ]);
  return {
    count,
    cutoff,
    retentionDays: days,
    earliest: first?.createdAt ?? null,
    latest: last?.createdAt ?? null,
    tableBytes: metrics.tableBytes,
    databaseBytes: metrics.databaseBytes,
    totalRows: metrics.total,
    diskFreeBytes: disk?.freeBytes ?? null,
    warning: metrics.tableBytes >= 2 * 1024 ** 3 || (disk ? disk.freeBytes / disk.totalBytes < 0.2 : false),
    recoveryWindowActive: policy.lastRestoreAt ? Date.now() - policy.lastRestoreAt.getTime() < 24 * 60 * 60_000 : false,
  };
}

async function deleteAuditBatches(cutoff: Date) {
  let deleted = 0;
  for (;;) {
    const ids = await db.auditEvent.findMany({ where: { createdAt: { lt: cutoff } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 5_000, select: { id: true } });
    if (!ids.length) break;
    const result = await db.auditEvent.deleteMany({ where: { id: { in: ids.map(row => row.id) } } });
    deleted += result.count;
    if (result.count === 0) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return deleted;
}

export async function purgeAuditLogs(sessionId: string, input: unknown) {
  const data = z.object({
    reason: z.string().trim().min(2, "请填写清理理由").max(500),
    confirmPhrase: z.literal("清理日志", { error: "请输入确认短语“清理日志”" }),
    password: z.string().min(1, "请输入当前密码").max(128),
  }).strict().parse(input);
  if (!(await verifyAdminPassword(sessionId, data.password))) throw new AccountError("当前密码不正确", 401);
  return withOpsLock("purge", async () => {
    const current = await getCurrentSession(sessionId);
    if (!current || current.user.role !== "ADMIN" || current.user.mustChangePassword) throw new AccountError("没有管理权限", 403);
    const policy = await readOpsPolicy();
    const cutoff = purgeCutoff(policy);
    const before = await auditTableMetrics();
    const startedAt = Date.now();
    const deleted = await deleteAuditBatches(cutoff);
    const deletedAt = new Date();
    const updatedPolicy = await db.$transaction(async tx => {
      await recordAudit(tx, {
        actorId: current.userId,
        actor: { id: current.user.id, name: current.user.name, login: current.user.login, role: current.user.role },
        action: "AUDIT_LOG_PURGED",
        targetType: "AuditEvent",
        targetLabel: "操作日志",
        reason: data.reason,
        details: { trigger: "MANUAL", deleted, cutoff: cutoff.toISOString(), retentionDays: policy.auditRetentionDays, durationMs: Date.now() - startedAt },
      });
      return tx.systemPolicy.update({
        where: { id: "system" },
        data: { lastPurgeAt: deletedAt, lastPurgeCount: deleted, lastPurgeResult: `MANUAL:${deleted}` },
        select: policySelect,
      });
    });
    const after = await auditTableMetrics();
    return { deleted, cutoff, durationMs: Date.now() - startedAt, tableBytes: after.tableBytes, tableBytesBefore: before.tableBytes, policy: updatedPolicy };
  });
}

export async function runScheduledAuditPurge() {
  try {
    const policy = await readOpsPolicy();
    if (!policy.auditAutoPurgeEnabled) return { skipped: "DISABLED" as const };
    if (policy.lastRestoreAt && Date.now() - policy.lastRestoreAt.getTime() < 24 * 60 * 60_000) return { skipped: "RECOVERY_WINDOW" as const };
    return await withOpsLock("purge", async () => {
      const cutoff = purgeCutoff(policy);
      const startedAt = Date.now();
      const deleted = await deleteAuditBatches(cutoff);
      const completedAt = new Date();
      await db.$transaction(async tx => {
        await recordAudit(tx, {
          actor: { id: "", name: "系统任务", login: "system", role: "SYSTEM" },
          action: "AUDIT_LOG_PURGED",
          targetType: "AuditEvent",
          targetLabel: "操作日志",
          reason: "按保留策略自动清理",
          details: { trigger: "AUTO", deleted, cutoff: cutoff.toISOString(), retentionDays: policy.auditRetentionDays, durationMs: Date.now() - startedAt },
        });
        await tx.systemPolicy.update({ where: { id: "system" }, data: { lastPurgeAt: completedAt, lastPurgeCount: deleted, lastPurgeResult: `AUTO:${deleted}` } });
      });
      return { deleted, cutoff, auto: true };
    });
  } catch (error) {
    if (error instanceof OpsError && error.code === "TASK_BUSY") return { skipped: "BUSY" as const };
    console.error("自动清理审计日志失败", error instanceof Error ? error.name : "UnknownError");
    return { skipped: "ERROR" as const };
  }
}
