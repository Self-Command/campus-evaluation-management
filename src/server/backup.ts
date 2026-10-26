import { createHash, createHmac, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { open, readdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { once } from "node:events";
import { Readable } from "node:stream";
import { Client } from "pg";
import { z } from "zod";
import { db } from "@/server/db";
import { AccountError } from "@/server/account-error";
import { getCurrentSession, verifyAdminPassword } from "@/server/auth";
import { recordAudit, recordAuditBestEffort } from "@/server/audit";
import { readOpsPolicy } from "@/server/ops-policy";
import { readRestoreStateSync } from "@/server/restore-state";
import {
  OpsError,
  assertPgTools,
  backupRoot,
  connectionStringFor,
  databaseConfig,
  databaseSize,
  diskSpace,
  ensurePrivateDir,
  fileInfo,
  maxUploadBytes,
  pgEnv,
  pgTool,
  randomToken,
  hashToken,
  readJson,
  removeFile,
  runBinary,
  serverVersion,
  sha256File,
  uploadSessionsRoot,
  withOpsLock,
  writeJsonAtomic,
} from "@/server/ops-common";

export const backupFilesRoot = () => join(backupRoot(), "backups");
const volumeMaxBytes = Math.max(Number(process.env.BACKUP_VOLUME_MAX_BYTES ?? 5 * 1024 ** 3) || 5 * 1024 ** 3, 512 * 1024 ** 2);
const appVersion = process.env.APP_VERSION?.trim() || process.env.npm_package_version?.trim() || "0.3.8";
const gitRevision = process.env.GIT_SHA?.trim() || process.env.NEXT_PUBLIC_GIT_SHA?.trim() || "unknown";
const staleRunningMs = 10 * 60_000;

export type BackupMigration = { name: string; checksum: string; finishedAt: string | null; rolledBackAt: string | null };
export type BackupManifest = {
  id: string;
  filename: string;
  kind: "MANUAL" | "UPLOADED" | "SAFETY";
  status: "RUNNING" | "SUCCEEDED" | "FAILED";
  stage: string;
  pinned: boolean;
  createdAt: string;
  completedAt: string | null;
  createdBy: { id: string; name: string; login: string } | null;
  reason: string;
  appVersion: string;
  gitRevision: string;
  clientVersion: number;
  serverVersion: number;
  migrations: BackupMigration[];
  bytes: number;
  sha256: string;
  snapshotId: string | null;
  databaseBytes: number;
  tables: { name: string; rows: number }[];
  sequenceCount: number;
  evidenceRows: number;
  activityAttachmentRows: number;
  includesFiles: false;
  rowCountsSource: "snapshot";
  errorCode?: string;
  errorMessage?: string;
  tempFile?: string;
};

function manifestPath(id: string) {
  return join(backupFilesRoot(), `${id}.json`);
}

export function dumpPath(manifest: Pick<BackupManifest, "id" | "filename">) {
  return join(backupFilesRoot(), manifest.filename);
}

function stamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function newBackupId() {
  return `bk_${stamp().replace("T", "").replace("Z", "")}_${randomBytes(3).toString("hex")}`;
}

function safeFilenamePart(value: string, max = 30) {
  return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, max) || "backup";
}

function shortRevision() {
  return gitRevision === "unknown" ? "unknown" : gitRevision.slice(0, 8);
}

function backupFilename(createdAt: Date, id: string, suffix = "") {
  const base = `campus-evaluation_${stamp(createdAt)}_v${appVersion}_${shortRevision()}${suffix}_${id}`;
  return `${safeFilenamePart(base, 140)}.dump`;
}

async function requireAdmin(sessionId: string) {
  const current = await getCurrentSession(sessionId);
  if (!current || current.user.role !== "ADMIN" || current.user.mustChangePassword) throw new AccountError("没有管理权限", 403);
  return current;
}

async function assertNoActiveRestore() {
  const state = readRestoreStateSync();
  if (state && !["completed", "failed", "rolled-back"].includes(state.phase)) throw new OpsError("数据库恢复任务正在进行，暂时不能执行备份任务", "RESTORE_IN_PROGRESS", 409);
}

export async function listBackups(sessionId: string) {
  await requireAdmin(sessionId);
  await cleanupStaleTasks();
  await cleanupExpiredUploads().catch(() => undefined);
  await ensurePrivateDir(backupFilesRoot());
  const files = await readdir(backupFilesRoot(), { withFileTypes: true }).catch(() => []);
  const manifests: BackupManifest[] = [];
  const existing = new Set<string>();
  let volumeBytes = 0;
  for (const entry of files) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const manifest = await readJson<BackupManifest>(join(backupFilesRoot(), entry.name));
    if (!manifest?.id) continue;
    const info = await fileInfo(dumpPath(manifest));
    if (!info) {
      if (manifest.status === "SUCCEEDED") {
        manifest.status = "FAILED";
        manifest.stage = "MISSING";
        manifest.errorCode = "BACKUP_FILE_MISSING";
      }
    } else {
      existing.add(manifest.id);
      volumeBytes += info.size;
    }
    manifests.push(manifest);
  }
  manifests.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const policy = await readOpsPolicy();
  const disk = await diskSpace(backupFilesRoot()).catch(() => null);
  const restoreState = readRestoreStateSync();
  const succeeded = manifests.filter(item => item.status === "SUCCEEDED");
  return {
    items: manifests.map(item => ({
      ...item,
      exists: existing.has(item.id),
      sha256Prefix: item.sha256 ? item.sha256.slice(0, 16) : null,
      sizeLabel: item.bytes,
    })),
    summary: {
      total: succeeded.length,
      pinned: succeeded.filter(item => item.pinned).length,
      failed: manifests.filter(item => item.status === "FAILED").length,
      running: manifests.filter(item => item.status === "RUNNING").length,
      volumeBytes,
      volumeMaxBytes,
      pinnedBytes: succeeded.filter(item => item.pinned).reduce((sum, item) => sum + item.bytes, 0),
      freeBytes: disk?.freeBytes ?? null,
      lastCreatedAt: succeeded.map(item => item.completedAt || item.createdAt).sort().at(-1) ?? null,
      retentionCount: policy.backupRetentionCount,
      safetyRetentionDays: policy.backupSafetyRetentionDays,
      includesFiles: false as const,
      activeRestore: restoreState ? { phase: restoreState.phase, backupId: restoreState.backupId, startedAt: restoreState.startedAt } : null,
    },
  };
}

