// Compares prisma/schema.prisma with the live database (tables, columns) without
// invoking the Prisma schema engine, so drift can be checked under a restricted
// sandbox. Relation fields are ignored; scalar field/column mismatches are listed.
// Usage: node .scratch/schema-drift.mjs
import fs from "node:fs";
import pg from "pg";

const line0 = fs.readFileSync(".env", "utf8").split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="));
const url = line0.slice("DATABASE_URL=".length).trim().replace(/^"|"$/g, "");
const schema = fs.readFileSync("prisma/schema.prisma", "utf8");
const models = [];
let current = null;
for (const raw of schema.split(/\r?\n/)) {
  const text = raw.trim();
  const head = /^(model|enum)\s+(\w+)/.exec(text);
  if (head) {
    current = { kind: head[1], name: head[2], fields: [] };
    if (current.kind === "model") models.push(current);
    continue;
  }
  if (text === "}") { current = null; continue; }
  if (!current || current.kind !== "model" || !text || text.startsWith("//") || text.startsWith("@@")) continue;
  const match = /^(\w+)\s+([\w[\]]+)/.exec(text);
  if (match) current.fields.push({ name: match[1], type: match[2] });
}
const modelNames = new Set(models.map((m) => m.name));
const isRelation = (field) => modelNames.has(field.type.replace(/[[\]?]/g, ""));

const client = new pg.Client({ connectionString: url });
await client.connect();
const tables = await client.query("select tablename from pg_tables where schemaname='public'");
const columns = await client.query("select table_name, column_name from information_schema.columns where table_schema='public'");
const dbTables = new Set(tables.rows.map((r) => r.tablename));
const dbColumns = new Map();
for (const row of columns.rows) {
  if (!dbColumns.has(row.table_name)) dbColumns.set(row.table_name, new Set());
  dbColumns.get(row.table_name).add(row.column_name);
}
let problems = 0;
for (const model of models) {
  if (!dbTables.has(model.name)) { console.log(`MISSING TABLE ${model.name}`); problems++; continue; }
  const cols = dbColumns.get(model.name);
  const wanted = model.fields.filter((f) => !isRelation(f)).map((f) => f.name);
  const missing = wanted.filter((f) => !cols.has(f));
  const extra = [...cols].filter((c) => !wanted.includes(c));
  if (missing.length) { console.log(`${model.name}: missing columns ${missing.join(", ")}`); problems++; }
  if (extra.length) { console.log(`${model.name}: extra columns ${extra.join(", ")}`); problems++; }
}
for (const table of dbTables) if (table !== "_prisma_migrations" && !models.some((m) => m.name === table)) { console.log(`EXTRA TABLE ${table}`); problems++; }
console.log(problems ? `drift: ${problems} problem(s)` : "schema matches database");
await client.end();
