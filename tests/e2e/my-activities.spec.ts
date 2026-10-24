import "dotenv/config";
import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { hash } from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client";
import { login } from "./login";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const prefix = `e2e-${randomBytes(4).toString("hex")}`;
const password = `Pw!${randomBytes(6).toString("hex")}`;
const ids = { college: "", major: "", schoolClass: "", collegeUser: "", student: "", activity: "", term: "" };
const activityName = `${prefix} 参与记录回归活动`;

async function cleanup() {
	if (ids.activity) {
		await db.recognitionSource.deleteMany({ where: { participation: { activityId: ids.activity } } });
		await db.participation.deleteMany({ where: { activityId: ids.activity } });
		await db.activityAttachment.deleteMany({ where: { activityId: ids.activity } });
		await db.auditEvent.deleteMany({ where: { targetId: ids.activity } });
		await db.activity.deleteMany({ where: { id: ids.activity } });
	}
	const userIds = [ids.collegeUser, ids.student].filter(Boolean);
	if (userIds.length) {
		await db.authSession.deleteMany({ where: { userId: { in: userIds } } });
		await db.auditEvent.deleteMany({ where: { actorId: { in: userIds } } });
		await db.user.deleteMany({ where: { id: { in: userIds } } });
	}
	if (ids.schoolClass) await db.schoolClass.deleteMany({ where: { id: ids.schoolClass } });
	if (ids.major) await db.major.deleteMany({ where: { id: ids.major } });
	if (ids.college) await db.college.deleteMany({ where: { id: ids.college } });
}

test.beforeAll(async () => {
	const term = await db.term.findFirst({
		where: { phase: "ACTIVE", disposition: "NORMAL" },
		orderBy: { createdAt: "desc" },
	});
	if (!term) return;
	const scheme = term.scheme as { nodes?: { id: string; kind: string }[] };
	const node = scheme.nodes?.find((item) => item.kind === "ACTIVITY");
	if (!node) return;
	ids.term = term.id;
	const college = await db.college.create({ data: { code: prefix, name: `${prefix} 测试学院` } });
	ids.college = college.id;
	const major = await db.major.create({ data: { code: "M", name: `${prefix} 测试专业`, collegeId: college.id } });
	ids.major = major.id;
	const schoolClass = await db.schoolClass.create({ data: { code: "C", name: `${prefix} 测试班级`, majorId: major.id } });
	ids.schoolClass = schoolClass.id;
	const collegeUser = await db.user.create({
		data: { login: `${prefix}-college`, name: "回归学院管理员", role: "COLLEGE", collegeId: college.id, passwordHash: await hash(password, 10), mustChangePassword: false },
	});
	ids.collegeUser = collegeUser.id;
	const student = await db.user.create({
		data: {
			login: `${prefix}-student`,
			name: "回归学生",
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
			content: "参与记录回归活动，用于验证我参加的活动入口。",
			startsAt: new Date(Date.now() - 172_800_000),
			endsAt: new Date(Date.now() - 86_400_000),
			nodeId: node.id,
			points: "6",
			confirmed: true,
			publishedAt: new Date(Date.now() - 172_800_000),
			publishRevision: 1,
			audienceScope: "CLASS",
			audienceColleges: [],
			audienceClasses: [JSON.stringify([college.name, major.name, schoolClass.name])],
		},
	});
	ids.activity = activity.id;
	const participation = await db.participation.create({
		data: {
			activityId: activity.id,
			studentId: student.id,
			registeredAt: new Date(),
			registeredBy: collegeUser.id,
		},
	});
	await db.recognitionSource.create({
		data: { participationId: participation.id, submitterId: collegeUser.id, status: "APPROVED", note: "学院统一登记" },
	});
});

test.afterAll(async () => {
	await cleanup();
	await db.$disconnect();
});

test("学生从工作台进入我参加的活动可看到记录、查看详情并返回原列表", async ({ page }) => {
	test.skip(!ids.activity, "当前没有可用的进行中测评周期");
	test.setTimeout(120_000);
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
	page.on("console", (message) => {
		if (message.type() === "error") errors.push(`console: ${message.text()}`);
	});
	page.on("response", (response) => {
		if (response.status() >= 400) errors.push(`http ${response.status()}: ${response.url()}`);
	});
	await page.setViewportSize({ width: 1440, height: 900 });
	await login(page, "学生", `${prefix}-student`, password);
	await expect(page).toHaveURL(/\/$/);
	await page.getByRole("link", { name: "我参加的活动" }).click();
	await expect(page).toHaveURL(/view=joined/);
	const tabs = page.getByRole("navigation", { name: "活动视图" });
	await expect(tabs.getByRole("link", { name: "我参加的活动" })).toHaveAttribute("aria-current", "page");
	await expect(page.getByText("共 1 个活动")).toBeVisible();
	await expect(page.getByRole("link", { name: activityName })).toBeVisible();
	const table = page.locator("table");
	await expect(table.getByText("已登记").first()).toBeVisible();
	await expect(table.getByText("已通过").first()).toBeVisible();
	await page.getByRole("textbox", { name: "搜索活动名称" }).fill("参与记录回归");
	await page.getByRole("button", { name: "搜索", exact: true }).click();
	await expect(page).toHaveURL(/view=joined/);
	await expect(page.getByRole("link", { name: activityName })).toBeVisible();
	// Playwright 默认截图会临时写入 caret-color，若与水合重叠会误报 React 水合不一致。
	await page.screenshot({ path: "test-results/my-activities-joined-1440.png", fullPage: true, caret: "initial" });
	await page.getByRole("link", { name: "查看活动" }).click();
	await expect(page).toHaveURL(new RegExp(`/activities/${ids.activity}`));
	await expect(page.getByRole("heading", { name: activityName })).toBeVisible();
	await expect(page.getByRole("tab", { name: "我的参与" })).toBeVisible();
	await page.getByRole("tab", { name: "我的参与" }).click();
	await expect(page.getByText("审核状态")).toBeVisible();
	await expect(page.getByText("已通过").first()).toBeVisible();
	await expect(page.getByText("已获活动得分")).toBeVisible();
	await expect(page.getByText("审核已通过，活动得分已计入总评。")).toBeVisible();
	await expect(page.getByText("未记录历史班级")).toHaveCount(0);
	await expect(page.getByText(/登记时的班级只用于保留记录/)).toHaveCount(0);
	await page.screenshot({ path: "test-results/my-participation-1440.png", fullPage: true, caret: "initial" });
	await page.setViewportSize({ width: 390, height: 844 });
	await page.reload({ waitUntil: "networkidle" });
	await page.getByRole("tab", { name: "我的参与" }).click();
	await expect(page.getByText("审核状态")).toBeVisible();
	const ownOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
	expect(ownOverflow).toBeLessThanOrEqual(1);
	await page.screenshot({ path: "test-results/my-participation-390.png", fullPage: true, caret: "initial" });
	await page.setViewportSize({ width: 1440, height: 900 });
	const back = page.getByRole("link", { name: "返回列表" });
	await expect(back).toHaveAttribute("href", /view=joined/);
	await back.click();
	await expect(page).toHaveURL(/view=joined/);
	await expect(page.getByRole("link", { name: activityName })).toBeVisible();
	await page.setViewportSize({ width: 390, height: 844 });
	await page.reload({ waitUntil: "networkidle" });
	await expect(page.getByRole("link", { name: activityName })).toBeVisible();
	const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
	expect(overflow).toBeLessThanOrEqual(1);
	await page.screenshot({ path: "test-results/my-activities-joined-390.png", fullPage: true, caret: "initial" });
	expect(errors).toEqual([]);
});
