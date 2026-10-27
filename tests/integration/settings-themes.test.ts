import { afterAll, beforeAll, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { publicSettings, saveSettings, readSettings, readSiteSettings, uploadBrandAsset } from "@/server/settings";
import { defaultSettings } from "@/lib/settings-schema";

const address = new URL(process.env.DATABASE_URL!);
if (address.hostname !== "127.0.0.1" || !/^\/campus_test_[a-f0-9]{12}$/.test(address.pathname)) throw new Error("必须由隔离运行器执行");
const marker = `settings-${randomUUID().slice(0, 8)}`;
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=", "base64");
let adminId = "", sessionId = "", original: Awaited<ReturnType<typeof readSiteSettings>>;

beforeAll(async () => {
  const admin = await db.user.create({ data: { login: `${marker}-admin`, name: "设置管理员", role: "ADMIN", passwordHash: "fixture-only", mustChangePassword: false } });
  adminId = admin.id;
  sessionId = (await db.authSession.create({ data: { userId: admin.id, version: 0, expiresAt: new Date(Date.now() + 600_000) } })).id;
  original = await readSiteSettings();
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
  const read = await readSiteSettings();
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
  const settings = await readSiteSettings();
  expect(settings.themePreset).toBe("default");
  expect(settings.revision).toBe(7);
});

test("Logo 显示尺寸可保存回读，历史设置缺失时使用默认值", async () => {
  await db.siteSettings.deleteMany({ where: { id: "site" } });
  const { logoSize, ...legacyContent } = defaultSettings;
  void logoSize;
  await db.siteSettings.create({ data: { id: "site", revision: 8, content: legacyContent } });
  const legacy = await readSiteSettings();
  expect(legacy.logoSize).toBe(28);
  const saved = await saveSettings(sessionId, { ...defaultSettings, logoSize: 64, revision: legacy.revision, reason: "调整 Logo 显示尺寸" });
  expect(saved.logoSize).toBe(64);
  expect((await readSiteSettings()).logoSize).toBe(64);
  const larger = await saveSettings(sessionId, { ...defaultSettings, logoSize: 256, revision: saved.revision, reason: "大尺寸 Logo" });
  expect(larger.logoSize).toBe(256);
  expect((await readSiteSettings()).logoSize).toBe(256);
  await expect(saveSettings(sessionId, { ...defaultSettings, logoSize: 8, revision: larger.revision, reason: "非法 Logo 尺寸" })).rejects.toThrow();
});

test("浅色与深色 Logo 可分别保存并由公开设置返回", async () => {
  await db.siteSettings.deleteMany({ where: { id: "site" } });
  const light = await uploadBrandAsset(sessionId, png);
  const dark = await uploadBrandAsset(sessionId, png);
  const before = await readSiteSettings();
  const saved = await saveSettings(sessionId, {
    ...defaultSettings,
    logoAssetId: light.id,
    logoDarkAssetId: dark.id,
    revision: before.revision,
    reason: "配置浅色与深色 Logo",
  });
  expect(saved.logoAssetId).toBe(light.id);
  expect(saved.logoDarkAssetId).toBe(dark.id);
  const visible = await publicSettings();
  expect(visible.logoAssetId).toBe(light.id);
  expect(visible.logoDarkAssetId).toBe(dark.id);
  await expect(saveSettings(sessionId, { ...defaultSettings, logoDarkAssetId: "missing-logo", revision: saved.revision, reason: "校验缺失深色 Logo" })).rejects.toThrow("品牌图片不存在");
});

test("公开设置只暴露品牌白名单，不泄露登录与附件策略", async () => {
  const value = await publicSettings();
  expect(Object.keys(value).sort()).toEqual([
    "defaultThemeMode",
    "faviconAssetId",
    "loginBackgroundAssetId",
    "loginCardBlur",
    "loginCardGlow",
    "loginCardGlowTone",
    "loginCardOpacity",
    "loginCardSaturation",
    "loginNotice",
    "logoAssetId",
    "logoDarkAssetId",
    "logoSize",
    "pageTitle",
    "siteDescription",
    "siteName",
    "themePreset",
  ]);
  expect("loginFailureLimitEnabled" in value).toBe(false);
  expect("activityAttachmentMaxFiles" in value).toBe(false);
  expect("revision" in value).toBe(false);
});

test("默认深浅模式、登录公告、登录背景与玻璃参数可保存回读，非法值与旧设置回退", async () => {
  const background = await uploadBrandAsset(sessionId, png, "login-background");
  const before = await readSettings(sessionId);
  const saved = await saveSettings(sessionId, {
    ...defaultSettings,
    defaultThemeMode: "dark",
    loginNotice: "  测评已开放  ",
    loginBackgroundAssetId: background.id,
    loginCardBlur: 32,
    loginCardOpacity: 68,
    loginCardSaturation: 160,
    loginCardGlow: 82,
    loginCardGlowTone: "aurora",
    revision: before.revision,
    reason: "配置登录页背景与公告",
  });
  expect(saved.defaultThemeMode).toBe("dark");
  expect(saved.loginNotice).toBe("测评已开放");
  expect(saved.loginBackgroundAssetId).toBe(background.id);
  expect(saved.loginCardBlur).toBe(32);
  expect(saved.loginCardOpacity).toBe(68);
  expect(saved.loginCardSaturation).toBe(160);
  expect(saved.loginCardGlow).toBe(82);
  expect(saved.loginCardGlowTone).toBe("aurora");
  const visible = await publicSettings();
  expect(visible.defaultThemeMode).toBe("dark");
  expect(visible.loginBackgroundAssetId).toBe(background.id);
  expect(visible.loginNotice).toBe("测评已开放");
  expect(visible.loginCardBlur).toBe(32);
  expect(visible.loginCardOpacity).toBe(68);
  expect(visible.loginCardSaturation).toBe(160);
  expect(visible.loginCardGlow).toBe(82);
  expect(visible.loginCardGlowTone).toBe("aurora");
  await expect(saveSettings(sessionId, { ...defaultSettings, defaultThemeMode: "sepia", revision: saved.revision, reason: "非法默认模式" })).rejects.toThrow();
  await expect(saveSettings(sessionId, { ...defaultSettings, loginNotice: "字".repeat(201), revision: saved.revision, reason: "公告过长" })).rejects.toThrow();
  await expect(saveSettings(sessionId, { ...defaultSettings, loginCardBlur: 41, revision: saved.revision, reason: "模糊过强" })).rejects.toThrow();
  await expect(saveSettings(sessionId, { ...defaultSettings, loginCardBlur: -1, revision: saved.revision, reason: "模糊非法" })).rejects.toThrow();
  await expect(saveSettings(sessionId, { ...defaultSettings, loginCardOpacity: 19, revision: saved.revision, reason: "透明度过低" })).rejects.toThrow();
  await expect(saveSettings(sessionId, { ...defaultSettings, loginCardSaturation: 201, revision: saved.revision, reason: "饱和度过高" })).rejects.toThrow();
  await expect(saveSettings(sessionId, { ...defaultSettings, loginCardGlow: 101, revision: saved.revision, reason: "光晕过强" })).rejects.toThrow();
  await expect(saveSettings(sessionId, { ...defaultSettings, loginCardGlowTone: "rainbow", revision: saved.revision, reason: "非法色调" })).rejects.toThrow();
  await expect(saveSettings(sessionId, { ...defaultSettings, loginBackgroundAssetId: "missing-asset", revision: saved.revision, reason: "背景不存在" })).rejects.toThrow("品牌图片不存在");
  await db.siteSettings.deleteMany({ where: { id: "site" } });
  const { defaultThemeMode, loginBackgroundAssetId, loginNotice, loginCardBlur, loginCardOpacity, loginCardSaturation, loginCardGlow, loginCardGlowTone, logoDarkAssetId, ...legacy } = defaultSettings;
  void logoDarkAssetId;
  void defaultThemeMode;
  void loginBackgroundAssetId;
  void loginNotice;
  void loginCardBlur;
  void loginCardOpacity;
  void loginCardSaturation;
  void loginCardGlow;
  void loginCardGlowTone;
  await db.siteSettings.create({ data: { id: "site", revision: 9, content: legacy } });
  const read = await readSiteSettings();
  expect(read.defaultThemeMode).toBe("light");
  expect(read.loginBackgroundAssetId).toBeNull();
  expect(read.loginNotice).toBe("");
  expect(read.loginCardBlur).toBe(24);
  expect(read.loginCardOpacity).toBe(80);
  expect(read.loginCardSaturation).toBe(145);
  expect(read.loginCardGlow).toBe(65);
  expect(read.loginCardGlowTone).toBe("theme");
  expect(read.logoDarkAssetId).toBeNull();
});

test("可保存的主题值全覆盖，未知主题被拒绝", async () => {
  const themes = ["default", "brutalist", "soft-pop", "tangerine", "vercel", "claude", "t3-chat", "supabase", "mono"] as const;
  let revision = (await readSiteSettings()).revision;
  for (const themePreset of themes) {
    const saved = await saveSettings(sessionId, { ...defaultSettings, themePreset, revision, reason: `主题切换 ${themePreset}` });
    expect(saved.themePreset).toBe(themePreset);
    revision = saved.revision;
    expect((await readSiteSettings()).themePreset).toBe(themePreset);
  }
  await expect(
    saveSettings(sessionId, { ...defaultSettings, themePreset: "not-a-theme", revision, reason: "非法主题" }),
  ).rejects.toThrow();
  expect((await readSiteSettings()).themePreset).toBe("mono");
});

test("上传与证明设置可保存回读，证明类型不能全部关闭", async () => {
  const revision = (await readSiteSettings()).revision;
  const saved = await saveSettings(sessionId, {
    ...defaultSettings,
    evidenceMaxSizeMb: 8,
    evidenceAllowPdf: false,
    imageCompressionEnabled: false,
    imageCompressionQuality: 90,
    revision,
    reason: "上传与证明设置验证",
  });
  expect(saved.evidenceMaxSizeMb).toBe(8);
  expect(saved.evidenceAllowImage).toBe(true);
  expect(saved.evidenceAllowPdf).toBe(false);
  expect(saved.imageCompressionEnabled).toBe(false);
  expect(saved.imageCompressionQuality).toBe(90);
  const read = await readSiteSettings();
  expect(read.evidenceMaxSizeMb).toBe(8);
  expect(read.evidenceAllowPdf).toBe(false);
  expect(read.imageCompressionQuality).toBe(90);
  await expect(
    saveSettings(sessionId, { ...defaultSettings, evidenceAllowImage: false, evidenceAllowPdf: false, revision: saved.revision, reason: "证明类型全关" }),
  ).rejects.toThrow("证明类型不能全部关闭");
  await expect(
    saveSettings(sessionId, { ...defaultSettings, evidenceMaxSizeMb: 51, revision: saved.revision, reason: "证明上限超范围" }),
  ).rejects.toThrow();
  await expect(
    saveSettings(sessionId, { ...defaultSettings, imageCompressionQuality: 49, revision: saved.revision, reason: "压缩质量超范围" }),
  ).rejects.toThrow();
});
