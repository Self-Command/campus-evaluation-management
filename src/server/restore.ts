import { createHash, createHmac, randomBytes } from "node:crypto";
import type { AuditEvent } from "@/generated/prisma/client";
import { createWriteStream, existsSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { Client } from "pg";
import { z } from "zod";
import { db } from "@/server/db";
import { AccountError } from "@/server/account-error";
import { getCurrentSession, verifyAdminPassword } from "@/server/auth";
import { recordAudit, recordAuditBestEffort } from "@/server/audit";
import { readOpsPolicy } from "@/server/ops-policy";
import { localMigrations } from "@/server/migration-catalog";
import { evidenceRoot } from "@/server/evidence";
import { attachmentRoot } from "@/server/activity-attachments";
import { createSafetySnapshot, dumpPath, loadManifest } from "@/server/backup";
import {
  OpsError,
  assertPgTools,
  backupRoot,
  connectionStringFor,
  databaseConfig,
  diskSpace,
  ensurePrivateDir,
  fileInfo,
  maxRestoreAuditBytes,
  pgEnv,
  pgTool,
  quoteIdent,
  reportsRoot,
  runBinary,
  serverVersion,
  sha256File,
  shortDatabaseName,
  validDatabaseName,
  withClient,
  withOpsLock,
  writeJsonAtomic,
  readJson,
} from "@/server/ops-common";
import {
  patchRestoreState,
  readRestoreState,
  readRestoreStateSync,
  writeRestoreState,
  type RestoreState,
} from "@/server/restore-state";

const keyTables = ["User", "StudentProfile", "Term", "Activity", "Publication", "Claim", "Evidence", "ActivityAttachment", "Participation", "RecognitionSource", "Appeal", "AuditEvent"];
const terminalPhases = new Set(["completed", "failed", "rolled-back"]);
const confirmPhrase = "替换数据库";

type RowCounts = Record<string, number>;

export type RestoreReport = {
  restoreId: string;
  backupId: string;
  backupFilename: string;
  backupCreatedAt: string;
  backupBytes: number;
  backupHashMatched: boolean;
  generatedAt: string;
  status: "READY" | "REJECTED" | "COMPLETED" | "FAILED" | "ROLLED_BACK";
  restoreMode: string;
  includesFiles: false;
  blockers: { code: string; message: string }[];
  warnings: string[];
  migrations: {
    backupCount: number;
    localCount: number;
    needsForwardMigration: boolean;
    appliedNow: string[];
    checksumVerified: boolean;
    pendingAfter: number;
  };
  data: {
    currentDatabaseBytes: number;
    candidateDatabaseBytes: number;
    current: Record<string, number>;
    restored: Record<string, number>;
    currentTableCount: number;
    restoredTableCount: number;
    structureMissing: { name: string; currentRows: number }[];
  };
  audit: {
    afterBackup: number;
    byCategory: { category: string; count: number }[];
    sidecarEvents: number;
    sidecarBytes: number;
    sidecarSha256: string;
    firstAt: string | null;
    lastAt: string | null;
    imported: number;
    skipped: number;
  };
  admins: {
    restored: { login: string; name: string; mustChangePassword: boolean }[];
    operatorPresent: boolean;
    eligible: boolean;
  };
  sessions: { authSessions: number; loginFailureStates: number; captchas: number; attempts: number; oldPasswordHashes: boolean };
  settings: { key: string; current: unknown; restored: unknown }[];
  files: {
    evidenceRows: number;
    attachmentRows: number;
    currentEvidenceMissing: number;
    currentAttachmentMissing: number;
    restoredEvidenceMissing: number;
    restoredAttachmentMissing: number;
    evidenceOrphans: number;
    attachmentOrphans: number;
  };
  disk: { freeBytes: number | null; requiredBytes: number; currentDatabaseBytes: number; candidateDatabaseBytes: number };
  safetyBackupId: string | null;
  errorCode?: string;
  message?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
};

type PreflightFile = { report: RestoreReport; preflightAt: string; expiresAt: string; fingerprint: string; candidateDatabase: string };

function reasonField(label = "理由") {
  return z.string().trim().min(2, `请填写${label}`).max(500);
}

async function requireAdmin(sessionId: string) {
  const current = await getCurrentSession(sessionId);
  if (!current || current.user.role !== "ADMIN" || current.user.mustChangePassword) throw new AccountError("没有管理权限", 403);
  return current;
}

function sqlLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function restoreReportPath(id: string) {
  return join(reportsRoot(), id);
}

function preflightPath(id: string) {
  return join(restoreReportPath(id), "preflight.json");
}

function resultPath(id: string) {
  return join(restoreReportPath(id), "result.json");
}

function safeState(state: RestoreState) {
  return {
    id: state.id,
    backupId: state.backupId,
    phase: state.phase,
    maintenance: state.maintenance,
    switched: state.switched,
    startedAt: state.startedAt,
    updatedAt: state.updatedAt,
    completedAt: state.completedAt ?? null,
    safetyBackupId: state.safetyBackupId ?? null,
    reason: state.reason ?? null,
    auditExport: state.auditExport ?? null,
    errorCode: state.errorCode ?? null,
    message: state.message ?? null,
  };
}

export function restoreStatusToken(id: string) {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new OpsError("服务端缺少会话签名配置", "STATUS_TOKEN_UNAVAILABLE", 503);
  const payload = Buffer.from(JSON.stringify({ id, expires: Date.now() + 2 * 60 * 60_000 }), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function verifyRestoreStatusToken(token: string | undefined) {
  if (!token) return null;
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  if (signature.length !== expected.length || !createHash("sha256").update(signature).digest().equals(createHash("sha256").update(expected).digest())) return null;
  try {
    const parsed = z.object({ id: z.string(), expires: z.number() }).parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    if (parsed.expires < Date.now()) return null;
    return parsed.id;
  } catch {
    return null;
  }
}

async function databaseNames() {
  return withClient("postgres", async client => {
    const result = await client.query<{ datname: string }>("SELECT datname FROM pg_database");
    return new Set(result.rows.map(row => row.datname));
  });
}

async function terminateBackends(names: string[]) {
  await withClient("postgres", async client => {
    await client.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ANY($1::text[]) AND pid <> pg_backend_pid() AND backend_type = 'client backend'`,
      [names],
    );
  });
}

type TrackedDatabase = { name: string; createdAt: string; restoreId?: string };
type DatabaseRegistry = { candidates: TrackedDatabase[]; previous: TrackedDatabase[] };

function databaseRegistryPath() {
  return join(backupRoot(), "database-registry.json");
}

async function readDatabaseRegistry(): Promise<DatabaseRegistry> {
  const registry = await readJson<Partial<DatabaseRegistry>>(databaseRegistryPath());
  return {
    candidates: Array.isArray(registry?.candidates) ? registry.candidates.filter(item => typeof item?.name === "string") : [],
    previous: Array.isArray(registry?.previous) ? registry.previous.filter(item => typeof item?.name === "string") : [],
  };
}

async function trackDatabase(kind: keyof DatabaseRegistry, name: string, restoreId?: string) {
  const registry = await readDatabaseRegistry();
  if (!registry[kind].some(item => item.name === name)) {
    registry[kind].push({ name, createdAt: new Date().toISOString(), restoreId });
    await writeJsonAtomic(databaseRegistryPath(), registry);
  }
}

async function untrackDatabase(name: string) {
  const registry = await readDatabaseRegistry();
  const candidates = registry.candidates.filter(item => item.name !== name);
  const previous = registry.previous.filter(item => item.name !== name);
  if (candidates.length === registry.candidates.length && previous.length === registry.previous.length) return;
  await writeJsonAtomic(databaseRegistryPath(), { candidates, previous });
}

async function dropDatabaseRaw(name: string) {
  if (!validDatabaseName(name)) return;
  await withClient("postgres", async client => {
    await client.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid() AND backend_type = 'client backend'", [name]);
    await client.query(`DROP DATABASE IF EXISTS ${quoteIdent(name)}`);
  });
}

async function dropDatabase(name: string) {
  await dropDatabaseRaw(name);
  await untrackDatabase(name).catch(() => undefined);
}

async function cleanupTrackedDatabases(kind: keyof DatabaseRegistry, cutoff: number, keep?: string) {
  const registry = await readDatabaseRegistry();
  const names = await databaseNames();
  const kept: TrackedDatabase[] = [];
  let changed = false;
  for (const item of registry[kind]) {
    if (!names.has(item.name)) {
      changed = true;
      continue;
    }
    if (item.name === keep) {
      kept.push(item);
      continue;
    }
    const createdAt = Date.parse(item.createdAt);
    if (Number.isNaN(createdAt) || createdAt >= cutoff) {
      kept.push(item);
      continue;
    }
    try {
      await dropDatabaseRaw(item.name);
      changed = true;
    } catch (error) {
      kept.push(item);
      console.error("清理过期恢复数据库失败", kind, error instanceof Error ? error.name : "UnknownError");
    }
  }
  if (changed) await writeJsonAtomic(databaseRegistryPath(), { ...registry, [kind]: kept });
}

async function createCandidateDatabase(name: string) {
  if (!validDatabaseName(name)) throw new OpsError("候选数据库名称无效", "CANDIDATE_NAME_INVALID", 500);
  const info = await serverVersion();
  if (!info) throw new OpsError("无法读取数据库编码信息", "DATABASE_NOT_CONFIGURED", 503);
  await withClient("postgres", async client => {
    await client.query(
      `CREATE DATABASE ${quoteIdent(name)} WITH TEMPLATE template0 ENCODING ${sqlLiteral(info.encoding)} LC_COLLATE ${sqlLiteral(info.collate)} LC_CTYPE ${sqlLiteral(info.ctype)}`,
    );
  });
}

async function restoreDump(candidate: string, path: string) {
  await runBinary(
    pgTool("pg_restore"),
    ["--single-transaction", "--exit-on-error", "--no-owner", "--no-privileges", `--dbname=${candidate}`, path],
    { timeoutMs: 2 * 60 * 60_000, env: pgEnv(candidate), publicCode: "RESTORE_PG_RESTORE_FAILED", maxStdout: 1024 },
  );
}

function prismaInvocation() {
  const explicit = process.env.PRISMA_BIN?.trim();
  if (explicit) return { command: explicit, prefix: [] as string[] };
  const candidates = [
    join(process.cwd(), "node_modules", "prisma", "build", "index.js"),
    "/usr/local/lib/node_modules/prisma/build/index.js",
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return { command: process.execPath, prefix: [candidate] };
  }
  return { command: "prisma", prefix: [] as string[] };
}

async function migrateCandidate(candidate: string) {
  const { command, prefix } = prismaInvocation();
  const dockerConfig = join(process.cwd(), "prisma.docker.config.ts");
  const localConfig = join(process.cwd(), "prisma.config.ts");
  const config = existsSync(dockerConfig) ? dockerConfig : existsSync(localConfig) ? localConfig : null;
  const args = [...prefix, "migrate", "deploy", ...(config ? ["--config", config] : [])];
  await runBinary(command, args, {
    timeoutMs: 30 * 60_000,
    env: { DATABASE_URL: connectionStringFor(candidate) },
    publicCode: "CANDIDATE_MIGRATION_FAILED",
    maxStdout: 256 * 1024,
  });
}

async function migrationRows(client: Client) {
  const result = await client.query<{ migration_name: string; checksum: string; finished_at: Date | null; rolled_back_at: Date | null; started_at: Date }>(
    `SELECT migration_name, checksum, finished_at, rolled_back_at, started_at FROM "_prisma_migrations" ORDER BY started_at ASC`,
  );
  const latest = new Map<string, { name: string; checksum: string; finishedAt: Date | null; rolledBackAt: Date | null }>();
  const order: string[] = [];
  for (const row of result.rows) {
    if (!latest.has(row.migration_name)) order.push(row.migration_name);
    latest.set(row.migration_name, { name: row.migration_name, checksum: row.checksum, finishedAt: row.finished_at, rolledBackAt: row.rolled_back_at });
  }
  return { order, latest };
}

async function migrationCheck(client: Client) {
  const local = await localMigrations();
  const before = await migrationRows(client);
  const blockers: { code: string; message: string }[] = [];
  if (!before.order.length) blockers.push({ code: "MIGRATIONS_MISSING", message: "备份中没有迁移历史，无法证明结构与当前应用兼容" });
  for (const name of before.order) {
    const row = before.latest.get(name)!;
    const index = local.findIndex(item => item.name === name);
    if (index < 0) blockers.push({ code: "MIGRATION_UNKNOWN", message: `备份包含当前应用不认识的迁移：${name}` });
    else if (local[index].checksum !== row.checksum) blockers.push({ code: "MIGRATION_CHECKSUM", message: `迁移校验和不一致：${name}` });
    if (!row.finishedAt) blockers.push({ code: "MIGRATION_INCOMPLETE", message: `备份中存在未完成的迁移：${name}` });
    if (row.rolledBackAt) blockers.push({ code: "MIGRATION_ROLLED_BACK", message: `备份中存在已回滚的迁移：${name}` });
  }
  const expected = local.slice(0, before.order.length).map(item => item.name);
  if (before.order.length > local.length) blockers.push({ code: "MIGRATION_NEWER", message: "备份来自更新版本的应用，请先升级当前系统" });
  else if (before.order.some((name, index) => name !== expected[index])) blockers.push({ code: "MIGRATION_ORDER", message: "备份迁移顺序与当前应用不一致" });
  const needsMigration = blockers.length === 0 && before.order.length < local.length;
  return { before, blockers, needsMigration, appliedNow: [] as string[], local };
}

async function migrateAndVerify(client: Client, candidate: string) {
  const local = await localMigrations();
  const start = await migrationRows(client);
  await migrateCandidate(candidate);
  const after = await migrationRows(client);
  const appliedNow = local.slice(start.order.length).map(item => item.name);
  const blockers: { code: string; message: string }[] = [];
  for (let index = 0; index < local.length; index += 1) {
    const expected = local[index];
    const row = after.latest.get(expected.name);
    if (!row) blockers.push({ code: "MIGRATION_MISSING_AFTER_DEPLOY", message: `前向迁移后仍缺少：${expected.name}` });
    else {
      if (row.checksum !== expected.checksum) blockers.push({ code: "MIGRATION_CHECKSUM", message: `前向迁移校验和不一致：${expected.name}` });
      if (!row.finishedAt) blockers.push({ code: "MIGRATION_INCOMPLETE", message: `前向迁移未完成：${expected.name}` });
      if (row.rolledBackAt) blockers.push({ code: "MIGRATION_ROLLED_BACK", message: `前向迁移已回滚：${expected.name}` });
    }
  }
  if (after.order.length > local.length) blockers.push({ code: "MIGRATION_NEWER", message: "候选库迁移数量超过当前应用" });
  return { blockers, appliedNow, after };
}

async function tablesOf(client: Client) {
  const result = await client.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations' ORDER BY table_name`,
  );
  return result.rows.map(row => row.table_name);
}

async function tableCounts(client: Client, names?: string[]): Promise<RowCounts> {
  const tables = names ?? await tablesOf(client);
  const counts: RowCounts = {};
  for (const table of tables) {
    const result = await client.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM ${quoteIdent(table)}`);
    counts[table] = Number(result.rows[0]?.count ?? 0);
  }
  return counts;
}

async function keyCounts(client: Client) {
  const existing = new Set(await tablesOf(client));
  const names = keyTables.filter(name => existing.has(name));
  return tableCounts(client, names);
}

async function settingsOf(client: Client) {
  const result = await client.query<{ content: unknown; revision: number }>(`SELECT content, revision FROM "SiteSettings" WHERE id = 'site'`);
  return result.rows[0] ?? null;
}

const settingKeys = ["siteName", "siteDescription", "pageTitle", "themePreset", "loginFailureLimitEnabled", "loginFailureMaxAttempts", "loginFailureLockMinutes", "activityAttachmentMaxFiles", "activityAttachmentMaxSizeMb"];

function settingsDiff(current: unknown, restored: unknown) {
  const currentRecord = current && typeof current === "object" ? current as Record<string, unknown> : {};
  const restoredRecord = restored && typeof restored === "object" ? restored as Record<string, unknown> : {};
  return settingKeys.map(key => ({ key, current: currentRecord[key] ?? null, restored: restoredRecord[key] ?? null }));
}

async function adminRows(client: Client) {
  const result = await client.query<{ login: string; name: string; mustChangePassword: boolean; hasPassword: boolean }>(
    `SELECT login, name, "mustChangePassword", (COALESCE("passwordHash", '') <> '') AS "hasPassword" FROM "User" WHERE role = 'ADMIN' AND disabled = false ORDER BY login`,
  );
  return result.rows;
}

async function sessionStats(client: Client) {
  const result = await client.query<{ sessions: string; failures: string; captchas: string; attempts: string; active: string }>(
    `SELECT (SELECT COUNT(*) FROM "AuthSession")::text AS sessions,
            (SELECT COUNT(*) FROM "LoginFailureState")::text AS failures,
            (SELECT COUNT(*) FROM "LoginCaptcha")::text AS captchas,
            (SELECT COUNT(*) FROM "LoginAttempt")::text AS attempts,
            (SELECT COUNT(*) FROM "AuthSession" WHERE "revokedAt" IS NULL AND "expiresAt" > now())::text AS active`,
  );
  const row = result.rows[0];
  return { authSessions: Number(row?.active ?? 0), loginFailureStates: Number(row?.failures ?? 0), captchas: Number(row?.captchas ?? 0), attempts: Number(row?.attempts ?? 0) };
}

async function auditSummary(client: Client, backupCreatedAt: string) {
  const result = await client.query<{ after: string; events: string; bytes: string }>(
    `SELECT (SELECT COUNT(*) FROM "AuditEvent" WHERE "createdAt" > $1)::text AS after,
            (SELECT COUNT(*) FROM "AuditEvent")::text AS events,
            (SELECT COALESCE(SUM(pg_column_size(a)), 0) FROM "AuditEvent" a)::text AS bytes`,
    [backupCreatedAt],
  );
  const categories = await client.query<{ category: string; count: string }>(
    `SELECT category, COUNT(*)::text AS count FROM "AuditEvent" WHERE "createdAt" > $1 GROUP BY category ORDER BY COUNT(*) DESC`,
    [backupCreatedAt],
  );
  return {
    afterBackup: Number(result.rows[0]?.after ?? 0),
    events: Number(result.rows[0]?.events ?? 0),
    bytes: Number(result.rows[0]?.bytes ?? 0),
    byCategory: categories.rows.map(row => ({ category: row.category, count: Number(row.count) })),
  };
}

async function directoryNames(path: string) {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return new Set(entries.filter(entry => entry.isFile() && !entry.name.startsWith(".")).map(entry => entry.name));
  } catch {
    return new Set<string>();
  }
}

async function fileConsistency(client: Client) {
  const [evidenceKeys, attachmentKeys] = await Promise.all([
    client.query<{ key: string }>(`SELECT "storageKey" AS key FROM "Evidence"`),
    client.query<{ key: string }>(`SELECT "storageKey" AS key FROM "ActivityAttachment"`),
  ]);
  const [evidenceFiles, attachmentFiles] = await Promise.all([directoryNames(evidenceRoot()), directoryNames(attachmentRoot())]);
  const evidenceKeySet = new Set(evidenceKeys.rows.map(row => row.key));
  const attachmentKeySet = new Set(attachmentKeys.rows.map(row => row.key));
  return {
    evidenceRows: evidenceKeySet.size,
    attachmentRows: attachmentKeySet.size,
    currentEvidenceMissing: 0,
    currentAttachmentMissing: 0,
    restoredEvidenceMissing: [...evidenceKeySet].filter(key => !evidenceFiles.has(key)).length,
    restoredAttachmentMissing: [...attachmentKeySet].filter(key => !attachmentFiles.has(key)).length,
    evidenceOrphans: [...evidenceFiles].filter(key => !evidenceKeySet.has(key)).length,
    attachmentOrphans: [...attachmentFiles].filter(key => !attachmentKeySet.has(key)).length,
  };
}

async function fingerprintOf(client: Client) {
  const counts = await keyCounts(client);
  // Login, logout and failed re-authentication write AUTH audit rows. They are
  // not business data and must not invalidate an already-READY preflight.
  delete counts.AuditEvent;
  const latest = await client.query<{ id: string; createdAt: Date }>(
    `SELECT id, "createdAt" FROM "AuditEvent" WHERE COALESCE(category, '') <> 'AUTH' ORDER BY "createdAt" DESC, id DESC LIMIT 1`,
  );
  const settings = await settingsOf(client);
  const payload = {
    counts,
    latestAudit: latest.rows[0] ? { id: latest.rows[0].id, createdAt: latest.rows[0].createdAt.toISOString() } : null,
    settingsRevision: settings?.revision ?? 0,
  };
  return { fingerprint: createHash("sha256").update(JSON.stringify(payload)).digest("hex"), payload };
}

async function existingActiveState() {
  const state = readRestoreStateSync();
  if (!state || terminalPhases.has(state.phase)) return null;
  const policy = await readOpsPolicy().catch(() => null);
  const ttlMinutes = policy?.restoreCandidateTtlMinutes ?? 30;
  if (state.phase === "ready" && state.preflightExpiresAt && new Date(state.preflightExpiresAt).getTime() < Date.now()) {
    await dropDatabase(state.candidateDatabase).catch(() => undefined);
    await writeRestoreState({ ...state, phase: "failed", maintenance: false, errorCode: "PREFLIGHT_EXPIRED", message: "预检已过期", completedAt: new Date().toISOString() });
    return null;
  }
  if (state.phase === "ready" && !state.preflightExpiresAt) {
    return null;
  }
  if (Date.now() - new Date(state.updatedAt).getTime() > Math.max(ttlMinutes, 30) * 60_000 && ["preflight", "ready"].includes(state.phase)) {
    await dropDatabase(state.candidateDatabase).catch(() => undefined);
    await writeRestoreState({ ...state, phase: "failed", maintenance: false, errorCode: "PREFLIGHT_EXPIRED", message: "预检已过期", completedAt: new Date().toISOString() });
    return null;
  }
  return state;
}

export async function preflightRestore(sessionId: string, backupId: string, input: unknown) {
  const data = z.object({ reason: reasonField("预检理由") }).strict().parse(input);
  const current = await requireAdmin(sessionId);
  const policy = await readOpsPolicy();
  return withOpsLock("restore", async () => {
    const active = await existingActiveState();
    if (active) throw new OpsError("已有数据库恢复任务正在进行，请先完成或中止该任务", "RESTORE_IN_PROGRESS", 409);
    const previous = readRestoreStateSync();
    if (previous && !previous.switched && !terminalPhases.has(previous.phase)) await dropDatabase(previous.candidateDatabase).catch(() => undefined);
    const manifest = await loadManifest(backupId);
    if (manifest.status !== "SUCCEEDED") throw new OpsError("该备份尚未完成或已损坏", "BACKUP_NOT_READY", 409);
    const path = dumpPath(manifest);
    const info = await fileInfo(path);
    if (!info) throw new OpsError("备份文件不存在", "BACKUP_NOT_FOUND", 404);
    const versions = await assertPgTools();
    const server = await serverVersion();
    const serverMajor = Math.floor(Number(server?.version ?? 0) / 10_000);
    if (!serverMajor || versions.restore !== serverMajor) throw new OpsError("PostgreSQL 客户端版本与服务器不一致", "PG_VERSION_MISMATCH", 503);
    const backupHash = await sha256File(path);
    if (manifest.sha256 && backupHash !== manifest.sha256) throw new OpsError("备份文件哈希与清单不一致，文件可能已损坏", "BACKUP_HASH_MISMATCH", 400);
    const currentConfig = databaseConfig();
    const candidate = shortDatabaseName(currentConfig.database, `_r${Date.now().toString(36)}`);
    const restoreId = `rs_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`;
    await trackDatabase("candidates", candidate, restoreId);
    await createCandidateDatabase(candidate);
    try {
      await restoreDump(candidate, path);
      const candidateInfo = await withClient(candidate, async client => {
        const initial = await migrationCheck(client);
        let appliedNow: string[] = [];
        const blockers = [...initial.blockers];
        if (!blockers.length && initial.needsMigration) {
          const forward = await migrateAndVerify(client, candidate);
          appliedNow = forward.appliedNow;
          blockers.push(...forward.blockers);
        } else if (!blockers.length) {
          const after = await migrationRows(client);
          if (after.order.length !== initial.local.length) blockers.push({ code: "MIGRATION_INCOMPLETE", message: "迁移历史与当前应用不一致" });
        }
        const [tables, counts, keys, settings, admins, sessions] = await Promise.all([
          tablesOf(client),
          tableCounts(client),
          keyCounts(client),
          settingsOf(client),
          adminRows(client),
          sessionStats(client),
        ]);
        const audits = await auditSummary(client, manifest.createdAt);
        const files = await fileConsistency(client);
        const size = await client.query<{ bytes: string }>("SELECT pg_database_size(current_database())::text AS bytes");
        return { tables, counts, keys, settings, admins, sessions, audits, files, appliedNow, blockers, bytes: Number(size.rows[0]?.bytes ?? 0), migrations: initial };
      });
      const currentInfo = await withClient(currentConfig.database, async client => {
        const [tables, counts, keys, settings, sizes, audits, files] = await Promise.all([
          tablesOf(client),
          tableCounts(client),
          keyCounts(client),
          settingsOf(client),
          client.query<{ bytes: string }>("SELECT pg_database_size(current_database())::text AS bytes"),
          auditSummary(client, manifest.createdAt),
          fileConsistency(client),
        ]);
        return { tables, counts, keys, settings, sizes: Number(sizes.rows[0]?.bytes ?? 0), audits, files };
      });
      const free = await diskSpace(backupRoot()).catch(() => null);
      const structureMissing = currentInfo.tables.filter(table => !candidateInfo.tables.includes(table)).map(table => ({ name: table, currentRows: currentInfo.counts[table] ?? 0 }));
      const eligible = candidateInfo.admins.some(admin => admin.hasPassword);
      const operatorPresent = candidateInfo.admins.some(admin => admin.login === current.user.login);
      const blockers = [...candidateInfo.blockers];
      if (!eligible) blockers.push({ code: "NO_ADMIN", message: "备份中没有启用且具备密码的管理员账号，恢复后将无法登录" });
      const sidecarEstimate = Math.ceil(currentInfo.audits.bytes * 1.2) + 64 * 1024;
      if (sidecarEstimate > maxRestoreAuditBytes) blockers.push({ code: "AUDIT_EXPORT_TOO_LARGE", message: "当前审计日志过大，无法在切换前完整导出旁路，请先按保留策略清理日志" });
      if (free && free.freeBytes < candidateInfo.bytes + 512 * 1024 ** 2) blockers.push({ code: "DISK_SPACE_LOW", message: "磁盘剩余空间不足，无法保留安全快照和旧库" });
      const warnings: string[] = [];
      if (!operatorPresent) warnings.push("当前管理员不在备份中，恢复后必须使用备份内的管理员账号登录");
      if (currentInfo.audits.afterBackup > 0) warnings.push(`备份时间之后有 ${currentInfo.audits.afterBackup} 条审计事件，业务数据会被备份覆盖，审计事件会通过旁路保留`);
      if (structureMissing.length) warnings.push(`当前存在 ${structureMissing.length} 张备份中不存在的表，切换后将消失`);
      if (candidateInfo.files.restoredEvidenceMissing || candidateInfo.files.restoredAttachmentMissing) warnings.push("备份数据库中的证明或活动附件在文件卷中缺失，数据库恢复不能补回文件");
      const reportBody: RestoreReport = {
        restoreId,
        backupId: manifest.id,
        backupFilename: manifest.filename,
        backupCreatedAt: manifest.createdAt,
        backupBytes: manifest.bytes,
        backupHashMatched: backupHash === manifest.sha256,
        generatedAt: new Date().toISOString(),
        status: blockers.length ? "REJECTED" : "READY",
        restoreMode: "候选库验证后原子替换数据库名；不是原地覆盖，不支持行级合并",
        includesFiles: false,
        blockers,
        warnings,
        migrations: {
          backupCount: candidateInfo.migrations.before.order.length,
          localCount: candidateInfo.migrations.local.length,
          needsForwardMigration: candidateInfo.migrations.needsMigration,
          appliedNow: candidateInfo.appliedNow,
          checksumVerified: !blockers.some(item => item.code.startsWith("MIGRATION")),
          pendingAfter: 0,
        },
        data: {
          currentDatabaseBytes: currentInfo.sizes,
          candidateDatabaseBytes: candidateInfo.bytes,
          current: currentInfo.keys,
          restored: candidateInfo.keys,
          currentTableCount: currentInfo.tables.length,
          restoredTableCount: candidateInfo.tables.length,
          structureMissing,
        },
        audit: {
          afterBackup: currentInfo.audits.afterBackup,
          byCategory: currentInfo.audits.byCategory,
          sidecarEvents: currentInfo.audits.events,
          sidecarBytes: sidecarEstimate,
          sidecarSha256: "",
          firstAt: null,
          lastAt: null,
          imported: 0,
          skipped: 0,
        },
        admins: { restored: candidateInfo.admins.map(admin => ({ login: admin.login, name: admin.name, mustChangePassword: admin.mustChangePassword })), operatorPresent, eligible },
        sessions: { ...candidateInfo.sessions, oldPasswordHashes: true },
        settings: settingsDiff(currentInfo.settings?.content, candidateInfo.settings?.content),
        files: {
          evidenceRows: candidateInfo.files.evidenceRows,
          attachmentRows: candidateInfo.files.attachmentRows,
          currentEvidenceMissing: currentInfo.files.restoredEvidenceMissing,
          currentAttachmentMissing: currentInfo.files.restoredAttachmentMissing,
          restoredEvidenceMissing: candidateInfo.files.restoredEvidenceMissing,
          restoredAttachmentMissing: candidateInfo.files.restoredAttachmentMissing,
          evidenceOrphans: currentInfo.files.evidenceOrphans,
          attachmentOrphans: currentInfo.files.attachmentOrphans,
        },
        disk: { freeBytes: free?.freeBytes ?? null, requiredBytes: candidateInfo.bytes + 512 * 1024 ** 2, currentDatabaseBytes: currentInfo.sizes, candidateDatabaseBytes: candidateInfo.bytes },
        safetyBackupId: null,
      };
      const expiresAt = new Date(Date.now() + policy.restoreCandidateTtlMinutes * 60_000).toISOString();
      if (blockers.length) {
        await recordAudit(db, {
          actorId: current.userId,
          actor: { id: current.user.id, name: current.user.name, login: current.user.login, role: current.user.role },
          action: "DATABASE_RESTORE_PREFLIGHTED",
          targetType: "Backup",
          targetId: manifest.id,
          targetLabel: manifest.filename,
          reason: data.reason,
          result: "FAILURE",
          details: { restoreId, blockers: blockers.map(item => item.code), backupHashPrefix: backupHash.slice(0, 16) },
        });
        const preflight: PreflightFile = { report: reportBody, preflightAt: new Date().toISOString(), expiresAt, fingerprint: "", candidateDatabase: candidate };
        await writeJsonAtomic(preflightPath(restoreId), preflight);
        await dropDatabase(candidate);
        return { ok: false, restoreId, report: reportBody };
      }
      await recordAudit(db, {
        actorId: current.userId,
        actor: { id: current.user.id, name: current.user.name, login: current.user.login, role: current.user.role },
        action: "DATABASE_RESTORE_PREFLIGHTED",
        targetType: "Backup",
        targetId: manifest.id,
        targetLabel: manifest.filename,
        reason: data.reason,
        details: { restoreId, backupHashPrefix: backupHash.slice(0, 16), currentRows: currentInfo.keys.User ?? 0, restoredRows: candidateInfo.keys.User ?? 0, forwardMigrations: candidateInfo.appliedNow.length },
      });
      // The preflight audit is part of the database fingerprint, so it must be
      // written before the fingerprint used by the confirmation step.
      const fingerprintInfo = await withClient(currentConfig.database, client => fingerprintOf(client));
      const preflight: PreflightFile = { report: reportBody, preflightAt: new Date().toISOString(), expiresAt, fingerprint: fingerprintInfo.fingerprint, candidateDatabase: candidate };
      await writeJsonAtomic(preflightPath(restoreId), preflight);
      await writeRestoreState({
        id: restoreId,
        backupId: manifest.id,
        phase: "ready",
        maintenance: false,
        switched: false,
        candidateDatabase: candidate,
        previousDatabase: null,
        reportPath: preflightPath(restoreId),
        fingerprint: fingerprintInfo.fingerprint,
        preflightExpiresAt: expiresAt,
        reason: data.reason,
        actorId: current.user.id,
        actorName: current.user.name,
        actorLogin: current.user.login,
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      return { ok: true, restoreId, report: reportBody };
    } catch (error) {
      await dropDatabase(candidate).catch(() => undefined);
      throw error;
    }
  });
}

export async function abortPreflight(sessionId: string, restoreId: string, input: unknown) {
  const data = z.object({ reason: reasonField("中止理由") }).strict().parse(input);
  const current = await requireAdmin(sessionId);
  const state = await readRestoreState();
  if (!state || state.id !== restoreId) throw new OpsError("预检任务不存在", "RESTORE_NOT_FOUND", 404);
  if (state.phase !== "ready") throw new OpsError("当前阶段不能中止，请联系运维处理", "RESTORE_ABORT_NOT_ALLOWED", 409);
  await dropDatabase(state.candidateDatabase);
  await writeRestoreState({ ...state, phase: "failed", maintenance: false, completedAt: new Date().toISOString(), errorCode: "ABORTED", message: "管理员中止了恢复预检" });
  await recordAudit(db, {
    actorId: current.userId,
    actor: { id: current.user.id, name: current.user.name, login: current.user.login, role: current.user.role },
    action: "DATABASE_RESTORE_ABORTED",
    targetType: "Backup",
    targetId: state.backupId,
    reason: data.reason,
    details: { restoreId, phase: state.phase },
  });
  return { ok: true };
}

export async function confirmRestore(sessionId: string, backupId: string, input: unknown) {
  const data = z.object({
    restoreId: z.string().min(1),
    reason: reasonField("恢复理由"),
    password: z.string().min(1, "请输入当前密码").max(128),
    confirmPhrase: z.literal(confirmPhrase, { error: `请输入确认短语“${confirmPhrase}”` }),
    acknowledged: z.literal(true, { error: "请确认已知悉恢复影响" }),
  }).strict().parse(input);
  const current = await requireAdmin(sessionId);
  if (!(await verifyAdminPassword(sessionId, data.password))) throw new AccountError("当前密码不正确", 401);
  const state = await readRestoreState();
  if (!state || state.id !== data.restoreId || state.backupId !== backupId) throw new OpsError("恢复预检不存在或已被替换", "RESTORE_NOT_FOUND", 404);
  if (state.phase !== "ready" || state.maintenance) throw new OpsError("当前恢复任务已进入其他阶段", "RESTORE_STATE_INVALID", 409);
  if (state.preflightExpiresAt && new Date(state.preflightExpiresAt).getTime() < Date.now()) {
    await dropDatabase(state.candidateDatabase).catch(() => undefined);
    await writeRestoreState({ ...state, phase: "failed", maintenance: false, errorCode: "PREFLIGHT_EXPIRED", message: "预检已过期，请重新预检" });
    throw new OpsError("预检已过期，请重新预检", "PREFLIGHT_EXPIRED", 409);
  }
  const candidateExists = (await databaseNames()).has(state.candidateDatabase);
  if (!candidateExists) throw new OpsError("候选数据库已不存在，请重新预检", "CANDIDATE_MISSING", 409);
  const manifest = await loadManifest(backupId);
  const currentHash = await sha256File(dumpPath(manifest));
  if (manifest.sha256 && currentHash !== manifest.sha256) throw new OpsError("备份文件在预检后发生变化，请重新预检", "BACKUP_HASH_CHANGED", 409);
  const currentFingerprint = await withClient(databaseConfig().database, client => fingerprintOf(client));
  if (currentFingerprint.fingerprint !== state.fingerprint) throw new OpsError("当前数据库在预检后发生了业务写入，预检报告已失效，请重新预检", "RESTORE_FINGERPRINT_MISMATCH", 409);
  await recordAudit(db, {
    actorId: current.userId,
    actor: { id: current.user.id, name: current.user.name, login: current.user.login, role: current.user.role },
    action: "DATABASE_RESTORE_STARTED",
    targetType: "Backup",
    targetId: manifest.id,
    targetLabel: manifest.filename,
    reason: data.reason,
    details: { restoreId: state.id, backupHashPrefix: currentHash.slice(0, 16), includesFiles: false },
  });
  const next: RestoreState = { ...state, phase: "confirmed", maintenance: true, reason: data.reason, actorId: current.user.id, actorName: current.user.name, actorLogin: current.user.login, updatedAt: new Date().toISOString() };
  await writeRestoreState(next);
  void runRestoreJob(state.id).catch(error => console.error("数据库恢复任务异常", error instanceof Error ? error.name : "UnknownError"));
  return { ok: true, restoreId: state.id, phase: next.phase, token: restoreStatusToken(state.id) };
}

function actorOf(state: RestoreState) {
  return { id: state.actorId, name: state.actorName, login: state.actorLogin ?? "", role: "ADMIN" };
}

async function writeReportFile(path: string, report: RestoreReport) {
  await ensurePrivateDir(join(path, ".."));
  await writeJsonAtomic(path, report);
}

async function exportAuditSidecar(state: RestoreState, dir: string) {
  await ensurePrivateDir(dir);
  const path = join(dir, "audit-events.jsonl");
  const file = createWriteStream(path, { mode: 0o600 });
  const hash = createHash("sha256");
  let bytes = 0;
  let count = 0;
  let firstAt: string | null = null;
  let lastAt: string | null = null;
  let cursor: { createdAt: Date; id: string } | null = null;
  try {
    for (;;) {
      const rows: AuditEvent[] = await db.auditEvent.findMany({
        where: cursor ? { OR: [{ createdAt: { gt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { gt: cursor.id } }] } : undefined,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 1_000,
      });
      if (!rows.length) break;
      for (const row of rows) {
        const line = `${JSON.stringify(row)}\n`;
        const buffer = Buffer.from(line, "utf8");
        bytes += buffer.byteLength;
        if (bytes > maxRestoreAuditBytes) throw new OpsError("审计日志超过旁路导出上限，请先清理日志后重试", "AUDIT_EXPORT_TOO_LARGE", 507);
        hash.update(buffer);
        if (!file.write(buffer)) await once(file, "drain");
        count += 1;
        firstAt ??= row.createdAt.toISOString();
        lastAt = row.createdAt.toISOString();
      }
      const last = rows.at(-1)!;
      cursor = { createdAt: last.createdAt, id: last.id };
    }
    await new Promise<void>((resolve, reject) => file.end((error?: Error | null) => error ? reject(error) : resolve()));
  } catch (error) {
    file.destroy();
    throw error;
  }
  const sha256 = hash.digest("hex");
  const manifest = { count, bytes, sha256, firstAt, lastAt, exportedAt: new Date().toISOString() };
  await writeJsonAtomic(join(dir, "manifest.json"), manifest);
  return { ...manifest, path };
}

async function resetCandidateSecurity(candidate: string) {
  await withClient(candidate, async client => {
    await client.query(`UPDATE "User" SET "authVersion" = "authVersion" + 1`);
    await client.query(`DELETE FROM "AuthSession"`);
    await client.query(`DELETE FROM "LoginFailureState"`);
    await client.query(`DELETE FROM "LoginCaptcha"`);
    await client.query(`DELETE FROM "LoginAttempt"`);
  });
}

async function importAuditSidecar(candidate: string, path: string) {
  const client = new Client({ connectionString: connectionStringFor(candidate), application_name: "campus-restore-audit" });
  await client.connect();
  let imported = 0;
  let skipped = 0;
  let batch: Record<string, unknown>[] = [];
  const columns = ["id", "actorId", "actorName", "actorLogin", "actorRole", "action", "category", "targetType", "targetId", "targetLabel", "reason", "result", "requestId", "route", "method", "ip", "userAgent", "details", "createdAt"];
  const insert = async () => {
    if (!batch.length) return;
    const values: unknown[] = [];
    const placeholders = batch.map((row, rowIndex) => {
      const offset = rowIndex * columns.length;
      values.push(row.id, row.actorId ?? null, row.actorName ?? null, row.actorLogin ?? null, row.actorRole ?? null, row.action, row.category ?? "SYSTEM", row.targetType ?? null, row.targetId ?? null, row.targetLabel ?? null, row.reason ?? null, row.result ?? "SUCCESS", row.requestId ?? null, row.route ?? null, row.method ?? null, row.ip ?? null, row.userAgent ?? null, row.details === null || row.details === undefined ? null : JSON.stringify(row.details), row.createdAt);
      return `(${Array.from({ length: columns.length }, (_, index) => `$${offset + index + 1}${index === columns.length - 1 ? "::timestamptz" : index === columns.length - 2 ? "::jsonb" : ""}`).join(",")})`;
    });
    const result = await client.query(
      `INSERT INTO "AuditEvent" (${columns.map(column => quoteIdent(column)).join(", ")}) VALUES ${placeholders.join(",")} ON CONFLICT ("id") DO NOTHING`,
      values,
    );
    imported += result.rowCount ?? 0;
    skipped += batch.length - (result.rowCount ?? 0);
    batch = [];
  };
  try {
    const reader = createInterface({ input: (await import("node:fs")).createReadStream(path), crlfDelay: Infinity });
    for await (const line of reader) {
      if (!line.trim()) continue;
      batch.push(JSON.parse(line) as Record<string, unknown>);
      if (batch.length >= 200) await insert();
    }
    await insert();
  } finally {
    await client.end().catch(() => undefined);
  }
  return { imported, skipped };
}

async function switchDatabases(state: RestoreState) {
  const config = databaseConfig();
  const currentName = config.database;
  const candidate = state.candidateDatabase;
  const previous = shortDatabaseName(currentName, `_prev_${Date.now().toString(36)}`);
  if (!validDatabaseName(previous)) throw new OpsError("旧数据库名称生成失败", "RESTORE_SWAP_FAILED", 500);
  await trackDatabase("previous", previous, state.id);
  await terminateBackends([currentName, candidate]);
  await new Promise(resolve => setTimeout(resolve, 500));
  const client = new Client({ connectionString: connectionStringFor("postgres"), application_name: "campus-restore-swap" });
  await client.connect();
  try {
    const active = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM pg_stat_activity WHERE datname = ANY($1::text[]) AND pid <> pg_backend_pid() AND backend_type = 'client backend'`,
      [[currentName, candidate]],
    );
    if (Number(active.rows[0]?.count ?? 0) > 0) throw new OpsError("仍有连接占用数据库，切换已中止，当前数据库未改变", "RESTORE_CONNECTIONS_ACTIVE", 409);
    await client.query("BEGIN");
    try {
      await client.query(`ALTER DATABASE ${quoteIdent(currentName)} RENAME TO ${quoteIdent(previous)}`);
      await client.query(`ALTER DATABASE ${quoteIdent(candidate)} RENAME TO ${quoteIdent(currentName)}`);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
    return previous;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function rollbackDatabases(state: RestoreState) {
  const config = databaseConfig();
  const currentName = config.database;
  const previous = state.previousDatabase;
  if (!previous) throw new OpsError("缺少旧数据库名称，无法自动回滚", "RESTORE_ROLLBACK_FAILED", 500);
  await db.$disconnect().catch(() => undefined);
  await terminateBackends([currentName, previous, state.candidateDatabase]);
  await new Promise(resolve => setTimeout(resolve, 500));
  const client = new Client({ connectionString: connectionStringFor("postgres"), application_name: "campus-restore-rollback" });
  await client.connect();
  try {
    await client.query("BEGIN");
    try {
      await client.query(`ALTER DATABASE ${quoteIdent(currentName)} RENAME TO ${quoteIdent(state.candidateDatabase)}`);
      await client.query(`ALTER DATABASE ${quoteIdent(previous)} RENAME TO ${quoteIdent(currentName)}`);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  } finally {
    await client.end().catch(() => undefined);
  }
  await db.$queryRaw`SELECT 1`;
}

async function finalizeRestore(state: RestoreState, report: RestoreReport, startedAt: number) {
  const validation = await withClient(databaseConfig().database, async client => {
    const pending = await client.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL`);
    const admins = await adminRows(client);
    const users = await client.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM "User"`);
    const fk = await client.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM pg_constraint WHERE contype = 'f' AND NOT convalidated`);
    const counts = await keyCounts(client);
    return {
      pending: Number(pending.rows[0]?.count ?? 0),
      admins: admins.filter(admin => admin.hasPassword).length,
      users: Number(users.rows[0]?.count ?? 0),
      invalidForeignKeys: Number(fk.rows[0]?.count ?? 0),
      counts,
    };
  });
  if (validation.pending > 0 || validation.admins === 0 || validation.invalidForeignKeys > 0) {
    throw new OpsError("恢复后的数据库校验未通过", "RESTORE_VERIFY_FAILED", 500);
  }
  const actor = actorOf(state);
  await recordAudit(db, { action: "DATABASE_RESTORE_SECURITY_RESET", actorId: state.actorId, actor, targetType: "Backup", targetId: state.backupId, details: { clearedAuthSessions: true, clearedLoginFailures: true, clearedCaptchas: true, authVersionIncremented: true } });
  await recordAudit(db, { action: "DATABASE_RESTORE_AUDIT_IMPORTED", actorId: state.actorId, actor, targetType: "Backup", targetId: state.backupId, details: { events: report.audit.sidecarEvents, imported: report.audit.imported, skipped: report.audit.skipped, bytes: report.audit.sidecarBytes, sha256: report.audit.sidecarSha256 } });
  const completedReport: RestoreReport = {
    ...report,
    status: "COMPLETED",
    generatedAt: new Date().toISOString(),
    startedAt: new Date(startedAt).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    safetyBackupId: state.safetyBackupId ?? null,
    data: { ...report.data, restored: validation.counts },
  };
  await recordAudit(db, {
    action: "DATABASE_RESTORE_COMPLETED",
    actorId: state.actorId,
    actor,
    targetType: "Backup",
    targetId: state.backupId,
    targetLabel: report.backupFilename,
    details: { restoreId: state.id, backupHashPrefix: report.audit.sidecarSha256.slice(0, 16), users: validation.users, admins: validation.admins, importedAudits: report.audit.imported, skippedAudits: report.audit.skipped, durationMs: completedReport.durationMs, includesFiles: false },
  });
  await db.systemPolicy.upsert({ where: { id: "system" }, create: { id: "system", lastRestoreAt: new Date() }, update: { lastRestoreAt: new Date() } });
  await writeReportFile(resultPath(state.id), completedReport);
  await writeRestoreState({ ...state, phase: "completed", maintenance: false, switched: true, completedAt: completedReport.completedAt, errorCode: undefined, message: undefined });
  return completedReport;
}

export async function runRestoreJob(id: string) {
  const startedAt = Date.now();
  let state = await readRestoreState();
  if (!state || state.id !== id) return;
  let report: RestoreReport | null = null;
  try {
    const preflight = await readJson<PreflightFile>(preflightPath(id));
    if (!preflight) throw new OpsError("预检报告不存在，无法继续恢复", "PREFLIGHT_MISSING", 500);
    report = preflight.report;
    state = (await patchRestoreState({ id, phase: "snapshot", maintenance: true, startedAt: new Date(startedAt).toISOString() })) ?? state;
    const dir = restoreReportPath(id);
    const safety = await createSafetySnapshot(`数据库恢复前自动安全快照（${id}）`, actorOf(state));
    state = (await patchRestoreState({ id, phase: "snapshot", safetyBackupId: safety.id })) ?? state;
    const sidecar = await exportAuditSidecar(state, dir);
    state = (await patchRestoreState({ id, phase: "exported", auditExport: { count: sidecar.count, bytes: sidecar.bytes, sha256: sidecar.sha256, firstAt: sidecar.firstAt, lastAt: sidecar.lastAt } })) ?? state;
    await db.$disconnect().catch(() => undefined);
    await terminateBackends([databaseConfig().database, state.candidateDatabase]);
    await resetCandidateSecurity(state.candidateDatabase);
    const imported = await importAuditSidecar(state.candidateDatabase, sidecar.path);
    state = { ...state, auditExport: { ...state.auditExport!, count: sidecar.count, bytes: sidecar.bytes, sha256: sidecar.sha256, firstAt: sidecar.firstAt, lastAt: sidecar.lastAt } };
    report = { ...report, audit: { ...report.audit, sidecarEvents: sidecar.count, sidecarBytes: sidecar.bytes, sidecarSha256: sidecar.sha256, firstAt: sidecar.firstAt, lastAt: sidecar.lastAt, imported: imported.imported, skipped: imported.skipped } };
    await patchRestoreState({ id, phase: "exported", auditExport: state.auditExport });
    await withClient(state.candidateDatabase, async client => {
      const pending = await client.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL`);
      if (Number(pending.rows[0]?.count ?? 0) > 0) throw new OpsError("候选库仍有未完成的迁移", "CANDIDATE_MIGRATION_INCOMPLETE", 500);
      const admins = await adminRows(client);
      if (!admins.some(admin => admin.hasPassword)) throw new OpsError("候选库没有可用管理员", "NO_ADMIN", 500);
    });
    state = (await patchRestoreState({ id, phase: "swapping" })) ?? state;
    const previous = await switchDatabases(state);
    state = (await patchRestoreState({ id, phase: "swapped", switched: true, previousDatabase: previous })) ?? { ...state, switched: true, previousDatabase: previous };
    await db.$queryRaw`SELECT 1`;
    await finalizeRestore(state, report, startedAt);
  } catch (error) {
    const current = (await readRestoreState()) ?? state;
    const names = await databaseNames().catch(() => new Set<string>());
    const config = databaseConfig();
    const switched = current.switched || (names.has(config.database) && current.previousDatabase ? names.has(current.previousDatabase) && !names.has(current.candidateDatabase) : false);
    const code = error instanceof OpsError ? error.code : "RESTORE_FAILED";
    const message = error instanceof Error ? error.message.slice(0, 300) : "数据库恢复失败";
    console.error("数据库恢复失败", code);
    if (switched) {
      try {
        await rollbackDatabases(current);
        const rolledBackReport: RestoreReport | null = report ? { ...report, status: "ROLLED_BACK", errorCode: code, message, completedAt: new Date().toISOString(), durationMs: Date.now() - startedAt } : null;
        if (rolledBackReport) await writeReportFile(resultPath(current.id), rolledBackReport);
        await recordAuditBestEffort(db, { action: "DATABASE_RESTORE_ROLLED_BACK", actorId: current.actorId, actor: actorOf(current), targetType: "Backup", targetId: current.backupId, details: { restoreId: current.id, errorCode: code } });
        await writeRestoreState({ ...current, phase: "rolled-back", maintenance: false, switched: false, completedAt: new Date().toISOString(), errorCode: code, message });
      } catch (rollbackError) {
        await writeRestoreState({ ...current, phase: "failed", maintenance: true, completedAt: new Date().toISOString(), errorCode: "RESTORE_ROLLBACK_FAILED", message: "自动回滚失败，系统保持维护模式，请立即联系运维使用安全快照人工恢复" });
        console.error("数据库恢复回滚失败", rollbackError instanceof Error ? rollbackError.name : "UnknownError");
      }
      return;
    }
    await dropDatabase(current.candidateDatabase).catch(() => undefined);
    const failedReport: RestoreReport | null = report ? { ...report, status: "FAILED", errorCode: code, message, completedAt: new Date().toISOString(), durationMs: Date.now() - startedAt } : null;
    if (failedReport) await writeReportFile(resultPath(current.id), failedReport).catch(() => undefined);
    await recordAuditBestEffort(db, { action: "DATABASE_RESTORE_FAILED", actorId: current.actorId, actor: actorOf(current), targetType: "Backup", targetId: current.backupId, details: { restoreId: current.id, errorCode: code, switched: false } });
    await writeRestoreState({ ...current, phase: "failed", maintenance: false, switched: false, completedAt: new Date().toISOString(), errorCode: code, message });
  }
}

export async function getRestoreStatus(token?: string) {
  const state = await readRestoreState();
  if (!state) return { phase: null, maintenance: false };
  const id = verifyRestoreStatusToken(token);
  if (id !== state.id) throw new OpsError("恢复状态令牌无效或已过期", "RESTORE_STATUS_FORBIDDEN", 403);
  return safeState(state);
}

export async function acknowledgeRestore(token?: string, input?: unknown) {
  const state = await readRestoreState();
  if (!state) return { ok: true };
  const id = verifyRestoreStatusToken(token);
  if (id !== state.id) throw new OpsError("恢复状态令牌无效或已过期", "RESTORE_STATUS_FORBIDDEN", 403);
  const action = z.object({ action: z.literal("acknowledge") }).parse(input ?? {});
  void action;
  if (!state.maintenance) return { ok: true, state: safeState(state) };
  if (state.switched && state.phase !== "rolled-back") throw new OpsError("数据库状态尚未确认，不能退出维护模式", "RESTORE_ACK_NOT_ALLOWED", 409);
  await writeRestoreState({ ...state, maintenance: false, message: `${state.message ?? ""}（管理员已确认退出维护模式）`.slice(0, 500) });
  return { ok: true, state: safeState((await readRestoreState())!) };
}

export async function getRestoreReport(sessionId: string, backupId: string) {
  await requireAdmin(sessionId);
  const state = await readRestoreState();
  if (state?.backupId === backupId) {
    const result = await readJson<RestoreReport>(resultPath(state.id));
    if (result) return result;
    const preflight = await readJson<PreflightFile>(preflightPath(state.id));
    return preflight?.report ?? null;
  }
  const entries = await readdir(reportsRoot(), { withFileTypes: true }).catch(() => []);
  const reports: RestoreReport[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const result = await readJson<RestoreReport>(resultPath(entry.name));
    const report = result ?? (await readJson<PreflightFile>(preflightPath(entry.name)))?.report;
    if (report?.backupId === backupId) reports.push(report);
  }
  return reports.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))[0] ?? null;
}

export async function reconcileRestoreOnStartup() {
  const state = await readRestoreState();
  if (!state) return;
  if (terminalPhases.has(state.phase)) {
    if (!state.maintenance) return;
    // A failed automatic rollback means the live database may be inconsistent;
    // keeping maintenance mode is the safe state until an operator restores the
    // safety snapshot.
    if (state.errorCode === "RESTORE_ROLLBACK_FAILED") return;
    await writeRestoreState({ ...state, maintenance: false });
    return;
  }
  if (state.phase === "ready") {
    if (state.preflightExpiresAt && new Date(state.preflightExpiresAt).getTime() < Date.now()) {
      await dropDatabase(state.candidateDatabase).catch(() => undefined);
      await writeRestoreState({ ...state, phase: "failed", maintenance: false, errorCode: "PREFLIGHT_EXPIRED", message: "预检在应用重启前已过期", completedAt: new Date().toISOString() });
    }
    return;
  }
  const names = await databaseNames().catch(() => null);
  if (!names) return;
  const config = databaseConfig();
  const registry = await readDatabaseRegistry().catch(() => ({ candidates: [], previous: [] }));
  const registeredPrevious = registry.previous.find(item => item.restoreId === state.id)?.name ?? state.previousDatabase ?? null;
  const candidateExists = names.has(state.candidateDatabase);
  const currentExists = names.has(config.database);
  const previousExists = !!registeredPrevious && names.has(registeredPrevious);

  // The swap transaction is atomic. When the candidate name is gone but the
  // previous database exists, the swap committed before the state file could
  // record it (or the process died during finalisation). Rolling back keeps the
  // pre-restore database authoritative; the restored database is retained as a
  // candidate until the normal TTL cleanup removes it.
  const swapCommitted = !candidateExists && currentExists && previousExists && ["swapping", "swapped"].includes(state.phase);
  if (swapCommitted) {
    try {
      const rollbackState = { ...state, previousDatabase: registeredPrevious, maintenance: true };
      await rollbackDatabases(rollbackState);
      const report = await readJson<RestoreReport>(resultPath(state.id));
      if (report) {
        await writeReportFile(resultPath(state.id), {
          ...report,
          status: "ROLLED_BACK",
          errorCode: "TASK_INTERRUPTED",
          message: "应用在数据库切换后重启，已自动回滚到恢复前数据库",
          completedAt: new Date().toISOString(),
        });
      }
      await recordAuditBestEffort(db, {
        action: "DATABASE_RESTORE_ROLLED_BACK",
        actorId: state.actorId,
        actor: actorOf(state),
        targetType: "Backup",
        targetId: state.backupId,
        details: { restoreId: state.id, trigger: "STARTUP_RECOVERY", errorCode: "TASK_INTERRUPTED" },
      });
      await writeRestoreState({
        ...rollbackState,
        phase: "rolled-back",
        maintenance: false,
        switched: false,
        completedAt: new Date().toISOString(),
        errorCode: "TASK_INTERRUPTED",
        message: "应用在数据库切换后重启，已自动回滚到恢复前数据库；请重新预检后再恢复",
      });
    } catch (error) {
      console.error("启动时回滚数据库恢复失败", error instanceof Error ? error.name : "UnknownError");
      await writeRestoreState({
        ...state,
        maintenance: true,
        errorCode: "RESTORE_ROLLBACK_FAILED",
        message: "应用重启后无法自动回滚数据库恢复，系统保持维护模式，请联系运维使用安全快照处理",
      });
    }
    return;
  }

  // A previous rollback may have committed before its state write. Both the
  // restored candidate and the current database exist again, while the previous
  // database is gone: record the completed rollback without touching databases.
  if (state.switched && candidateExists && currentExists && !previousExists) {
    await writeRestoreState({
      ...state,
      phase: "rolled-back",
      maintenance: false,
      switched: false,
      completedAt: new Date().toISOString(),
      errorCode: "TASK_INTERRUPTED",
      message: "检测到应用重启前已完成数据库回滚，系统已退出维护模式",
    });
    return;
  }

  // Any pre-swap interruption leaves the current database untouched. Discard
  // the candidate database and reopen the system instead of staying in
  // maintenance forever.
  if (!state.switched && ["confirmed", "snapshot", "exported", "swapping", "swapped"].includes(state.phase) && candidateExists && currentExists) {
    await dropDatabase(state.candidateDatabase).catch(() => undefined);
    await writeRestoreState({ ...state, phase: "failed", maintenance: false, completedAt: new Date().toISOString(), errorCode: "TASK_INTERRUPTED", message: "应用在切换前重启，当前数据库保持不变；候选库已清理，请重新预检" });
    return;
  }

  if (!state.maintenance) {
    await writeRestoreState({ ...state, maintenance: true });
  }
}

export async function getRestoreJob(sessionId: string, id: string) {
  await requireAdmin(sessionId);
  const state = await readRestoreState();
  if (!state || state.id !== id) throw new OpsError("恢复任务不存在", "RESTORE_NOT_FOUND", 404);
  return safeState(state);
}

export async function cleanupRestoreArtifacts() {
  let state = await readRestoreState();
  if (state?.maintenance) return;
  if (state && !terminalPhases.has(state.phase)) {
    const expired = state.phase === "ready" && state.preflightExpiresAt && Date.parse(state.preflightExpiresAt) < Date.now();
    if (!expired) return;
    await dropDatabase(state.candidateDatabase).catch(() => undefined);
    state = { ...state, phase: "failed", maintenance: false, errorCode: "PREFLIGHT_EXPIRED", message: "预检已过期，候选库已清理", completedAt: new Date().toISOString() };
    await writeRestoreState(state);
  }
  const policy = await readOpsPolicy();
  const now = Date.now();
  await cleanupTrackedDatabases("candidates", now - policy.restoreCandidateTtlMinutes * 60_000);
  await cleanupTrackedDatabases("previous", now - policy.previousDatabaseRetentionDays * 24 * 60 * 60_000, state?.previousDatabase ?? undefined);
  const reportCutoff = now - policy.restoreReportRetentionDays * 24 * 60 * 60_000;
  const entries = await readdir(reportsRoot(), { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === state?.id) continue;
    const preflight = await readJson<PreflightFile>(preflightPath(entry.name));
    const result = await readJson<RestoreReport>(resultPath(entry.name));
    const stamp = result?.completedAt ?? result?.generatedAt ?? preflight?.report.completedAt ?? preflight?.report.generatedAt ?? preflight?.preflightAt;
    const createdAt = stamp ? Date.parse(stamp) : Number.NaN;
    if (!Number.isNaN(createdAt) && createdAt >= reportCutoff) continue;
    try {
      await rm(restoreReportPath(entry.name), { recursive: true, force: true });
    } catch (error) {
      console.error("清理过期恢复报告失败", error instanceof Error ? error.name : "UnknownError");
    }
  }
}
