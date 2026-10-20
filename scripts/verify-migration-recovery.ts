import "dotenv/config";
import { randomBytes, createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { Client } from "pg";

async function main() {
  const base = new URL(process.env.DATABASE_URL!);
  if (base.hostname !== "127.0.0.1" || !base.pathname.endsWith("_dev")) throw new Error("仅允许本机隔离恢复");
  const root = resolve(".local/migration-backups");
  const folders = (await readdir(root, { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name).sort().reverse();
  let folder: string | undefined;
  for (const candidate of folders) {
    try { await readFile(resolve(root, candidate, "manifest.json")); folder = resolve(root, candidate); break; } catch {}
  }
  if (!folder) throw new Error("缺少已校验备份");
  const content = await readFile(resolve(folder, "database-rows.json"), "utf8");
  const expectedHash = (await readFile(resolve(folder, "database-rows.sha256"), "utf8")).trim();
  if (createHash("sha256").update(content).digest("hex") !== expectedHash) throw new Error("备份校验失败");
  const backup = JSON.parse(content) as { tables: Record<string, Record<string, unknown>[]> };
  const name = `campus_restore_${randomBytes(6).toString("hex")}`;
  const control = new Client({ connectionString: new URL("/postgres", base).toString() });
  await control.connect();
  await control.query(`CREATE DATABASE "${name}"`);
  const restored = new Client({ connectionString: new URL(`/${name}`, base).toString() });
  try {
    await new Promise<void>((done, fail) => {
      const child = spawn(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: new URL(`/${name}`, base).toString() }, windowsHide: true, stdio: "ignore" });
      child.once("error", fail); child.once("exit", code => code === 0 ? done() : fail(new Error("隔离迁移失败")));
    });
    await restored.connect();
    const constraints = await restored.query("SELECT c.relname AS child, p.relname AS parent FROM pg_constraint f JOIN pg_class c ON c.oid=f.conrelid JOIN pg_class p ON p.oid=f.confrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE f.contype='f' AND n.nspname='public'");
    const pending = new Set(Object.keys(backup.tables).filter(t => t !== "_prisma_migrations"));
    const inserted = new Set<string>();
    const canonical = (value: unknown): string => {
      const normalize = (item: unknown): unknown => Array.isArray(item) ? item.map(normalize) : item !== null && typeof item === "object" ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => [key, normalize(val)])) : item;
      return JSON.stringify(normalize(value));
    };
    const identifier = (s: string) => '"' + s.replaceAll('"', '""') + '"';
    await restored.query("BEGIN");
    while (pending.size) {
      const ready = [...pending].filter(t => constraints.rows.every(e => e.child !== t || !pending.has(e.parent) || inserted.has(e.parent)));
      if (!ready.length) throw new Error("恢复依赖循环");
      for (const table of ready) {
        const rows = backup.tables[table];
        if (rows.length) {
          const columns = Object.keys(rows[0]).map(identifier).join(",");
          // Explicit original columns preserve defaults introduced by additive migrations.
          await restored.query(`INSERT INTO public.${identifier(table)} (${columns}) SELECT ${columns} FROM json_populate_recordset(NULL::public.${identifier(table)}, $1::json)`, [JSON.stringify(rows)]);
        }
        const count = await restored.query(`SELECT count(*)::int AS count FROM public.${identifier(table)}`);
        if (count.rows[0].count !== rows.length) throw new Error("恢复行数不一致");
        if (rows.length) {
          const types = await restored.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=$1", [table]);
          const select = Object.keys(rows[0]).map(column => { const name = identifier(column); return types.rows.some(type => type.column_name === column && type.data_type === "numeric") ? `${name}::text AS ${name}` : name; }).join(",");
          const actual = await restored.query(`SELECT row_to_json(t) AS row FROM (SELECT ${select} FROM public.${identifier(table)}) t`);
          if (JSON.stringify(rows.map(canonical).sort()) !== JSON.stringify(actual.rows.map(item => canonical(item.row)).sort())) throw new Error("恢复内容不一致");
        }
        pending.delete(table); inserted.add(table);
      }
    }
    await restored.query("COMMIT");
    const migrations = (await readdir(resolve("prisma/migrations"), { withFileTypes: true })).filter(item => item.isDirectory()).map(item => item.name).sort();
    await writeFile(resolve(folder, "isolated-recovery.json"), JSON.stringify({ verifiedAt: new Date().toISOString(), backupHash: expectedHash, tablesVerified: inserted.size, migrationApplied: migrations.at(-1), result: "PASS", comparison: "每张原业务表的行数与全部原字段内容一致，Decimal以文本比对", attachments: "原附件未变更；本次仅验证数据库逻辑恢复，非附件全量恢复" }, null, 2));
    console.log(`隔离恢复及增量迁移通过，${inserted.size}张业务表原字段内容及行数一致；临时恢复库将删除。`);
  } finally {
    await restored.end().catch(() => {});
    if (!/^campus_restore_[a-f0-9]{12}$/.test(name)) throw new Error("恢复库名称保护失败");
    await control.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await control.end();
  }
}
main().catch(() => { console.error("隔离恢复验证失败，禁止继续正式迁移。"); process.exit(1); });
