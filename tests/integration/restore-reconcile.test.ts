import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { Client } from "pg";

let root: string;
let candidate: string;
let restoreModule: typeof import("@/server/restore");
let stateModule: typeof import("@/server/restore-state");

const base = {
  id: "rs_reconcile_1",
  backupId: "bk_reconcile_1",
  phase: "confirmed" as const,
  maintenance: true,
  switched: false,
  candidateDatabase: "",
  previousDatabase: null,
  actorId: "",
  actorName: "测试管理员",
  startedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

async function adminClient() {
  const url = new URL(process.env.DATABASE_URL!);
  return new Client({ connectionString: new URL("/postgres", url).toString() });
}

describe("恢复启动核对", () => {
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "restore-reconcile-"));
    process.env.BACKUP_DIR = root;
    candidate = `${new URL(process.env.DATABASE_URL!).pathname.slice(1)}_candidate_${randomBytes(3).toString("hex")}`;
    const client = await adminClient();
    await client.connect();
    await client.query(`DROP DATABASE IF EXISTS "${candidate}"`);
    await client.query(`CREATE DATABASE "${candidate}"`);
    await client.end();
    stateModule = await import("@/server/restore-state");
    restoreModule = await import("@/server/restore");
  });

  afterAll(async () => {
    const client = await adminClient();
    await client.connect();
    await client.query(`DROP DATABASE IF EXISTS "${candidate}" WITH (FORCE)`);
    await client.end();
    delete process.env.BACKUP_DIR;
    await rm(root, { recursive: true, force: true });
  });

  test("切换前重启会清理候选库并退出维护模式", async () => {
    await stateModule.writeRestoreState({ ...base, candidateDatabase: candidate });
    await restoreModule.reconcileRestoreOnStartup();
    const state = stateModule.readRestoreStateSync();
    expect(state?.phase).toBe("failed");
    expect(state?.maintenance).toBe(false);
    expect(state?.errorCode).toBe("TASK_INTERRUPTED");
    const client = await adminClient();
    await client.connect();
    const result = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [candidate]);
    await client.end();
    expect(result.rowCount).toBe(0);
  });

  test("终态残留维护标记会在启动时清除", async () => {
    await stateModule.writeRestoreState({ ...base, phase: "completed", maintenance: true, switched: true });
    await restoreModule.reconcileRestoreOnStartup();
    expect(stateModule.readRestoreStateSync()?.maintenance).toBe(false);
  });

  test("自动回滚失败的终态保持维护模式", async () => {
    await stateModule.writeRestoreState({ ...base, phase: "failed", maintenance: true, switched: true, errorCode: "RESTORE_ROLLBACK_FAILED" });
    await restoreModule.reconcileRestoreOnStartup();
    const state = stateModule.readRestoreStateSync();
    expect(state?.maintenance).toBe(true);
    expect(state?.errorCode).toBe("RESTORE_ROLLBACK_FAILED");
  });
});
