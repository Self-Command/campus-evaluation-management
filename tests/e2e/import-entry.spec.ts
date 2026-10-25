import "dotenv/config";
import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client";
import { login } from "./login";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const prefix = `e2e-import-${randomBytes(4).toString("hex")}`;
const ids = { activity: "", term: "" };

test.beforeAll(async () => {
	const term = await db.term.findFirst({
		where: { phase: "ACTIVE", disposition: "NORMAL" },
		orderBy: { createdAt: "desc" },
	});
	if (!term) return;
	const scheme = term.scheme as { nodes?: { id: string; kind: string }[] };
	const node = scheme.nodes?.find((item) => item.kind === "ACTIVITY");
	const college = await db.user.findFirst({
		where: { role: "COLLEGE", login: process.env.E2E_COLLEGE_LOGIN },
		select: { id: true, collegeId: true, college: { select: { name: true } } },
	});
	if (!node || !college?.collegeId || !college.college) return;
	ids.term = term.id;
	const activity = await db.activity.create({
		data: {
			termId: term.id,
			ownerId: college.id,
			collegeId: college.collegeId,
			name: `${prefix} 导入入口回归活动`,
			organizer: college.college.name,
			content: "验证活动详情的名单导入入口和导入页面的类型切换。",
			startsAt: new Date(Date.now() - 172_800_000),
			endsAt: new Date(Date.now() + 86_400_000),
			nodeId: node.id,
			points: "5",
			confirmed: true,
			publishedAt: new Date(Date.now() - 172_800_000),
			publishRevision: 1,
			audienceScope: "COLLEGE",
			audienceColleges: [college.college.name],
			audienceClasses: [],
		},
	});
	ids.activity = activity.id;
});

test.afterAll(async () => {
	if (ids.activity) {
		await db.participation.deleteMany({ where: { activityId: ids.activity } });
		await db.auditEvent.deleteMany({ where: { targetId: ids.activity } });
		await db.activity.deleteMany({ where: { id: ids.activity } });
	}
	await db.$disconnect();
});

for (const role of [
	{ label: "管理员", login: process.env.E2E_ADMIN_LOGIN!, password: process.env.E2E_ADMIN_PASSWORD! },
	{ label: "学院", login: process.env.E2E_COLLEGE_LOGIN!, password: process.env.E2E_COLLEGE_PASSWORD! },
]) {
	test(`${role.label} 从活动详情进入名单导入并读取表头`, async ({ page }) => {
		test.skip(!ids.activity, "缺少可用周期、学院账号或活动计分项");
		test.setTimeout(120_000);
		await page.setViewportSize({ width: 1440, height: 900 });
		await login(page, role.login, role.password);
		await page.goto(`/activities/${ids.activity}?termId=${ids.term}`, {
			waitUntil: "networkidle",
		});
		await page.getByRole("button", { name: "更多操作" }).click();
		await page.getByRole("menuitem", { name: /名单/ }).click();
		await expect(page).toHaveURL(
			new RegExp(`/imports\\?kind=participation&termId=${ids.term}&activityId=${ids.activity}`),
		);
		await expect(page.getByRole("heading", { name: "提交正式参与名单" })).toBeVisible();
		await expect(page.getByRole("link", { name: "下载模板" })).toBeVisible();
		const read = page.getByRole("button", { name: "读取文件列" });
		await expect(read).toBeDisabled();
		await page.locator("#import-file").setInputFiles({
			name: "roster.csv",
			mimeType: "text/csv",
			buffer: Buffer.from(
				"学号,姓名,学院,专业,班级\n240801051,测试学生,人工智能与大数据学院,软件技术,2024软件1班\n",
			),
		});
		await expect(read).toBeEnabled();
		await read.click();
		await expect(page.getByText("表头校验")).toBeVisible();
		await expect(page.getByText("表头完整。系统将逐人核对")).toBeVisible();
		await page.screenshot({
			path: `test-results/import-entry-${role.label}.png`,
			fullPage: true,
		});
	});
}

test("管理员可在导入页切换账号、成绩与参与名单", async ({ page }) => {
	test.setTimeout(120_000);
	await page.setViewportSize({ width: 1440, height: 900 });
	await login(page, process.env.E2E_ADMIN_LOGIN!, process.env.E2E_ADMIN_PASSWORD!);
	await page.goto("/imports", { waitUntil: "networkidle" });
	const tabs = page.getByRole("navigation", { name: "导入类型" });
	await expect(tabs.getByRole("link", { name: "学生账号" })).toHaveAttribute("aria-current", "page");
	await tabs.getByRole("link", { name: "成绩" }).click();
	await expect(page).toHaveURL(/kind=grades/);
	await expect(page.getByRole("heading", { name: "导入成绩" })).toBeVisible();
	await tabs.getByRole("link", { name: "参与名单" }).click();
	await expect(page).toHaveURL(/kind=participation/);
	await expect(page.getByRole("heading", { name: "参与名单导入" })).toBeVisible();
	await page.setViewportSize({ width: 390, height: 844 });
	await page.reload({ waitUntil: "networkidle" });
	const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
	expect(overflow).toBeLessThanOrEqual(1);
});
