import { createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { chmod, mkdir, readFile, rename, stat, statfs, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Client } from "pg";
import { spawn } from "node:child_process";

export class OpsError extends Error {
  constructor(message: string, readonly code = "OPS_FAILED", readonly status = 400) {
    super(message);
    this.name = "OpsError";
  }
}

const rootEnv = process.env.BACKUP_DIR?.trim();

export function backupRoot() {
  return rootEnv || join(process.cwd(), ".local", "backups");
}

export function restoreStateFile() {
  return join(backupRoot(), "restore-state.json");
}

export function reportsRoot() {
  return join(backupRoot(), "restore-reports");
}

export function uploadSessionsRoot() {
  return join(backupRoot(), "upload-sessions");
}

export async function ensurePrivateDir(path: string) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  try { await chmod(path, 0o700); } catch { /* Windows and some filesystems ignore modes. */ }
}

export async function writePrivateFile(path: string, data: string | Buffer) {
  await ensurePrivateDir(dirname(path));
  await writeFile(path, data, { mode: 0o600 });
  try { await chmod(path, 0o600); } catch { /* Ignore unsupported mode. */ }
}

export async function writeJsonAtomic(path: string, value: unknown) {
  const temp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  await writePrivateFile(temp, JSON.stringify(value, null, 2));
  // Polling readers can briefly hold the previous file open on Windows.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await rename(temp, path);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES") throw error;
      if (attempt === 5) {
        await unlink(path).catch(() => undefined);
        await rename(temp, path);
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 25 * 2 ** attempt));
    }
  }
}

export async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

export async function removeFile(path: string) {
  try { await unlink(path); } catch { /* Missing files are already clean. */ }
}

export function quoteIdent(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

export function validDatabaseName(value: string) {
  return /^[A-Za-z0-9_]+$/.test(value) && Buffer.byteLength(value, "utf8") <= 63;
}

export function shortDatabaseName(base: string, suffix: string) {
  const clean = base.replace(/[^A-Za-z0-9_]/g, "_");
  const candidate = `${clean}${suffix}`;
  if (Buffer.byteLength(candidate, "utf8") <= 63) return candidate;
  const digest = createHash("sha256").update(candidate).digest("hex").slice(0, 10);
  return `${clean.slice(0, 40)}_${digest}${suffix.slice(-5)}`;
}

type DatabaseConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  sslmode: string | null;
};

export function databaseConfig(): DatabaseConfig {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new OpsError("数据库连接尚未配置", "DATABASE_NOT_CONFIGURED", 503);
  let url: URL;
  try { url = new URL(raw); } catch { throw new OpsError("数据库连接配置无效", "DATABASE_NOT_CONFIGURED", 503); }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") throw new OpsError("数据库连接配置无效", "DATABASE_NOT_CONFIGURED", 503);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!database || !validDatabaseName(database)) throw new OpsError("数据库名称格式不受支持", "DATABASE_NOT_CONFIGURED", 503);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 5432,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
    sslmode: url.searchParams.get("sslmode"),
  };
}

export function connectionStringFor(database: string) {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new OpsError("数据库连接尚未配置", "DATABASE_NOT_CONFIGURED", 503);
  const url = new URL(raw);
  url.pathname = `/${encodeURIComponent(database)}`;
  url.searchParams.delete("schema");
  return url.toString();
}

export function pgEnv(database = databaseConfig().database) {
  const config = databaseConfig();
  return {
    PGHOST: config.host,
    PGPORT: String(config.port),
    PGUSER: config.user,
    PGPASSWORD: config.password,
    PGDATABASE: database,
    ...(config.sslmode ? { PGSSLMODE: config.sslmode } : {}),
    PGCONNECT_TIMEOUT: "15",
  };
}

export async function withClient<T>(database: string, operation: (client: Client) => Promise<T>) {
  const client = new Client({ connectionString: connectionStringFor(database), application_name: "campus-ops" });
  await client.connect();
  try { return await operation(client); }
  finally { await client.end().catch(() => undefined); }
}

const lockKeys = { backup: 72109320, restore: 72109321, purge: 72109322, upload: 72109323 } as const;
export type OpsLock = keyof typeof lockKeys;

export async function withOpsLock<T>(lock: OpsLock, operation: () => Promise<T>) {
  const database = lock === "restore" ? "postgres" : databaseConfig().database;
  return withClient(database, async client => {
    const result = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock($1) AS locked", [lockKeys[lock]]);
    if (!result.rows[0]?.locked) throw new OpsError("已有相同类型的任务正在进行，请等待其完成", "TASK_BUSY", 409);
    try { return await operation(); }
    finally { await client.query("SELECT pg_advisory_unlock($1)", [lockKeys[lock]]).catch(() => undefined); }
  });
}

