import { createHash } from "node:crypto";
import { z } from "zod";
import { db } from "@/server/db";
import { adminTransaction, AccountError } from "@/server/accounts";
import { getCurrentSession } from "@/server/auth";
import { jsonValue } from "@/server/claims";
import { settingsSchema, storedSettingsSchema, defaultSettings } from "@/lib/settings-schema";

export { settingsSchema, defaultSettings } from "@/lib/settings-schema";

export type BrandAssetKind = "brand" | "login-background";

const loginBackgroundMimes = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function readSiteSettings() {
  // CI and container builds have no database; every business page renders at request time.
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return { ...defaultSettings, revision: 0, updatedAt: null };
  }
  const saved = await db.siteSettings.findUnique({ where: { id: "site" } });
  return { ...(saved ? storedSettingsSchema.parse(saved.content) : defaultSettings), revision: saved?.revision ?? 0, updatedAt: saved?.updatedAt ?? null };
}

// Anything reachable without a session goes through this explicit projection.
// Login policy, attachment policy, revisions and audit data never leak here.
export async function publicSettings() {
  const settings = await readSiteSettings();
  return {
    siteName: settings.siteName,
    siteDescription: settings.siteDescription,
    pageTitle: settings.pageTitle,
    themePreset: settings.themePreset,
    defaultThemeMode: settings.defaultThemeMode,
    logoAssetId: settings.logoAssetId,
    logoSize: settings.logoSize,
    faviconAssetId: settings.faviconAssetId,
    loginBackgroundAssetId: settings.loginBackgroundAssetId,
    loginNotice: settings.loginNotice,
  };
}

export async function readSettings(sessionId: string) {
  const current = await getCurrentSession(sessionId);
  if (!current || current.user.mustChangePassword) throw new AccountError("请重新登录", 401);
  if (current.user.role !== "ADMIN") throw new AccountError("没有管理权限", 403);
  return readSiteSettings();
}

export async function saveSettings(sessionId: string, input: unknown) {
  const { revision, reason, ...raw } = z.object({ ...settingsSchema.shape, revision: z.number().int().nonnegative(), reason: z.string().trim().min(2).max(500) }).strict().parse(input);
  const content = settingsSchema.parse(raw);
  return adminTransaction(sessionId, async (tx, actorId) => {
    const previous = await tx.siteSettings.findUnique({ where: { id: "site" } });
    if ((previous?.revision ?? 0) !== revision) throw new AccountError("系统设置已变化，请刷新后核对", 409);
    const assetIds = [...new Set([content.logoAssetId, content.faviconAssetId, content.loginBackgroundAssetId].filter((i): i is string => !!i))];
    const assets = await tx.brandAsset.findMany({ where: { id: { in: assetIds } }, select: { id: true, mime: true } });
    if (assets.length !== assetIds.length) throw new AccountError("品牌图片不存在，请重新上传");
    if (content.loginBackgroundAssetId) {
      const background = assets.find(asset => asset.id === content.loginBackgroundAssetId);
      if (!background || !loginBackgroundMimes.has(background.mime)) throw new AccountError("登录页背景须为PNG、JPEG或WebP图片");
    }
    const saved = await tx.siteSettings.upsert({ where: { id: "site" }, create: { content: jsonValue(content), revision: 1 }, update: { content: jsonValue(content), revision: { increment: 1 } } });
    const oldPolicy = previous ? storedSettingsSchema.parse(previous.content) : defaultSettings;
    if (oldPolicy.loginFailureLimitEnabled !== content.loginFailureLimitEnabled || oldPolicy.loginFailureMaxAttempts !== content.loginFailureMaxAttempts || oldPolicy.loginFailureLockMinutes !== content.loginFailureLockMinutes) await tx.loginFailureState.deleteMany();
    await tx.auditEvent.create({ data: { actorId, action: "SETTINGS_CHANGED", targetId: "site", details: { reason, before: previous?.content ?? defaultSettings, after: content, revision: saved.revision } } });
    return { ...content, revision: saved.revision, updatedAt: saved.updatedAt };
  });
}

type RasterImage = { mime: string; width: number; height: number };

