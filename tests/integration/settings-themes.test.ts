import { afterAll, beforeAll, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { publicSettings, saveSettings, readSettings } from "@/server/settings";
import { defaultSettings } from "@/lib/settings-schema";

const address = new URL(process.env.DATABASE_URL!);
if (address.hostname !== "127.0.0.1" || !/^\/campus_test_[a-f0-9]{12}$/.test(address.pathname)) throw new Error("必须由隔离运行器执行");
const marker = `settings-${randomUUID().slice(0, 8)}`;
let adminId = "", sessionId = "", original: Awaited<ReturnType<typeof publicSettings>>;

beforeAll(async () => {
  const admin = await db.user.create({ data: { login: `${marker}-admin`, name: "设置管理员", role: "ADMIN", passwordHash: "fixture-only", mustChangePassword: false } });
  adminId = admin.id;
  sessionId = (await db.authSession.create({ data: { userId: admin.id, version: 0, expiresAt: new Date(Date.now() + 600_000) } })).id;
  original = await publicSettings();
});

afterAll(async () => {
  // Restore whatever the isolated database held before this suite.
  const { revision, updatedAt, ...content } = original;
  void revision;
  void updatedAt;
  await db.siteSettings.deleteMany({ where: { id: "site" } });
  if (original.updatedAt) await db.siteSettings.create({ data: { id: "site", content, revision: original.revision } });
  await db.loginFailureState.deleteMany();
  await db.auditEvent.deleteMany({ where: { actorId: adminId } });
  await db.user.deleteMany({ where: { id: adminId } });
  await db.$disconnect();
});

const payload = (themePreset: "default" | "brutalist" | "soft-pop" | "tangerine", revision: number, reason = "设置保存验证") => ({ ...defaultSettings, themePreset, revision, reason });

test("主题设置可保存、可读回，并替换旧的配色预设", async () => {
  const before = await readSettings(sessionId);
  const saved = await saveSettings(sessionId, payload("soft-pop", before.revision));
  expect(saved.themePreset).toBe("soft-pop");
  expect(saved.revision).toBe(before.revision + 1);
  const read = await publicSettings();
  expect(read.themePreset).toBe("soft-pop");
  expect(read.siteName).toBe(defaultSettings.siteName);
  const next = await saveSettings(sessionId, payload("tangerine", read.revision));
  expect(next.themePreset).toBe("tangerine");
  // A stale revision cannot overwrite a newer save.
  await expect(saveSettings(sessionId, payload("default", before.revision))).rejects.toThrow("系统设置已变化");
  await expect(saveSettings(sessionId, { ...payload("default", next.revision), reason: "" })).rejects.toThrow();
});

test("历史配色值不会让全站读取失败，按默认主题回退", async () => {
  await db.siteSettings.deleteMany({ where: { id: "site" } });
  await db.siteSettings.create({ data: { id: "site", revision: 7, content: { ...defaultSettings, themePreset: "violet" } } });
  const settings = await publicSettings();
  expect(settings.themePreset).toBe("default");
  expect(settings.revision).toBe(7);
});
