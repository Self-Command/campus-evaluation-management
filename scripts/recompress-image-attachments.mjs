#!/usr/bin/env node
// 存量活动附件图片一次性回填压缩，与应用内 uploadActivityAttachment 的压缩参数保持一致。
// 默认 dry-run 只输出清单；--apply 才写库并替换文件。在应用容器内执行：
//   docker cp scripts/recompress-image-attachments.mjs <app容器>:/app/
//   docker exec -w /app <app容器> node recompress-image-attachments.mjs --dry-run
//   docker exec -w /app <app容器> node recompress-image-attachments.mjs --apply
import { randomBytes, createHash } from "node:crypto";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sharp = require("sharp");
const { Client } = require("pg");

sharp.cache(false);
sharp.concurrency(1);

const MAX_EDGE = 1920;
const BYTES_THRESHOLD = 300 * 1024;
const QUALITY = 80;
const NORMALIZABLE = new Set([
	"image/jpeg",
	"image/png",
	"image/webp",
	"image/avif",
	"image/tiff",
]);
const apply = process.argv.includes("--apply");
const root = resolve(process.env.ACTIVITY_ATTACHMENT_DIR ?? ".local/activity-attachments");

if (!process.env.DATABASE_URL) {
	console.error("缺少 DATABASE_URL，请在应用容器内运行。");
	process.exit(1);
}

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const { rows } = await client.query(
	`SELECT id, name, mime, size, "storageKey" FROM "ActivityAttachment" WHERE kind = 'IMAGE' ORDER BY "createdAt" ASC`,
);

const candidates = [];
let skipped = 0;
let failed = 0;
for (const row of rows) {
	if (!NORMALIZABLE.has(row.mime)) {
		skipped += 1;
		continue;
	}
	const path = join(root, row.storageKey);
	let bytes;
	try {
		bytes = await readFile(path);
	} catch {
		console.warn(`[跳过] 文件缺失 ${row.id} ${row.name}`);
		failed += 1;
		continue;
	}
	if (bytes.length !== row.size) {
		console.warn(`[跳过] 大小与记录不符 ${row.id} ${row.name}`);
		failed += 1;
		continue;
	}
	try {
		const metadata = await sharp(bytes).metadata();
		if ((metadata.pages ?? 1) > 1 || !metadata.width || !metadata.height) {
			skipped += 1;
			continue;
		}
		const oversized = metadata.width > MAX_EDGE || metadata.height > MAX_EDGE;
		if (!oversized && bytes.length <= BYTES_THRESHOLD) {
			skipped += 1;
			continue;
		}
		const output = await sharp(bytes)
			.rotate()
			.resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
			.webp({ quality: QUALITY })
			.timeout({ seconds: 10 })
			.toBuffer();
		if (output.length >= bytes.length) {
			skipped += 1;
			continue;
		}
		candidates.push({ row, bytes, output });
	} catch (error) {
		console.warn(`[跳过] 无法解码 ${row.id} ${row.name}: ${error.message}`);
		skipped += 1;
	}
}

if (!candidates.length) {
	console.log(`扫描 ${rows.length} 张图片附件：无可压缩项（跳过 ${skipped}，异常 ${failed}）。`);
	await client.end();
	process.exit(0);
}

console.log(`扫描 ${rows.length} 张图片附件：可压缩 ${candidates.length} 张，跳过 ${skipped}，异常 ${failed}。`);
let totalBefore = 0;
let totalAfter = 0;
for (const { row, bytes, output } of candidates) {
	totalBefore += bytes.length;
	totalAfter += output.length;
	console.log(
		`  ${apply ? "压缩" : "将压缩"} ${row.name} (${row.id}) ${(bytes.length / 1024).toFixed(0)}KB -> ${(output.length / 1024).toFixed(0)}KB (${Math.round((output.length / bytes.length) * 100)}%)`,
	);
}
console.log(`合计 ${(totalBefore / 1024).toFixed(0)}KB -> ${(totalAfter / 1024).toFixed(0)}KB (${Math.round((totalAfter / totalBefore) * 100)}%)`);

if (!apply) {
	console.log("dry-run 结束，未写入任何数据。确认后加 --apply 执行。");
	await client.end();
	process.exit(0);
}

let done = 0;
for (const { row, output } of candidates) {
	const oldPath = join(root, row.storageKey);
	const newKey = `${randomBytes(24).toString("hex")}.webp`;
	const newPath = join(root, newKey);
	const sha256 = createHash("sha256").update(output).digest("hex");
	try {
		await writeFile(newPath, output, { flag: "wx" });
		await client.query("BEGIN");
		await client.query(
			`UPDATE "ActivityAttachment" SET mime = 'image/webp', size = $1, "sha256" = $2, "storageKey" = $3 WHERE id = $4`,
			[output.length, sha256, newKey, row.id],
		);
		await client.query(
			`INSERT INTO "AuditEvent" (id, "actorName", action, category, "targetType", "targetId", "targetLabel", details)
			 VALUES ($1, 'system', 'ACTIVITY_ATTACHMENT_RECOMPRESSED', 'ACTIVITY', 'ActivityAttachment', $2, $3, $4)`,
			[
				`recompress_${randomBytes(12).toString("hex")}`,
				row.id,
				row.name,
				JSON.stringify({
					originalMime: row.mime,
					originalSize: row.size,
					mime: "image/webp",
					size: output.length,
					sha256,
				}),
			],
		);
		await client.query("COMMIT");
		await unlink(oldPath).catch(() => {});
		done += 1;
	} catch (error) {
		await client.query("ROLLBACK").catch(() => {});
		await unlink(newPath).catch(() => {});
		console.error(`[失败] ${row.id} ${row.name}: ${error.message}`);
	}
}
console.log(`完成：成功压缩 ${done}/${candidates.length} 张。`);
await client.end();
