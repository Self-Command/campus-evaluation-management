import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

let root: string;

function guard() {
  return spawnSync(process.execPath, ["docker/restore-guard.cjs"], {
    env: { ...process.env, BACKUP_DIR: root },
    encoding: "utf8",
  });
}

async function state(value: string) {
  await writeFile(join(root, "restore-state.json"), value, "utf8");
}

describe("容器启动恢复守卫", () => {
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "restore-guard-"));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  test("无状态或终态允许迁移和初始化", async () => {
    await rm(join(root, "restore-state.json"), { force: true });
    expect(guard().status).toBe(0);
    for (const phase of ["completed", "failed", "rolled-back"]) {
      await state(JSON.stringify({ phase, maintenance: false }));
      expect(guard().status).toBe(0);
    }
  });

  test("未完成恢复或维护模式阻止数据库初始化", async () => {
    for (const phase of ["preflight", "ready", "confirmed", "snapshot", "exported", "swapping", "swapped", "unknown"]) {
      await state(JSON.stringify({ phase, maintenance: false }));
      expect(guard().status).toBe(1);
    }
    await state(JSON.stringify({ phase: "failed", maintenance: true }));
    expect(guard().status).toBe(1);
  });

  test("损坏的状态文件按失败关闭处理", async () => {
    await state("{broken");
    const result = guard();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("restore state cannot be read");
  });
});
