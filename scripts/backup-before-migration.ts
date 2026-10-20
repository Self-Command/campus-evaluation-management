import "dotenv/config";
import { spawn } from "node:child_process";
import { mkdir, stat, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { Client } from "pg";
async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  if (url.hostname !== "127.0.0.1" || !url.pathname.endsWith("_dev")) throw new Error("仅允许本机开发数据库备份");
  const folder = resolve(".local/migration-backups", new Date().toISOString().replace(/[:.]/g, "-"));
  await mkdir(folder, { recursive: true });
  const env = { ...process.env, PGHOST: url.hostname, PGPORT: url.port, PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: url.pathname.slice(1) };
  const bin = resolve(homedir(), ".campus-evaluation-dev/postgres-18.4/bin");
  const run = (name: string, args: string[]) => new Promise<void>((done, fail) => {
    const child = spawn(resolve(bin, `${name}.exe`), args, { env, windowsHide: true, stdio: "ignore" });
    child.once("error", () => fail(new Error("数据库备份程序无法运行")));
    child.once("exit", code => code === 0 ? done() : fail(new Error("数据库备份或目录校验失败")));
  });
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    if (existsSync(resolve(bin, "pg_dump.exe")) && existsSync(resolve(bin, "pg_restore.exe"))) {
      await run("pg_dump", ["--format=custom", "--file", resolve(folder, "database.dump")]);
      await run("pg_restore", ["--list", resolve(folder, "database.dump")]);
    }
    // Also retain a checked row archive for recovery into additive migrations.
    // Numeric/Decimal columns are text to avoid JSON number precision loss.
    {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const tables = await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
      const data: Record<string, unknown[]> = {};
      for (const { tablename } of tables.rows) {
        const identifier = '"' + String(tablename).replaceAll('"', '""') + '"';
        const columns = await client.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position", [tablename]);
        const select = columns.rows.map(column => { const name = '"' + String(column.column_name).replaceAll('"', '""') + '"'; return column.data_type === "numeric" ? `${name}::text AS ${name}` : name; }).join(",");
        const rows = await client.query(`SELECT row_to_json(t) AS row FROM (SELECT ${select} FROM public.${identifier}) t`);
        data[tablename] = rows.rows.map(r => r.row);
      }
      await client.query("COMMIT");
      const content = JSON.stringify({ version: 1, createdAt: new Date().toISOString(), tables: data });
      const path = resolve(folder, "database-rows.json");
      await writeFile(path, content, { flag: "wx", mode: 0o600 });
      const verified = JSON.parse(await readFile(path, "utf8"));
      if (Object.keys(data).some(t => verified.tables[t]?.length !== data[t].length)) throw new Error("备份行数校验失败");
      await writeFile(resolve(folder, "database-rows.sha256"), createHash("sha256").update(content).digest("hex"));
    }
    const counts = await client.query('SELECT (SELECT count(*) FROM "User") AS users, (SELECT count(*) FROM "Term") AS terms, (SELECT count(*) FROM "Evidence") AS evidence');
    const backup = existsSync(resolve(folder, "database.dump")) ? "database.dump" : "database-rows.json";
    await writeFile(resolve(folder, "manifest.json"), JSON.stringify({ createdAt: new Date().toISOString(), format: backup, bytes: (await stat(resolve(folder, backup))).size, counts: counts.rows[0], note: "逻辑备份已读取校验；附件未变更。行备份恢复需先部署对应历史迁移。尚未执行隔离恢复。" }, null, 2));
    console.log("迁移前数据库逻辑备份及读取校验通过；未输出凭据，附件未变更。");
  } finally { await client.end(); }
}
main().catch(() => { console.error("备份失败，禁止继续迁移。"); process.exit(1); });
