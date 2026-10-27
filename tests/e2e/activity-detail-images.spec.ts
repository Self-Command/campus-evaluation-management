import "dotenv/config";
import { test, expect } from "@playwright/test";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { hash } from "bcryptjs";
import sharp from "sharp";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client";
import { login } from "./login";

const db = new PrismaClient({
	adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
const prefix = `e2e-image-${randomBytes(4).toString("hex")}`;
const password = `Pw!${randomBytes(6).toString("hex")}`;
const activityName = `${prefix} 图片加载`;
const png = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=",
	"base64",
);
const attachmentDir = resolve(
	process.env.ACTIVITY_ATTACHMENT_DIR ?? ".local/activity-attachments",
);
const storageKey = `${randomBytes(24).toString("hex")}.png`;
const ids = {
	college: "",
	major: "",
	schoolClass: "",
	collegeUser: "",
	student: "",
	activity: "",
	term: "",
	attachment: "",
};
let missingId = "";

test.beforeAll(async () => {
	let term: { id: string; scheme: unknown } | null = null;
	let node: { id: string; kind: string } | undefined;
	const terms = await db.term.findMany({
		where: { disposition: "NORMAL" },
		orderBy: [{ phase: "asc" }, { createdAt: "desc" }],
	});
	for (const candidate of terms) {
		const scheme = candidate.scheme as { nodes?: { id: string; kind: string }[] };
		const found = scheme.nodes?.find((item) => item.kind === "ACTIVITY");
		if (found) {
			term = candidate;
			node = found;
			break;
		}
	}
	if (!term || !node) return;
	ids.term = term.id;
	const college = await db.college.create({
		data: { code: prefix, name: `${prefix} 测试学院` },
	});
	ids.college = college.id;
	const major = await db.major.create({
		data: { code: "M", name: `${prefix} 测试专业`, collegeId: college.id },
	});
	ids.major = major.id;
	const schoolClass = await db.schoolClass.create({
		data: { code: "C", name: `${prefix} 测试班级`, majorId: major.id },
	});
	ids.schoolClass = schoolClass.id;
	const collegeUser = await db.user.create({
		data: {
			login: `${prefix}-college`,
			name: "图片测试学院管理员",
			role: "COLLEGE",
			collegeId: college.id,
			passwordHash: await hash(password, 10),
			mustChangePassword: false,
		},
	});
	ids.collegeUser = collegeUser.id;
	const student = await db.user.create({
		data: {
			login: `${prefix}-student`,
			name: "图片测试学生",
			role: "STUDENT",
			passwordHash: await hash(password, 10),
			mustChangePassword: false,
			studentProfile: {
				create: {
					studentNumber: `${prefix}-student`,
					college: college.name,
					major: major.name,
					className: schoolClass.name,
					classId: schoolClass.id,
				},
			},
		},
	});
	ids.student = student.id;
	const activity = await db.activity.create({
		data: {
			termId: term.id,
			ownerId: collegeUser.id,
			collegeId: college.id,
			name: activityName,
			organizer: college.name,
			content: "图片加载验证。\n\n![示例图片](/api/activity-attachments/attachment-placeholder)\n\n![已删除图片](/api/activity-attachments/deleted-placeholder)",
			startsAt: new Date(Date.now() - 172_800_000),
			endsAt: new Date(Date.now() + 172_800_000),
			nodeId: node.id,
			points: "2",
			confirmed: true,
			publishedAt: new Date(Date.now() - 172_800_000),
			publishRevision: 1,
			audienceScope: "CLASS",
			audienceColleges: [],
			audienceClasses: [
				JSON.stringify([college.name, major.name, schoolClass.name]),
			],
		},
	});
	ids.activity = activity.id;
	await mkdir(attachmentDir, { recursive: true });
	await writeFile(join(attachmentDir, storageKey), png);
	const attachment = await db.activityAttachment.create({
		data: {
			activityId: activity.id,
			uploaderId: collegeUser.id,
			name: "示例图片.png",
			mime: "image/png",
			size: png.length,
			sha256: createHash("sha256").update(png).digest("hex"),
			storageKey,
			kind: "IMAGE",
		},
	});
	ids.attachment = attachment.id;
	missingId = `${prefix}-missing`;
	await db.activity.update({
		where: { id: activity.id },
		data: {
			content: `图片加载验证。\n\n![示例图片](/api/activity-attachments/${attachment.id})\n\n![已删除图片](/api/activity-attachments/${missingId})`,
		},
	});
});

test.afterAll(async () => {
	if (ids.activity) {
		await db.auditEvent.deleteMany({ where: { targetId: ids.activity } });
		await db.activityAttachment.deleteMany({ where: { activityId: ids.activity } });
		await db.activity.deleteMany({ where: { id: ids.activity } });
	}
	await unlink(join(attachmentDir, storageKey)).catch(() => {});
	const userIds = [ids.collegeUser, ids.student].filter(Boolean);
	if (userIds.length) {
		await db.authSession.deleteMany({ where: { userId: { in: userIds } } });
		await db.auditEvent.deleteMany({ where: { actorId: { in: userIds } } });
		await db.user.deleteMany({ where: { id: { in: userIds } } });
	}
	if (ids.schoolClass)
		await db.schoolClass.deleteMany({ where: { id: ids.schoolClass } });
	if (ids.major) await db.major.deleteMany({ where: { id: ids.major } });
	if (ids.college) await db.college.deleteMany({ where: { id: ids.college } });
	await db.$disconnect();
});

test("活动详情单页签无标题线，图片可缓存、可区分缺失并给出恢复操作", async ({
	browser,
}) => {
	test.skip(!ids.activity, "当前没有可用的进行中测评周期");
	test.setTimeout(180_000);
	const context = await browser.newContext();
	const page = await context.newPage();
	await page.setViewportSize({ width: 1440, height: 900 });
	await login(page, `${prefix}-student`, password);
	await page.goto(`/activities/${ids.activity}?termId=${ids.term}`, {
		waitUntil: "networkidle",
	});

	await expect(page.getByRole("heading", { name: activityName })).toBeVisible();
	await expect(page.getByRole("tablist")).toHaveCount(0);
	await expect(page.getByText("活动详情", { exact: true })).toHaveCount(0);
	await expect(page.getByRole("heading", { name: "活动介绍" })).toBeVisible();

	const loaded = page.getByAltText("示例图片");
	await expect(loaded).toBeVisible();
	await expect
		.poll(() => loaded.evaluate((image) => (image as HTMLImageElement).naturalWidth))
		.toBeGreaterThan(0);

	await expect(page.getByText("图片未能显示")).toBeVisible({ timeout: 30_000 });
	await expect(page.getByText("图片已被删除，或你没有查看权限。")).toBeVisible();
	await expect(page.getByRole("button", { name: "再次加载" })).toHaveCount(0);
	await expect(page.getByRole("link", { name: "查看原图" })).toHaveCount(0);

	const url = `/api/activity-attachments/${ids.attachment}`;
	const first = await context.request.get(url);
	expect(first.status()).toBe(200);
	expect(first.headers()["cache-control"]).toBe("private, max-age=300");
	expect(first.headers().vary).toContain("Cookie");
	const etag = first.headers().etag;
	expect(etag).toBe(
		`"${createHash("sha256").update(png).digest("hex")}"`,
	);
	expect(first.headers()["content-length"]).toBe(String(png.length));

	const revalidated = await context.request.get(url, {
		headers: { "If-None-Match": etag },
	});
	expect(revalidated.status()).toBe(304);
	const head = await context.request.fetch(url, { method: "HEAD" });
	expect(head.status()).toBe(200);
	expect(head.headers().etag).toBe(etag);

	await page.screenshot({
		path: "test-results/activity-detail-images-1440.png",
		fullPage: true,
	});
	await context.close();
});

test("多个可见页签时保留页签栏并可切换", async ({ browser }) => {
	test.skip(!ids.activity, "当前没有可用的测评周期");
	test.setTimeout(120_000);
	const context = await browser.newContext();
	const page = await context.newPage();
	await page.setViewportSize({ width: 1440, height: 900 });
	await login(page, `${prefix}-college`, password);
	await page.goto(`/activities/${ids.activity}?termId=${ids.term}`, {
		waitUntil: "networkidle",
	});
	await expect(page.getByRole("tablist")).toBeVisible();
	await page.getByRole("tab", { name: "参与名单" }).click();
	await expect(page.getByText("活动参与名单")).toBeVisible();
	await page.getByRole("tab", { name: "活动证明" }).click();
	await expect(page.getByRole("heading", { name: "活动证明" })).toBeVisible();
	await context.close();
});

test("图片短暂断网时自动重试并恢复显示", async ({ browser }) => {
	test.skip(!ids.activity, "当前没有可用的测评周期");
	test.setTimeout(180_000);
	const context = await browser.newContext();
	const page = await context.newPage();
	await page.setViewportSize({ width: 1440, height: 900 });
	await login(page, `${prefix}-student`, password);
	let blocked = 0;
	await page.route(
		`**/api/activity-attachments/${ids.attachment}*`,
		async (route) => {
			const request = route.request();
			if (
				request.method() === "GET" &&
				request.resourceType() === "image" &&
				blocked < 2
			) {
				blocked += 1;
				await route.abort("connectionfailed");
				return;
			}
			await route.continue();
		},
	);
	await page.goto(`/activities/${ids.activity}?termId=${ids.term}`, {
		waitUntil: "networkidle",
	});
	const loaded = page.getByAltText("示例图片");
	await expect(loaded).toBeVisible({ timeout: 30_000 });
	await expect
		.poll(() => loaded.evaluate((image) => (image as HTMLImageElement).naturalWidth), {
			timeout: 30_000,
		})
		.toBeGreaterThan(0);
	expect(blocked).toBe(2);
	await context.close();
});

test("大图经上传接口自动压缩后学生端正常显示", async ({ browser }) => {
	test.skip(!ids.attachment, "当前没有可用的进行中测评周期");
	test.setTimeout(240_000);
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="1400"><rect width="2400" height="1400" fill="#eef2f7"/><rect x="0" y="0" width="2400" height="96" fill="#243247"/><rect x="64" y="160" width="640" height="420" rx="20" fill="#ffffff" stroke="#cfd8e3"/><rect x="752" y="160" width="900" height="420" rx="20" fill="#ffffff" stroke="#cfd8e3"/><circle cx="2150" cy="420" r="200" fill="#2563eb" opacity="0.9"/></svg>`;
	const base = await sharp(Buffer.from(svg)).png().toBuffer();
	let seed = 20261027;
	const noise = Buffer.alloc(720 * 460 * 3);
	for (let i = 0; i < noise.length; i += 1) {
		seed = (seed * 1103515245 + 12345) % 2147483648;
		noise[i] = (seed >> 16) & 0xff;
	}
	const bigPng = await sharp(base)
		.composite([
			{ input: noise, raw: { width: 720, height: 460, channels: 3 }, left: 1500, top: 860 },
		])
		.png()
		.toBuffer();
	expect(bigPng.length).toBeGreaterThan(300 * 1024);

	const context = await browser.newContext();
	const page = await context.newPage();
	await page.setViewportSize({ width: 1440, height: 900 });
	await login(page, `${prefix}-college`, password);
	const origin = new URL(process.env.E2E_BASE_URL ?? "http://localhost:3000").origin;
	const response = await context.request.post("/api/activity-attachments", {
		headers: {
			"x-file-name": encodeURIComponent("大图示例.png"),
			"x-activity-id": ids.activity,
			"content-type": "application/octet-stream",
			origin,
		},
		data: bigPng,
	});
	expect(response.status()).toBe(201);
	const uploaded = (await response.json()) as { id: string; mime: string; size: number };
	expect(uploaded.mime).toBe("image/webp");
	expect(uploaded.size).toBeLessThan(bigPng.length);

	const originalContent = `图片加载验证。\n\n![示例图片](/api/activity-attachments/${ids.attachment})\n\n![已删除图片](/api/activity-attachments/${missingId})`;
	await db.activity.update({
		where: { id: ids.activity },
		data: {
			content: `${originalContent}\n\n![大图示例](/api/activity-attachments/${uploaded.id})`,
		},
	});

	const studentContext = await browser.newContext();
	const studentPage = await studentContext.newPage();
	await studentPage.setViewportSize({ width: 1440, height: 900 });
	await login(studentPage, `${prefix}-student`, password);
	await studentPage.goto(`/activities/${ids.activity}?termId=${ids.term}`, {
		waitUntil: "domcontentloaded",
	});
	const big = studentPage.getByAltText("大图示例");
	await expect(big).toBeVisible({ timeout: 30_000 });
	await expect
		.poll(() => big.evaluate((image) => (image as HTMLImageElement).naturalWidth), {
			timeout: 30_000,
		})
		.toBeGreaterThan(0);
	await studentContext.close();

	await db.activity.update({ where: { id: ids.activity }, data: { content: originalContent } });
	const stored = await db.activityAttachment.findUniqueOrThrow({
		where: { id: uploaded.id },
		select: { storageKey: true },
	});
	await unlink(join(attachmentDir, stored.storageKey)).catch(() => {});
	await db.auditEvent.deleteMany({ where: { targetId: uploaded.id } });
	await db.activityAttachment.deleteMany({ where: { id: uploaded.id } });
	await context.close();
});