function pngDimensions(bytes: Buffer): RasterImage | null {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.subarray(12, 16).toString() !== "IHDR") return null;
  return { mime: "image/png", width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function jpegDimensions(bytes: Buffer): RasterImage | null {
  if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[bytes.length - 2] !== 255 || bytes[bytes.length - 1] !== 217) return null;
  const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 255) { offset += 1; continue; }
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0xff) { offset += marker === 0xff ? 1 : 2; continue; }
    if (marker === 0xda || marker === 0xd9) return null;
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2) return null;
    if (startOfFrame.has(marker) && offset + 8 < bytes.length) return { mime: "image/jpeg", height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    offset += 2 + length;
  }
  return null;
}

function webpDimensions(bytes: Buffer): RasterImage | null {
  if (bytes.length < 30 || bytes.subarray(0, 4).toString() !== "RIFF" || bytes.subarray(8, 12).toString() !== "WEBP") return null;
  const chunk = bytes.subarray(12, 16).toString();
  if (chunk === "VP8X") return { mime: "image/webp", width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
  if (chunk === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) return { mime: "image/webp", width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  if (chunk === "VP8L" && bytes[20] === 0x2f) {
    const b1 = bytes[21], b2 = bytes[22], b3 = bytes[23], b4 = bytes[24];
    return { mime: "image/webp", width: 1 + (((b2 & 0x3f) << 8) | b1), height: 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6)) };
  }
  return null;
}

function iconDimensions(bytes: Buffer): RasterImage | null {
  if (bytes.length < 22 || bytes.readUInt16LE(0) !== 0 || bytes.readUInt16LE(2) !== 1) return null;
  const count = bytes.readUInt16LE(4);
  if (!count || count > 64 || bytes.length < 6 + count * 16) return null;
  return { mime: "image/x-icon", width: bytes[6] || 256, height: bytes[7] || 256 };
}

function readRasterImage(bytes: Buffer): RasterImage | null {
  return pngDimensions(bytes) ?? jpegDimensions(bytes) ?? webpDimensions(bytes);
}

export async function uploadBrandAsset(sessionId: string, bytes: Buffer, kind: BrandAssetKind = "brand") {
  const maxBytes = kind === "login-background" ? 5 * 1024 * 1024 : 1024 * 1024;
  if (!bytes.length || bytes.length > maxBytes) throw new AccountError(kind === "login-background" ? "登录页背景须在5MB以内" : "品牌图片须在1MB以内");
  const image = readRasterImage(bytes) ?? (kind === "brand" ? iconDimensions(bytes) : null);
  if (!image) throw new AccountError(kind === "login-background" ? "仅支持可识别的PNG、JPEG或WebP图片" : "仅支持可识别的PNG、JPEG或ICO图片");
  if (kind === "login-background" && !loginBackgroundMimes.has(image.mime)) throw new AccountError("登录页背景仅支持PNG、JPEG或WebP图片");
  if (kind === "brand" && image.mime === "image/webp") throw new AccountError("站点标识仅支持PNG、JPEG或ICO图片");
  if (!image.width || !image.height) throw new AccountError("无法读取图片尺寸");
  const maxEdge = kind === "login-background" ? 8192 : 4096;
  if (image.width > maxEdge || image.height > maxEdge) throw new AccountError(`图片尺寸须在${maxEdge}×${maxEdge}以内`);
  const { mime } = image;
  return adminTransaction(sessionId, async (tx, actorId) => {
    if (await tx.brandAsset.count() >= 200) throw new AccountError("品牌图片数量已达上限，请复用已上传的图片", 409);
    const asset = await tx.brandAsset.create({ data: { mime, size: bytes.length, bytes: new Uint8Array(bytes), sha256: createHash("sha256").update(bytes).digest("hex") }, select: { id: true, mime: true, size: true } });
    await tx.auditEvent.create({ data: { actorId, action: "BRAND_ASSET_UPLOADED", targetId: asset.id, details: { kind, mime, size: bytes.length } } });
    return asset;
  });
}

export async function getBrandAsset(id: string, sessionId?: string) {
  const settings = await readSiteSettings();
  if (![settings.logoAssetId, settings.faviconAssetId, settings.loginBackgroundAssetId].includes(id)) {
    const current = sessionId ? await getCurrentSession(sessionId) : null;
    if (!current || current.user.mustChangePassword || current.user.role !== "ADMIN") throw new AccountError("图片不存在", 404);
  }
  const asset = await db.brandAsset.findUnique({ where: { id } });
  if (!asset) throw new AccountError("图片不存在", 404);
  if (createHash("sha256").update(asset.bytes).digest("hex") !== asset.sha256) throw new AccountError("图片校验失败", 500);
  return asset;
}