export async function getBackup(sessionId: string, id: string) {
  await requireAdmin(sessionId);
  const manifest = await loadManifest(id);
  const info = await fileInfo(dumpPath(manifest));
  return { ...manifest, exists: Boolean(info), sha256Prefix: manifest.sha256 ? manifest.sha256.slice(0, 16) : null };
}

export async function loadManifest(id: string) {
  const safe = z.string().regex(/^bk_[A-Za-z0-9_]+$/).parse(id);
  const manifest = await readJson<BackupManifest>(manifestPath(safe));
  if (!manifest) throw new OpsError("备份不存在", "BACKUP_NOT_FOUND", 404);
  return manifest;
}

async function saveManifest(manifest: BackupManifest) {
  await writeJsonAtomic(manifestPath(manifest.id), manifest);
  return manifest;
}

async function userTables(client: Client) {
  const result = await client.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations' ORDER BY table_name`,
  );
  return result.rows.map(row => row.table_name);
}

async function snapshotMetadata(client: Client) {
  const tables = await userTables(client);
  const counts: { name: string; rows: number }[] = [];
  for (const table of tables) {
    const result = await client.query<{ rows: string }>(`SELECT COUNT(*)::text AS rows FROM "${table.replaceAll('"', '""')}"`);
    counts.push({ name: table, rows: Number(result.rows[0]?.rows ?? 0) });
  }
  const migrations = await client.query<{ migration_name: string; checksum: string; finished_at: Date | null; rolled_back_at: Date | null }>(
    `SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at ASC`,
  );
  const sequences = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM information_schema.sequences WHERE sequence_schema = 'public'`,
  );
  const sizes = await client.query<{ database: string; evidence: string; attachments: string }>(
    `SELECT pg_database_size(current_database())::text AS database,
            COALESCE((SELECT COUNT(*) FROM "Evidence"), 0)::text AS evidence,
            COALESCE((SELECT COUNT(*) FROM "ActivityAttachment"), 0)::text AS attachments`,
  );
  const size = sizes.rows[0];
  return {
    tables: counts,
    migrations: migrations.rows.map(row => ({
      name: row.migration_name,
      checksum: row.checksum,
      finishedAt: row.finished_at?.toISOString() ?? null,
      rolledBackAt: row.rolled_back_at?.toISOString() ?? null,
    })),
    sequenceCount: Number(sequences.rows[0]?.count ?? 0),
    databaseBytes: Number(size?.database ?? 0),
    evidenceRows: Number(size?.evidence ?? 0),
    activityAttachmentRows: Number(size?.attachments ?? 0),
  };
}

async function dumpWithSnapshot(options: { targetPath: string; snapshotId: string; database: string }) {
  const config = databaseConfig();
  await runBinary(
    pgTool("pg_dump"),
    ["--format=custom", "--compress=6", "--no-owner", "--no-privileges", `--snapshot=${options.snapshotId}`, `--file=${options.targetPath}`, options.database],
    { timeoutMs: 60 * 60_000, env: pgEnv(options.database), publicCode: "BACKUP_DUMP_FAILED", maxStdout: 1024 },
  );
  if (!(await fileInfo(options.targetPath))) throw new OpsError("备份文件未生成", "BACKUP_DUMP_FAILED", 500);
  return config;
}

export async function createBackup(sessionId: string, input: unknown) {
  const data = z.object({ reason: z.string().trim().min(2, "请填写备份理由").max(500) }).strict().parse(input);
  const current = await requireAdmin(sessionId);
  await assertNoActiveRestore();
  const policy = await readOpsPolicy();
  const versions = await assertPgTools();
  const server = await serverVersion();
  const serverMajor = Math.floor(Number(server?.version ?? 0) / 10_000);
  if (!serverMajor || versions.dump !== serverMajor || versions.restore !== serverMajor) throw new OpsError(`PostgreSQL 客户端版本与服务器不一致，无法安全备份`, "PG_VERSION_MISMATCH", 503);
  const size = await databaseSize();
  const disk = await diskSpace(backupFilesRoot());
  const required = Math.max(Math.ceil(size * 1.2), 512 * 1024 ** 2);
  if (disk.freeBytes < required) throw new OpsError(`备份卷剩余空间不足，需要至少 ${Math.ceil(required / 1024 ** 2)} MiB`, "DISK_SPACE_LOW", 507);
  const currentVolume = await volumeUsage();
  if (currentVolume + required > volumeMaxBytes) throw new OpsError("备份卷已达到配置容量上限，请先下载并删除旧备份", "VOLUME_LIMIT", 507);
  const createdAt = new Date();
  const backupId = newBackupId();
  const manifest: BackupManifest = {
    id: backupId,
    filename: backupFilename(createdAt, backupId),
    kind: "MANUAL",
    status: "RUNNING",
    stage: "QUEUED",
    pinned: false,
    createdAt: createdAt.toISOString(),
    completedAt: null,
    createdBy: { id: current.user.id, name: current.user.name, login: current.user.login },
    reason: data.reason,
    appVersion,
    gitRevision,
    clientVersion: versions.dump,
    serverVersion: serverMajor,
    migrations: [],
    bytes: 0,
    sha256: "",
    snapshotId: null,
    databaseBytes: size,
    tables: [],
    sequenceCount: 0,
    evidenceRows: 0,
    activityAttachmentRows: 0,
    includesFiles: false,
    rowCountsSource: "snapshot",
  };
  await ensurePrivateDir(backupFilesRoot());
  await saveManifest(manifest);
  // Run in the background so the HTTP request returns a real job id; the page
  // polls the manifest until stage COMPLETED or FAILED.
  void runBackupJob(manifest.id, { policyCount: policy.backupRetentionCount }).catch(() => undefined);
  return { ...manifest, jobId: manifest.id };
}

async function volumeUsage() {
  const files = await readdir(backupFilesRoot(), { withFileTypes: true }).catch(() => []);
  let total = 0;
  for (const entry of files) {
    if (!entry.isFile() || !entry.name.endsWith(".dump")) continue;
    const info = await fileInfo(join(backupFilesRoot(), entry.name));
    total += info?.size ?? 0;
  }
  return total;
}

async function runBackupJob(id: string, options: { policyCount: number; safety?: boolean; reason?: string; actor?: { id: string; name: string; login: string; role: string }; snapshotOnly?: boolean }) {
  const manifest = await loadManifest(id);
  try {
    await withOpsLock("backup", async () => {
      const latest = await loadManifest(id);
      if (latest.status !== "RUNNING") return;
      latest.stage = "DUMPING";
      await saveManifest(latest);
      const client = new Client({ connectionString: connectionStringFor(databaseConfig().database), application_name: "campus-backup" });
      await client.connect();
      let committed = false;
      try {
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        const snapshot = await client.query<{ snapshot: string }>("SELECT pg_export_snapshot() AS snapshot");
        latest.snapshotId = snapshot.rows[0].snapshot;
        await saveManifest(latest);
        const metadataPromise = snapshotMetadata(client);
        await dumpWithSnapshot({ targetPath: dumpPath(latest), snapshotId: latest.snapshotId, database: databaseConfig().database });
        const metadata = await metadataPromise;
        Object.assign(latest, metadata);
        await client.query("COMMIT");
        committed = true;
      } finally {
        if (!committed) await client.query("ROLLBACK").catch(() => undefined);
        await client.end().catch(() => undefined);
      }
      latest.stage = "VERIFYING";
      await saveManifest(latest);
      await validateDump(dumpPath(latest));
      const info = await fileInfo(dumpPath(latest));
      if (!info) throw new OpsError("备份文件校验失败", "BACKUP_VERIFY_FAILED", 500);
      latest.bytes = info.size;
      latest.sha256 = await sha256File(dumpPath(latest));
      latest.status = "SUCCEEDED";
      latest.stage = "COMPLETED";
      latest.completedAt = new Date().toISOString();
      await saveManifest(latest);
    });
    await applyRetention(options.policyCount);
    await recordAuditBestEffort(db, {
      action: "BACKUP_CREATED",
      actorId: options.actor?.id ?? manifest.createdBy?.id ?? null,
      actor: options.actor ?? null,
      targetType: "Backup",
      targetId: manifest.id,
      targetLabel: manifest.filename,
      reason: options.reason ?? manifest.reason,
      details: { kind: manifest.kind, bytes: manifest.bytes, sha256Prefix: manifest.sha256.slice(0, 16), migrations: manifest.migrations.length, tables: manifest.tables.length, includesFiles: false, safety: Boolean(options.safety) },
    });
  } catch (error) {
    const failed = await loadManifest(id).catch(() => manifest);
    failed.status = "FAILED";
    failed.stage = "FAILED";
    failed.errorCode = error instanceof OpsError ? error.code : "BACKUP_FAILED";
    failed.errorMessage = error instanceof Error ? error.message.slice(0, 300) : "备份失败";
    failed.completedAt = new Date().toISOString();
    await saveManifest(failed).catch(() => undefined);
    await removeFile(dumpPath(failed));
    await recordAuditBestEffort(db, {
      actorId: failed.createdBy?.id ?? null,
      action: "BACKUP_CREATED",
      targetType: "Backup",
      targetId: failed.id,
      targetLabel: failed.filename,
      reason: failed.reason,
      result: "FAILURE",
      details: { errorCode: failed.errorCode, kind: failed.kind },
    });
    console.error("数据库备份失败", failed.errorCode);
  }
}

export async function createSafetySnapshot(reason: string, actor: { id: string; name: string; login: string; role: string }) {
  const policy = await readOpsPolicy();
  const createdAt = new Date();
  const backupId = newBackupId();
  const manifest: BackupManifest = {
    id: backupId,
    filename: backupFilename(createdAt, backupId, "_safety"),
    kind: "SAFETY",
    status: "RUNNING",
    stage: "QUEUED",
    pinned: true,
    createdAt: createdAt.toISOString(),
    completedAt: null,
    createdBy: { id: actor.id, name: actor.name, login: actor.login },
    reason,
    appVersion,
    gitRevision,
    clientVersion: 0,
    serverVersion: 0,
    migrations: [],
    bytes: 0,
    sha256: "",
    snapshotId: null,
    databaseBytes: 0,
    tables: [],
    sequenceCount: 0,
    evidenceRows: 0,
    activityAttachmentRows: 0,
    includesFiles: false,
    rowCountsSource: "snapshot",
  };
  await ensurePrivateDir(backupFilesRoot());
  await saveManifest(manifest);
  await runBackupJob(manifest.id, { policyCount: policy.backupRetentionCount, safety: true, reason, actor });
  const result = await loadManifest(manifest.id);
  if (result.status !== "SUCCEEDED") throw new OpsError("恢复前安全快照失败，当前数据库未做任何修改", result.errorCode ?? "SAFETY_BACKUP_FAILED", 500);
  return result;
}

export async function validateDump(path: string) {
  const handle = await open(path, "r");
  let header = "";
  try {
    const buffer = Buffer.alloc(5);
    await handle.read(buffer, 0, 5, 0);
    header = buffer.toString("ascii");
  } finally {
    await handle.close();
  }
  if (header !== "PGDMP") throw new OpsError("文件不是 PostgreSQL 自定义格式备份", "BACKUP_INVALID_FORMAT", 400);
  const list = await runBinary(pgTool("pg_restore"), ["--list", path], { timeoutMs: 120_000, publicCode: "BACKUP_INVALID_FORMAT", maxStdout: 64 * 1024 * 1024 });
  if (!list.stdout.includes("_prisma_migrations")) throw new OpsError("备份缺少迁移记录，无法用于恢复", "BACKUP_MIGRATIONS_MISSING", 400);
  return list.stdout;
}

export async function deleteBackup(sessionId: string, id: string, input: unknown) {
  const data = z.object({
    reason: z.string().trim().min(2, "请填写删除理由").max(500),
    password: z.string().min(1, "请输入当前密码").max(128),
  }).strict().parse(input);
  const current = await requireAdmin(sessionId);
  if (!(await verifyAdminPassword(sessionId, data.password))) throw new AccountError("当前密码不正确", 401);
  await assertNoActiveRestore();
  return withOpsLock("backup", async () => {
    const manifest = await loadManifest(id);
    await saveManifest({ ...manifest, stage: "DELETING" });
    await recordAudit(db, {
      actorId: current.userId,
      actor: { id: current.user.id, name: current.user.name, login: current.user.login, role: current.user.role },
      action: "BACKUP_DELETED",
      targetType: "Backup",
      targetId: manifest.id,
      targetLabel: manifest.filename,
      reason: data.reason,
      details: { bytes: manifest.bytes, sha256Prefix: manifest.sha256.slice(0, 16), kind: manifest.kind, pinned: manifest.pinned },
    });
    await removeFile(dumpPath(manifest));
    await removeFile(manifestPath(manifest.id));
    return { ok: true, id: manifest.id };
  });
}

function downloadSecret() {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new OpsError("服务端缺少会话签名配置", "DOWNLOAD_LINK_UNAVAILABLE", 503);
  return secret;
}

function downloadToken(id: string) {
  const payload = Buffer.from(JSON.stringify({ id, exp: Date.now() + 2 * 60_000 }), "utf8").toString("base64url");
  return `${payload}.${createHmac("sha256", downloadSecret()).update(payload).digest("base64url")}`;
}

function verifyDownloadToken(token: string) {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = createHmac("sha256", downloadSecret()).update(payload).digest("base64url");
  if (signature.length !== expected.length || !createHash("sha256").update(signature).digest().equals(createHash("sha256").update(expected).digest())) return null;
  try {
    const parsed = z.object({ id: z.string(), exp: z.number() }).parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    return parsed.exp > Date.now() ? parsed.id : null;
  } catch {
    return null;
  }
}

export async function backupDownloadLink(sessionId: string, id: string, input: unknown) {
  const data = z.object({
    reason: z.string().trim().min(2, "请填写下载理由").max(500),
    password: z.string().min(1, "请输入当前密码").max(128),
  }).strict().parse(input);
  const current = await requireAdmin(sessionId);
  if (!(await verifyAdminPassword(sessionId, data.password))) throw new AccountError("当前密码不正确", 401);
  const manifest = await loadManifest(id);
  if (manifest.status !== "SUCCEEDED") throw new OpsError("该备份尚未完成或已损坏", "BACKUP_NOT_READY", 409);
  const info = await fileInfo(dumpPath(manifest));
  if (!info) throw new OpsError("备份文件不存在", "BACKUP_NOT_FOUND", 404);
  await recordAudit(db, {
    actorId: current.userId,
    actor: { id: current.user.id, name: current.user.name, login: current.user.login, role: current.user.role },
    action: "BACKUP_DOWNLOADED",
    targetType: "Backup",
    targetId: manifest.id,
    targetLabel: manifest.filename,
    reason: data.reason,
    details: { bytes: manifest.bytes, sha256Prefix: manifest.sha256.slice(0, 16), via: "signed-link" },
  });
  return {
    url: `/api/admin/backups/${manifest.id}/file?ticket=${encodeURIComponent(downloadToken(manifest.id))}`,
    filename: manifest.filename,
    size: manifest.bytes,
    expiresInSeconds: 120,
  };
}

export async function openBackupDownload(id: string, token: string) {
  if (verifyDownloadToken(token) !== id) throw new OpsError("下载链接无效或已过期", "DOWNLOAD_LINK_INVALID", 403);
  const manifest = await loadManifest(id);
  if (manifest.status !== "SUCCEEDED") throw new OpsError("该备份尚未完成或已损坏", "BACKUP_NOT_READY", 409);
  const info = await fileInfo(dumpPath(manifest));
  if (!info) throw new OpsError("备份文件不存在", "BACKUP_NOT_FOUND", 404);
  return {
    stream: Readable.toWeb(createReadStream(dumpPath(manifest))) as ReadableStream<Uint8Array>,
    filename: manifest.filename,
    size: info.size,
  };
}

export async function applyRetention(policyCount?: number) {
  const policy = await readOpsPolicy();
  const keep = Math.max(1, policyCount ?? policy.backupRetentionCount);
  await ensurePrivateDir(backupFilesRoot());
  const entries = await readdir(backupFilesRoot(), { withFileTypes: true }).catch(() => []);
  const manifests: BackupManifest[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const manifest = await readJson<BackupManifest>(join(backupFilesRoot(), entry.name));
    if (manifest?.status === "SUCCEEDED") manifests.push(manifest);
  }
  const active = readRestoreStateSync();
  const automatic = manifests
    .filter(item => !item.pinned && item.kind === "MANUAL" && item.id !== active?.backupId && item.id !== active?.safetyBackupId)
    .sort((a, b) => (b.completedAt ?? b.createdAt).localeCompare(a.completedAt ?? a.createdAt));
  for (const stale of automatic.slice(keep)) {
    await removeFile(dumpPath(stale));
    await removeFile(manifestPath(stale.id));
  }
  const safetyCutoff = Date.now() - policy.backupSafetyRetentionDays * 24 * 60 * 60_000;
  for (const safety of manifests) {
    if (safety.kind !== "SAFETY") continue;
    if (safety.id === active?.safetyBackupId) continue;
    if (new Date(safety.completedAt ?? safety.createdAt).getTime() < safetyCutoff) {
      await removeFile(dumpPath(safety));
      await removeFile(manifestPath(safety.id));
    }
  }
}

export async function cleanupStaleTasks() {
  const entries = await readdir(backupFilesRoot(), { withFileTypes: true }).catch(() => []);
  const cutoff = Date.now() - staleRunningMs;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const path = join(backupFilesRoot(), entry.name);
    const manifest = await readJson<BackupManifest>(path);
    if (!manifest || manifest.status !== "RUNNING") continue;
    if (new Date(manifest.createdAt).getTime() > cutoff) continue;
    manifest.status = "FAILED";
    manifest.stage = "INTERRUPTED";
    manifest.errorCode = "TASK_INTERRUPTED";
    manifest.errorMessage = "应用重启或任务超时，备份未完成";
    manifest.completedAt = new Date().toISOString();
    await writeJsonAtomic(path, manifest);
    await removeFile(dumpPath(manifest));
  }
}

type UploadSession = {
  id: string;
  tokenHash: string;
  sessionId: string;
  userId: string;
  actor: { id: string; name: string; login: string; role: string };
  filename: string;
  size: number;
  sha256: string;
  reason: string;
  createdAt: string;
  expiresAt: string;
  tempFile: string;
  receivedBytes: number;
  status: "PENDING" | "UPLOADED" | "COMPLETED" | "FAILED";
};

function uploadPath(id: string) {
  return join(uploadSessionsRoot(), `${id}.json`);
}

export async function cleanupExpiredUploads() {
  const entries = await readdir(uploadSessionsRoot(), { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const path = join(uploadSessionsRoot(), entry.name);
    const session = await readJson<UploadSession>(path);
    if (!session) continue;
    if (session.status === "COMPLETED") {
      await removeFile(path);
      continue;
    }
    if (new Date(session.expiresAt).getTime() > Date.now() && session.status !== "FAILED") continue;
    await removeFile(session.tempFile);
    await removeFile(path);
  }
}

export async function createUploadSession(sessionId: string, input: unknown) {
  const data = z.object({
    filename: z.string().trim().min(1).max(200),
    size: z.number().int().positive().max(maxUploadBytes),
    sha256: z.string().regex(/^[a-f0-9]{64}$/i, "SHA-256 格式无效").optional(),
    reason: z.string().trim().min(2, "请填写上传理由").max(500),
    password: z.string().min(1, "请输入当前密码").max(128),
  }).strict().parse(input);
  const current = await requireAdmin(sessionId);
  if (!(await verifyAdminPassword(sessionId, data.password))) throw new AccountError("当前密码不正确", 401);
  if (data.size > maxUploadBytes) throw new OpsError("备份文件超过 2 GiB 上限", "UPLOAD_TOO_LARGE", 413);
  if (!data.filename.toLowerCase().endsWith(".dump")) throw new OpsError("只能上传 .dump 格式的 PostgreSQL 备份", "UPLOAD_INVALID_NAME", 400);
  const disk = await diskSpace(backupFilesRoot());
  if (disk.freeBytes < data.size + 512 * 1024 ** 2) throw new OpsError("备份卷剩余空间不足", "DISK_SPACE_LOW", 507);
  if ((await volumeUsage()) + data.size > volumeMaxBytes) throw new OpsError("备份卷已达到配置容量上限", "VOLUME_LIMIT", 507);
  await assertNoActiveRestore();
  await ensurePrivateDir(uploadSessionsRoot());
  const id = `up_${randomBytes(10).toString("hex")}`;
  const token = randomToken();
  const session: UploadSession = {
    id,
    tokenHash: hashToken(token),
    sessionId,
    userId: current.userId,
    actor: { id: current.user.id, name: current.user.name, login: current.user.login, role: current.user.role },
    filename: data.filename,
    size: data.size,
    sha256: data.sha256?.toLowerCase() ?? "",
    reason: data.reason,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    tempFile: join(uploadSessionsRoot(), `${id}.part`),
    receivedBytes: 0,
    status: "PENDING",
  };
  await writeJsonAtomic(uploadPath(id), session);
  return { uploadId: id, token, expiresAt: session.expiresAt, maxBytes: maxUploadBytes };
}

export async function writeUploadSession(sessionId: string, id: string, token: string, body: ReadableStream<Uint8Array> | null, offset: number) {
  const current = await requireAdmin(sessionId);
  if (!body) throw new OpsError("请选择备份文件", "UPLOAD_EMPTY", 400);
  if (!Number.isSafeInteger(offset) || offset < 0) throw new OpsError("上传偏移无效", "UPLOAD_OFFSET_INVALID", 400);
  const path = uploadPath(z.string().regex(/^up_[a-f0-9]+$/).parse(id));
  const session = await readJson<UploadSession>(path);
  if (!session || session.status === "COMPLETED") throw new OpsError("上传会话不存在或已失效", "UPLOAD_SESSION_INVALID", 404);
  if (session.userId !== current.userId) throw new OpsError("上传会话不属于当前管理员", "UPLOAD_SESSION_INVALID", 403);
  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    await removeFile(session.tempFile);
    await removeFile(path);
    throw new OpsError("上传会话已过期，请重新选择文件", "UPLOAD_SESSION_EXPIRED", 410);
  }
  if (hashToken(token) !== session.tokenHash) throw new OpsError("上传令牌无效", "UPLOAD_TOKEN_INVALID", 403);
  if (session.status !== "PENDING") throw new OpsError("上传会话状态不允许继续写入", "UPLOAD_SESSION_INVALID", 409);
  if (offset !== session.receivedBytes) throw new OpsError(`上传偏移与已接收字节不一致（已接收 ${session.receivedBytes} 字节），请重新上传`, "UPLOAD_OFFSET_MISMATCH", 409);
  await ensurePrivateDir(uploadSessionsRoot());
  let received = offset;
  // Each chunk is appended under the previous byte count, keeping memory bounded
  // in the proxy and allowing dumps far above the proxy request body limit.
  const file = createWriteStream(session.tempFile, { mode: 0o600, flags: offset === 0 ? "w" : "a" });
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > session.size) {
        await reader.cancel();
        throw new OpsError("上传内容超过声明大小", "UPLOAD_SIZE_MISMATCH", 413);
      }
      if (!file.write(value)) await once(file, "drain");
    }
    await new Promise<void>((resolve, reject) => file.end((error?: Error | null) => error ? reject(error) : resolve()));
    if (received > session.size) throw new OpsError("上传内容超过声明大小", "UPLOAD_SIZE_MISMATCH", 413);
    session.receivedBytes = received;
    session.status = received === session.size ? "UPLOADED" : "PENDING";
    if (received === session.size && !session.sha256) session.sha256 = await sha256File(session.tempFile);
    await writeJsonAtomic(path, session);
    return { ok: true, receivedBytes: received, sha256: session.sha256 || null };
  } catch (error) {
    file.destroy();
    await removeFile(session.tempFile);
    session.status = "FAILED";
    await writeJsonAtomic(path, session).catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

export async function completeUploadSession(sessionId: string, id: string, input: unknown) {
  const data = z.object({ manifest: z.unknown().optional() }).strict().parse(input ?? {});
  const current = await requireAdmin(sessionId);
  const path = uploadPath(z.string().regex(/^up_[a-f0-9]+$/).parse(id));
  const session = await readJson<UploadSession>(path);
  if (!session || session.status !== "UPLOADED") throw new OpsError("上传尚未完成或会话已失效", "UPLOAD_SESSION_INVALID", 409);
  if (session.userId !== current.userId) throw new OpsError("上传会话不属于当前管理员", "UPLOAD_SESSION_INVALID", 403);
  await withOpsLock("upload", async () => {
    const actualSize = (await fileInfo(session.tempFile))?.size ?? 0;
    const actualHash = await sha256File(session.tempFile).catch(() => "");
    if (actualSize !== session.size || !actualHash || (session.sha256 && actualHash !== session.sha256)) throw new OpsError("文件校验失败：大小或 SHA-256 与声明不一致", "UPLOAD_HASH_MISMATCH", 400);
    await validateDump(session.tempFile);
    let uploadedManifest: { sha256?: string; bytes?: number; appVersion?: string; gitRevision?: string; migrations?: { name: string; checksum: string; finishedAt?: string | null; rolledBackAt?: string | null }[] } | null = null;
    if (data.manifest !== undefined) {
      uploadedManifest = z.object({ sha256: z.string().optional(), bytes: z.number().optional(), appVersion: z.string().optional(), gitRevision: z.string().optional(), migrations: z.array(z.object({ name: z.string(), checksum: z.string(), finishedAt: z.string().nullable().optional(), rolledBackAt: z.string().nullable().optional() })).optional() }).passthrough().parse(data.manifest);
      if (uploadedManifest.sha256 && uploadedManifest.sha256 !== actualHash) throw new OpsError("清单中的 SHA-256 与文件不一致", "UPLOAD_MANIFEST_MISMATCH", 400);
      if (uploadedManifest.bytes && uploadedManifest.bytes !== actualSize) throw new OpsError("清单中的文件大小与上传文件不一致", "UPLOAD_MANIFEST_MISMATCH", 400);
    }
    const createdAt = new Date();
    const backupId = newBackupId();
    const manifest: BackupManifest = {
      id: backupId,
      filename: backupFilename(createdAt, backupId, "_uploaded"),
      kind: "UPLOADED",
      status: "SUCCEEDED",
      stage: "COMPLETED",
      pinned: true,
      createdAt: createdAt.toISOString(),
      completedAt: createdAt.toISOString(),
      createdBy: { id: session.actor.id, name: session.actor.name, login: session.actor.login },
      reason: session.reason,
      appVersion: typeof uploadedManifest?.appVersion === "string" ? uploadedManifest.appVersion : "unknown",
      gitRevision: typeof uploadedManifest?.gitRevision === "string" ? uploadedManifest.gitRevision : "unknown",
      clientVersion: 0,
      serverVersion: 0,
      migrations: Array.isArray(uploadedManifest?.migrations) ? uploadedManifest.migrations.filter((item): item is BackupMigration => Boolean(item?.name && item?.checksum)).map(item => ({ name: item.name, checksum: item.checksum, finishedAt: null, rolledBackAt: null })) : [],
      bytes: actualSize,
      sha256: actualHash,
      snapshotId: null,
      databaseBytes: 0,
      tables: [],
      sequenceCount: 0,
      evidenceRows: 0,
      activityAttachmentRows: 0,
      includesFiles: false,
      rowCountsSource: "snapshot",
    };
    await ensurePrivateDir(backupFilesRoot());
    await rename(session.tempFile, dumpPath(manifest));
    await saveManifest(manifest);
    session.status = "COMPLETED";
    await writeJsonAtomic(path, session);
    await removeFile(path);
    await recordAudit(db, {
      actorId: current.userId,
      actor: { id: current.user.id, name: current.user.name, login: current.user.login, role: current.user.role },
      action: "BACKUP_UPLOADED",
      targetType: "Backup",
      targetId: manifest.id,
      targetLabel: manifest.filename,
      reason: session.reason,
      details: { bytes: manifest.bytes, sha256Prefix: manifest.sha256.slice(0, 16), sourceFilename: session.filename.slice(0, 200), pinned: true },
    });
  });
  const manifest = (await listBackups(sessionId)).items.find(item => item.kind === "UPLOADED" && item.sha256 === session.sha256 && item.bytes === session.size);
  return manifest ?? { ok: true };
}

export async function activeBackupDirectoryInfo() {
  const info = await fileInfo(backupRoot());
  return info;
}
