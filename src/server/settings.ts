import { createHash } from "node:crypto";
import { z } from "zod";
import { db } from "@/server/db";
import { adminTransaction, AccountError } from "@/server/accounts";
import { getCurrentSession } from "@/server/auth";
import { jsonValue } from "@/server/claims";
import { settingsSchema, storedSettingsSchema, defaultSettings } from "@/lib/settings-schema";

export { settingsSchema, defaultSettings } from "@/lib/settings-schema";
export async function publicSettings() {
  // CI and container builds have no database; every business page renders at request time.
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return { ...defaultSettings, revision: 0, updatedAt: null };
  }
  const saved = await db.siteSettings.findUnique({ where: { id: "site" } });
  return { ...(saved ? storedSettingsSchema.parse(saved.content) : defaultSettings), revision: saved?.revision ?? 0, updatedAt: saved?.updatedAt ?? null };
}
export async function readSettings(sessionId: string) {
  const current = await getCurrentSession(sessionId);
  if (!current || current.user.mustChangePassword) throw new AccountError("请重新登录", 401);
  if (current.user.role !== "ADMIN") throw new AccountError("没有管理权限", 403);
  return publicSettings();
}
export async function saveSettings(sessionId: string, input: unknown) {
  const { revision, reason, ...raw } = z.object({ ...settingsSchema.shape, revision: z.number().int().nonnegative(), reason: z.string().trim().min(2).max(500) }).strict().parse(input);
  const content = settingsSchema.parse(raw);
  return adminTransaction(sessionId, async (tx, actorId) => {
    const previous = await tx.siteSettings.findUnique({ where: { id: "site" } });
    if ((previous?.revision ?? 0) !== revision) throw new AccountError("系统设置已变化，请刷新后核对", 409);
    const assetIds = [...new Set([content.logoAssetId, content.faviconAssetId].filter((i): i is string => !!i))];
    if (await tx.brandAsset.count({ where: { id: { in: assetIds } } }) !== assetIds.length) throw new AccountError("品牌图片不存在，请重新上传");
    const saved = await tx.siteSettings.upsert({ where: { id: "site" }, create: { content: jsonValue(content), revision: 1 }, update: { content: jsonValue(content), revision: { increment: 1 } } });
    const oldPolicy = previous ? storedSettingsSchema.parse(previous.content) : defaultSettings;
    if (oldPolicy.loginFailureLimitEnabled !== content.loginFailureLimitEnabled || oldPolicy.loginFailureMaxAttempts !== content.loginFailureMaxAttempts || oldPolicy.loginFailureLockMinutes !== content.loginFailureLockMinutes) await tx.loginFailureState.deleteMany();
    await tx.auditEvent.create({ data: { actorId, action: "SETTINGS_CHANGED", targetId: "site", details: { reason, before: previous?.content ?? defaultSettings, after: content, revision: saved.revision } } });
    return { ...content, revision: saved.revision, updatedAt: saved.updatedAt };
  });
}
export async function uploadBrandAsset(sessionId: string, bytes: Buffer) {
  if (!bytes.length || bytes.length > 1024 * 1024) throw new AccountError("品牌图片须在1MB以内");
  let mime = "";
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.subarray(12, 16).toString() === "IHDR") {
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    if (!width || !height || width > 4096 || height > 4096) throw new AccountError("图片尺寸须在4096×4096以内");
    mime = "image/png";
  } else if (bytes[0] === 255 && bytes[1] === 216 && bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217) mime = "image/jpeg";
  else if (bytes.length >= 22 && bytes.readUInt16LE(0) === 0 && bytes.readUInt16LE(2) === 1 && bytes.readUInt16LE(4) > 0 && bytes.readUInt16LE(4) <= 64 && bytes.length >= 6 + bytes.readUInt16LE(4) * 16) mime = "image/x-icon";
  else throw new AccountError("仅支持可识别的PNG、JPEG或ICO图片");
  return adminTransaction(sessionId, async (tx, actorId) => {
    if (await tx.brandAsset.count() >= 200) throw new AccountError("品牌图片数量已达上限，请复用已上传的图片", 409);
    const asset = await tx.brandAsset.create({ data: { mime, size: bytes.length, bytes: new Uint8Array(bytes), sha256: createHash("sha256").update(bytes).digest("hex") }, select: { id: true, mime: true, size: true } });
    await tx.auditEvent.create({ data: { actorId, action: "BRAND_ASSET_UPLOADED", targetId: asset.id, details: { mime, size: bytes.length } } });
    return asset;
  });
}
export async function getBrandAsset(id: string, sessionId?: string) {
  const settings = await publicSettings();
  if (![settings.logoAssetId, settings.faviconAssetId].includes(id)) {
    const current = sessionId ? await getCurrentSession(sessionId) : null;
    if (!current || current.user.mustChangePassword || current.user.role !== "ADMIN") throw new AccountError("图片不存在", 404);
  }
  const asset = await db.brandAsset.findUnique({ where: { id } });
  if (!asset) throw new AccountError("图片不存在", 404);
  if (createHash("sha256").update(asset.bytes).digest("hex") !== asset.sha256) throw new AccountError("图片校验失败", 500);
  return asset;
}
