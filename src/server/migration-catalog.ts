import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export type LocalMigration = { name: string; checksum: string };

let cached: LocalMigration[] | null = null;

export async function localMigrations() {
  if (cached) return cached;
  const root = join(process.cwd(), "prisma", "migrations");
  const entries = await readdir(root, { withFileTypes: true });
  const migrations: LocalMigration[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const sql = await readFile(join(root, entry.name, "migration.sql"));
    migrations.push({ name: entry.name, checksum: createHash("sha256").update(sql).digest("hex") });
  }
  cached = migrations;
  return migrations;
}
