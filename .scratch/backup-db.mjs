// Logical row backup used before applying an incremental migration. The bundled
// PostgreSQL build ships no pg_dump, so this writes NDJSON per table plus a
// manifest with row counts and SHA-256 digests.
// Usage: node .scratch/backup-db.mjs [label]
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import pg from "pg";

const label = process.argv[2] ?? "manual";
const envLine = fs.readFileSync(".env", "utf8").split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="));
const url = envLine.slice("DATABASE_URL=".length).trim().replace(/^"|"$/g, "");
const dir = path.join(".local", "migration-backups", label);
fs.mkdirSync(dir, { recursive: true });
const client = new pg.Client({ connectionString: url });
await client.connect();
const tables = (await client.query("select tablename from pg_tables where schemaname='public' order by tablename")).rows.map((r) => r.tablename);
const manifest = { database: new URL(url).pathname.slice(1), createdAt: new Date().toISOString(), tables: [] };
for (const table of tables) {
  if (table === "_prisma_migrations") continue;
  const rows = (await client.query(`select row_to_json(t) as row from "${table}" t`)).rows.map((r) => r.row);
  const text = rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : "");
  fs.writeFileSync(path.join(dir, `${table}.ndjson`), text);
  manifest.tables.push({ table, rows: rows.length, sha256: crypto.createHash("sha256").update(text).digest("hex") });
}
fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
const total = manifest.tables.reduce((sum, item) => sum + item.rows, 0);
console.log(`backup ${dir}: ${manifest.tables.length} tables, ${total} rows`);
for (const item of manifest.tables) console.log(`${item.table.padEnd(28)} ${String(item.rows).padStart(6)}`);
await client.end();