export async function databaseSize(database = databaseConfig().database) {
  return withClient(database, async client => {
    const result = await client.query<{ bytes: string }>("SELECT pg_database_size(current_database())::text AS bytes");
    return Number(result.rows[0]?.bytes ?? 0);
  });
}

export async function serverVersion(database = databaseConfig().database) {
  return withClient(database, async client => {
    const result = await client.query<{ version: string; encoding: string; collate: string; ctype: string }>(
      `SELECT current_setting('server_version_num') AS version, pg_encoding_to_char(encoding) AS encoding, datcollate AS collate, datctype AS ctype FROM pg_database WHERE datname = current_database()`,
    );
    return result.rows[0];
  });
}

export function pgTool(name: "pg_dump" | "pg_restore" | "psql") {
  const key = name === "pg_dump" ? "PG_DUMP_BIN" : name === "pg_restore" ? "PG_RESTORE_BIN" : "PSQL_BIN";
  return process.env[key]?.trim() || name;
}

export async function toolVersion(name: "pg_dump" | "pg_restore") {
  const output = await runBinary(pgTool(name), ["--version"], { timeoutMs: 15_000, publicCode: "PG_TOOLS_MISSING" });
  const match = output.stdout.match(/(\d+)(?:\.\d+)?/);
  return match ? Number(match[1]) : 0;
}

export async function assertPgTools() {
  const [dump, restore] = await Promise.all([toolVersion("pg_dump"), toolVersion("pg_restore")]);
  if (!dump || !restore) throw new OpsError("服务器未安装 PostgreSQL 客户端工具", "PG_TOOLS_MISSING", 503);
  return { dump, restore };
}

type RunOptions = {
  timeoutMs?: number;
  env?: Record<string, string | undefined>;
  stdoutPath?: string;
  publicCode?: string;
  maxStdout?: number;
};

export function runBinary(command: string, args: string[], options: RunOptions = {}) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...(options.env ?? {}) },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs ?? 10 * 60_000);
    timer.unref?.();
    const fileStream = options.stdoutPath ? createWriteStream(options.stdoutPath, { mode: 0o600 }) : null;
    if (fileStream) child.stdout.pipe(fileStream);
    child.stdout.on("data", chunk => {
      if (fileStream) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (stdout.reduce((sum, item) => sum + item.length, 0) < (options.maxStdout ?? 2 * 1024 * 1024)) stdout.push(buffer);
    });
    child.stderr.on("data", chunk => {
      if (stderr.reduce((sum, item) => sum + item.length, 0) < 256 * 1024) stderr.push(Buffer.from(chunk));
    });
    child.on("error", error => {
      clearTimeout(timer);
      const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
      reject(new OpsError(missing ? "服务器未安装所需的 PostgreSQL 客户端工具" : "系统命令无法启动", options.publicCode ?? "PG_TOOLS_MISSING", 503));
    });
    child.on("close", code => {
      clearTimeout(timer);
      const stderrText = Buffer.concat(stderr).toString("utf8");
      if (timedOut) {
        reject(new OpsError("数据库任务超时，已终止", "TASK_TIMEOUT", 504));
        return;
      }
      if (code !== 0) {
        console.error("数据库命令失败", command, code, stderrText.slice(0, 500).replaceAll(/\s+/g, " "));
        reject(new OpsError("数据库操作失败，请查看服务器日志中的稳定错误码", options.publicCode ?? "PG_COMMAND_FAILED", 500));
        return;
      }
      resolve({ stdout: Buffer.concat(stdout).toString("utf8"), stderr: stderrText });
    });
  });
}

export async function sha256File(path: string) {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", chunk => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export async function fileInfo(path: string) {
  try {
    const info = await stat(path);
    return { size: info.size, mtime: info.mtime };
  } catch {
    return null;
  }
}

export async function diskSpace(path: string) {
  await ensurePrivateDir(path);
  const stats = await statfs(path);
  const blockSize = Number(stats.bsize);
  return {
    totalBytes: Number(stats.blocks) * blockSize,
    freeBytes: Number(stats.bavail) * blockSize,
  };
}

export function randomToken() {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export const maxUploadBytes = Math.min(Number(process.env.BACKUP_MAX_BYTES ?? 2 * 1024 ** 3) || 2 * 1024 ** 3, 2 * 1024 ** 3);
export const maxRestoreAuditBytes = 1024 ** 3;
export const maxZipBytes = 2 * 1024 ** 3;
export const maxZipFiles = 2000;
