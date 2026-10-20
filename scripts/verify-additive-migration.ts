import "dotenv/config";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { Client } from "pg";
// Compares original protected records without printing their contents or secrets.
async function main() {
  const base = new URL(process.env.DATABASE_URL!);
  if (base.hostname !== "127.0.0.1" || !base.pathname.endsWith("_dev")) throw new Error("仅允许核对本机开发库");
  const root = resolve(".local/migration-backups");
  const folders = (await readdir(root, { withFileTypes: true })).filter(item => item.isDirectory()).map(item => item.name).sort().reverse();
  let folder: string | undefined;
  for (const candidate of folders) { try { const proof = JSON.parse(await readFile(resolve(root, candidate, "isolated-recovery.json"), "utf8")); if (proof.result === "PASS") { folder = resolve(root, candidate); break; } } catch {} }
  if (!folder) throw new Error("缺少通过隔离恢复的备份");
  const content = await readFile(resolve(folder, "database-rows.json"), "utf8");
  const expected = (await readFile(resolve(folder, "database-rows.sha256"), "utf8")).trim();
  if (createHash("sha256").update(content).digest("hex") !== expected) throw new Error("备份哈希不一致");
  const backup = JSON.parse(content) as { tables: Record<string, Record<string, unknown>[]> };
  const normalize = (item: unknown): unknown => Array.isArray(item) ? item.map(normalize) : item !== null && typeof item === "object" ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => [key, normalize(val)])) : item;
  const canonical = (item: unknown) => JSON.stringify(normalize(item));
  const identifier = (name: string) => '"' + name.replaceAll('"', '""') + '"';
  const db = new Client({ connectionString: base.toString() }); await db.connect();
  try {
    await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const changed: string[] = []; let records = 0, tables = 0;
    for (const [table, rows] of Object.entries(backup.tables)) {
      if (table === "_prisma_migrations") continue;
      tables++; records += rows.length; if (!rows.length) continue;
      const types = await db.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=$1", [table]);
      const select = Object.keys(rows[0]).map(column => { const name = identifier(column); return types.rows.some(type => type.column_name === column && type.data_type === "numeric") ? `${name}::text AS ${name}` : name; }).join(",");
      const actual = await db.query(`SELECT row_to_json(t) AS row FROM (SELECT ${select} FROM public.${identifier(table)}) t`);
      const pool = new Map<string, number>();
      for (const entry of actual.rows) { const key = canonical(entry.row); pool.set(key, (pool.get(key) ?? 0) + 1); }
      for (const row of rows) { const key = canonical(row), count = pool.get(key) ?? 0; if (!count) { changed.push(table); break; } pool.set(key, count - 1); }
    }
    await db.query("COMMIT");
    await writeFile(resolve(folder, "post-migration-preservation.json"), JSON.stringify({ checkedAt: new Date().toISOString(), tables, records, unchanged: changed.length === 0, changedTables: changed, scope: "原字段逐值核对；不输出内容，允许新增记录；附件文件未修改" }, null, 2));
    if (changed.length) throw new Error("检测到原记录变化，详见本地核对摘要");
    console.log(`迁移后保护核对通过：${tables}张原业务表、${records}条原记录的全部原字段一致。`);
  } finally { await db.end(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "保护核对失败"); process.exit(1); });
