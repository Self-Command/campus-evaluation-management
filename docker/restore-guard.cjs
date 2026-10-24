const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const terminal = new Set(["completed", "failed", "rolled-back"]);
const root = process.env.BACKUP_DIR?.trim() || join(process.cwd(), ".local", "backups");
const statePath = join(root, "restore-state.json");

try {
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  const phase = typeof state?.phase === "string" ? state.phase : "unknown";
  const maintenance = state?.maintenance === true;
  if (maintenance || !terminal.has(phase)) {
    console.log(`[restore-guard] unfinished restore detected: phase=${phase}, maintenance=${maintenance}`);
    process.exit(1);
  }
} catch (error) {
  if (error?.code !== "ENOENT") {
    console.error("[restore-guard] restore state cannot be read; refusing database setup");
    process.exit(1);
  }
}
process.exit(0);
