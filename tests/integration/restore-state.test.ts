import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let root: string;
let stateModule: typeof import("@/server/restore-state");

const base = {
  id: "rs_test_1",
  backupId: "bk_test_1",
  phase: "ready" as const,
  maintenance: false,
  switched: false,
  candidateDatabase: "campus_dev_candidate",
  previousDatabase: null,
  actorId: "user_1",
  actorName: "测试管理员",
  startedAt: "2026-10-24T10:00:00.000Z",
  updatedAt: "2026-10-24T10:00:00.000Z",
};

describe("恢复状态文件", () => {
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "restore-state-"));
    process.env.BACKUP_DIR = root;
    stateModule = await import("@/server/restore-state");
  });

  afterAll(async () => {
    delete process.env.BACKUP_DIR;
    await rm(root, { recursive: true, force: true });
  });

  test("写入后可同步读取并在维护模式中被识别", async () => {
    await stateModule.writeRestoreState({ ...base, maintenance: true });
    const state = stateModule.readRestoreStateSync();
    expect(state?.id).toBe(base.id);
    expect(state?.maintenance).toBe(true);
    expect(stateModule.maintenanceState()?.id).toBe(base.id);
  });

  test("局部更新保留其他字段并刷新更新时间", async () => {
    await stateModule.writeRestoreState(base);
    const next = await stateModule.patchRestoreState({ id: base.id, phase: "completed", switched: true });
    expect(next?.phase).toBe("completed");
    expect(next?.switched).toBe(true);
    expect(next?.candidateDatabase).toBe(base.candidateDatabase);
    expect(next?.updatedAt).not.toBe(base.updatedAt);
    expect((await stateModule.readRestoreState())?.phase).toBe("completed");
  });

  test("拒绝更新不匹配的任务", async () => {
    await stateModule.writeRestoreState(base);
    expect(await stateModule.patchRestoreState({ id: "rs_other", phase: "failed" })).toBeNull();
    expect((await stateModule.readRestoreState())?.phase).toBe("ready");
  });

  test("损坏的状态文件不会导致启动失败", async () => {
    await writeFile(join(root, "restore-state.json"), "{not-json", "utf8");
    expect(stateModule.readRestoreStateSync()).toBeNull();
    expect(stateModule.maintenanceState()).toBeNull();
    expect(await stateModule.readRestoreState()).toBeNull();
  });

  test("写入使用原子替换，文件始终是完整 JSON", async () => {
    await stateModule.writeRestoreState({ ...base, phase: "rolled-back" });
    const raw = JSON.parse(await readFile(join(root, "restore-state.json"), "utf8")) as { phase: string };
    expect(raw.phase).toBe("rolled-back");
  });
});
