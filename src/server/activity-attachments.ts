import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { getCurrentSession } from "@/server/auth";
import { AccountError } from "@/server/accounts";
import { readSiteSettings } from "@/server/settings";
import { canManageActivity } from "@/server/activity-policy";

export const attachmentRoot = () =>
	resolve(/* turbopackIgnore: true */ process.env.ACTIVITY_ATTACHMENT_DIR ?? ".local/activity-attachments");

const mimeByExtension: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	webp: "image/webp",
	gif: "image/gif",
	pdf: "application/pdf",
	doc: "application/msword",
	docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	xls: "application/vnd.ms-excel",
	xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	ppt: "application/vnd.ms-powerpoint",
	pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	zip: "application/zip",
	txt: "text/plain",
	md: "text/markdown",
};

function isZip(bytes: Buffer) {
	return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && [3, 5, 7].includes(bytes[2]) && [4, 6, 8].includes(bytes[3]);
}
function isOle(bytes: Buffer) {
	return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
}
function isText(bytes: Buffer) {
	if (bytes.includes(0)) return false;
	try {
		new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		return true;
	} catch {
		return false;
	}
}
function identify(extension: string, bytes: Buffer): string | null {
	const expected = mimeByExtension[extension];
	if (!expected) return null;
	if (extension === "png") {
		const valid = bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.subarray(12, 16).toString() === "IHDR";
		return valid ? expected : null;
	}
	if (extension === "jpg" || extension === "jpeg") {
		return bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217 ? expected : null;
	}
	if (extension === "gif") {
		const header = bytes.subarray(0, 6).toString();
		return header === "GIF87a" || header === "GIF89a" ? expected : null;
	}
	if (extension === "webp") {
		return bytes.length >= 12 && bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP" ? expected : null;
	}
	if (extension === "pdf") {
		return bytes.subarray(0, 5).toString() === "%PDF-" ? expected : null;
	}
	if (extension === "doc") return isOle(bytes) ? expected : null;
	if (["docx", "xlsx", "pptx", "zip"].includes(extension)) return isZip(bytes) ? expected : null;
	if (extension === "txt" || extension === "md") return isText(bytes) ? expected : null;
	return null;
}
function safeName(name: string) {
	const base = name.replace(/[\\/\x00-\x1f]/g, "_").trim().slice(0, 120);
	return base || "附件";
}
export type AttachmentView = { id: string; name: string; mime: string; size: number; kind: string; createdAt: Date; url: string };
export function attachmentView(row: { id: string; name: string; mime: string; size: number; kind: string; createdAt: Date }): AttachmentView {
	return { ...row, url: `/api/activity-attachments/${row.id}` };
}
export async function attachmentLimits() {
	const settings = await readSiteSettings();
	return {
		maxFiles: settings.activityAttachmentMaxFiles,
		maxBytes: settings.activityAttachmentMaxSizeMb * 1024 * 1024,
		maxSizeMb: settings.activityAttachmentMaxSizeMb,
		allowed: settings.activityAttachmentAllowedExtensions,
	};
}
export async function uploadActivityAttachment(sessionId: string, rawName: string, bytes: Buffer, activityId?: string) {
	const current = await getCurrentSession(sessionId);
	if (!current || current.user.mustChangePassword) throw new AccountError("请重新登录", 401);
	if (!["ADMIN", "COLLEGE", "PUBLISHER"].includes(current.user.role)) throw new AccountError("没有上传活动附件的权限", 403);
	const limits = await attachmentLimits();
	if (!bytes.length) throw new AccountError("请选择附件");
	if (bytes.length > limits.maxBytes) throw new AccountError(`单个附件不能超过 ${limits.maxSizeMb}MB`);
	const name = safeName(rawName);
	const extension = extname(name).slice(1).toLowerCase();
	if (!limits.allowed.includes(extension)) throw new AccountError(`不支持 ${extension ? `.${extension}` : "无后缀"} 文件，请上传：${limits.allowed.join("、")}`);
	const mime = identify(extension, bytes);
	if (!mime) throw new AccountError("文件内容与后缀不匹配，或文件已损坏");
	if (activityId) {
		const activity = await db.activity.findUnique({ where: { id: activityId } });
		if (!activity) throw new AccountError("活动不存在", 404);
		if (!canManageActivity(activity, current.user)) throw new AccountError("没有维护该活动的权限", 403);
	}
	const since = new Date(Date.now() - 86400_000);
	const used = await db.activityAttachment.count({ where: activityId ? { activityId } : { uploaderId: current.userId, activityId: null, createdAt: { gt: since } } });
	if (used >= limits.maxFiles) throw new AccountError(`每个活动最多 ${limits.maxFiles} 个附件`);
	const storageKey = `${randomBytes(24).toString("hex")}.${extension}`;
	await mkdir(attachmentRoot(), { recursive: true });
	const path = join(/* turbopackIgnore: true */ attachmentRoot(), storageKey);
	await writeFile(path, bytes, { flag: "wx" });
	try {
		const saved = await db.activityAttachment.create({
			data: { activityId: activityId || null, uploaderId: current.userId, name, mime, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), storageKey, kind: mime.startsWith("image/") ? "IMAGE" : "FILE" },
			select: { id: true, name: true, mime: true, size: true, kind: true, createdAt: true },
		});
		return attachmentView(saved);
	} catch (error) {
		await unlink(path).catch(() => {});
		throw error;
	}
}
export async function listActivityAttachments(tx: Prisma.TransactionClient, activityId: string) {
	const rows = await tx.activityAttachment.findMany({ where: { activityId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, name: true, mime: true, size: true, kind: true, createdAt: true } });
	return rows.map(attachmentView);
}
export async function bindActivityAttachments(tx: Prisma.TransactionClient, activityId: string, uploaderId: string, ids: string[]) {
	const unique = [...new Set(ids)];
	if (!unique.length) return;
	const rows = await tx.activityAttachment.findMany({ where: { id: { in: unique } }, select: { id: true, activityId: true, uploaderId: true } });
	if (rows.length !== unique.length) throw new AccountError("附件不存在，请重新上传", 409);
	for (const row of rows) {
		if (row.activityId && row.activityId !== activityId) throw new AccountError("附件已被其他活动使用", 409);
		if (row.uploaderId !== uploaderId && row.activityId !== activityId) throw new AccountError("不能引用他人上传的附件", 403);
	}
	const limits = await attachmentLimits();
	const alreadyBound = rows.filter((row) => row.activityId === activityId).length;
	const toBind = rows.filter((row) => !row.activityId).map((row) => row.id);
	const bound = await tx.activityAttachment.count({ where: { activityId, id: { notIn: unique } } });
	if (bound + alreadyBound + toBind.length > limits.maxFiles) throw new AccountError(`每个活动最多 ${limits.maxFiles} 个附件`);
	if (toBind.length) await tx.activityAttachment.updateMany({ where: { id: { in: toBind }, uploaderId }, data: { activityId } });
}
export async function downloadActivityAttachment(sessionId: string, id: string) {
	const current = await getCurrentSession(sessionId);
	if (!current || current.user.mustChangePassword) throw new AccountError("请重新登录", 401);
	const file = await db.activityAttachment.findUnique({ where: { id } });
	if (!file) throw new AccountError("附件不存在", 404);
	if (file.activityId) {
		const { getActivity } = await import("@/server/activities");
		await getActivity(sessionId, file.activityId);
	} else if (file.uploaderId !== current.userId && current.user.role !== "ADMIN") throw new AccountError("附件不存在", 404);
	if (!/^[a-f0-9]{48}\.[a-z0-9]{1,10}$/.test(file.storageKey)) throw new AccountError("附件存储标识无效", 500);
	const bytes = await readFile(/* turbopackIgnore: true */ join(/* turbopackIgnore: true */ attachmentRoot(), file.storageKey));
	if (createHash("sha256").update(bytes).digest("hex") !== file.sha256) throw new AccountError("附件校验失败", 500);
	return { file, bytes };
}
export async function deleteActivityAttachment(sessionId: string, id: string) {
	const current = await getCurrentSession(sessionId);
	if (!current || current.user.mustChangePassword) throw new AccountError("请重新登录", 401);
	const file = await db.activityAttachment.findUnique({ where: { id } });
	if (!file) throw new AccountError("附件不存在", 404);
	let allowed = current.user.role === "ADMIN" || file.uploaderId === current.userId;
	if (!allowed && file.activityId) {
		const activity = await db.activity.findUnique({ where: { id: file.activityId } });
		allowed = !!activity && canManageActivity(activity, current.user);
	}
	if (!allowed) throw new AccountError("没有删除该附件的权限", 403);
	await db.activityAttachment.delete({ where: { id } });
	await unlink(/* turbopackIgnore: true */ join(/* turbopackIgnore: true */ attachmentRoot(), file.storageKey)).catch(() => {});
}
