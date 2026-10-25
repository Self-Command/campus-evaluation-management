import "dotenv/config";
import { expect, test, type Page } from "@playwright/test";
import { login } from "./login";

const studentLogin = process.env.E2E_STUDENT_LOGIN;
const studentPassword = process.env.E2E_STUDENT_PASSWORD;
const adminLogin = process.env.E2E_ADMIN_LOGIN;
const adminPassword = process.env.E2E_ADMIN_PASSWORD;
const shotDir = ".local/ui-check/student-results-2026-10-24";

function skipWithoutStudentAccount() {
	test.skip(!studentLogin || !studentPassword, "未配置学生验收账号");
}

async function signInStudent(page: Page) {
	await login(page, studentLogin!, studentPassword!);
}

async function openOwnResult(page: Page) {
	await signInStudent(page);
	await page.goto("/results");
	await expect(page.getByTestId("result-total-value")).toBeVisible({
		timeout: 30_000,
	});
}

function collectErrors(page: Page) {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
	page.on("console", (message) => {
		if (message.type() === "error") errors.push(`console: ${message.text()}`);
	});
	return errors;
}

async function expectNoTechnicalText(page: Page) {
	const main = page.locator("#main-content");
	const text = await main.innerText();
	expect(text).not.toContain("factKey");
	expect(text).not.toContain("resultHash");
	expect(text).not.toContain("[object Object]");
	expect(text).not.toMatch(/\bundefined\b/);
	expect(text).not.toMatch(/\bNaN\b/);
}

async function expectAllLinksStyled(page: Page) {
	const naked = await page.locator("#main-content a:visible").evaluateAll((nodes) =>
		nodes
			.filter((node) => !node.className.includes("inline-flex"))
			.map((node) => node.textContent?.trim() ?? ""),
	);
	expect(naked, "页面内不应出现裸链接").toEqual([]);
}

async function stableScreenshot(page: Page) {
	// Full-element screenshots stitch multiple viewports; fixed chrome would be
	// painted repeatedly over the content.
	await page.addStyleTag({
		content: `
			header { position: static !important; }
			nextjs-portal { display: none !important; }
			[data-slot="sidebar"],
			[data-slot="sidebar-container"],
			[data-slot="sidebar-footer"] { display: none !important; }
		`,
	});
}

async function expectThreeSourceGroups(page: Page) {
	const main = page.locator("#main-content");
	for (const title of ["活动与成果", "成绩录入", "扣分"]) {
		await expect(
			main.getByRole("heading", { name: title, exact: true }),
		).toBeVisible();
	}
}

test.describe("学生成绩页 - 桌面", () => {
	test.use({ viewport: { width: 1440, height: 900 } });

	test("先给结论，再展开构成与依据", async ({ page }) => {
		skipWithoutStudentAccount();
		const errors = collectErrors(page);
		await openOwnResult(page);

		const main = page.locator("#main-content");
		const total = page.getByTestId("result-total-value");
		await expect(total).toHaveCount(1);
		await expect(total).toHaveText(/^\d+\.\d{2}$/);
		await expect(page.getByTestId("result-finality")).toBeVisible();
		for (const metric of ["rank", "status", "confirmation", "deadline"]) {
			await expect(page.getByTestId(`result-metric-${metric}`)).toBeVisible();
		}

		await expectThreeSourceGroups(page);
		await expectNoTechnicalText(page);
		await expectAllLinksStyled(page);

		const exportLink = main.getByRole("link", { name: "导出我的成绩单" });
		await expect(exportLink).toHaveAttribute("href", /^\/api\/grades\/export\?/);

		const aside = page.getByTestId("score-detail-aside");
		await expect(aside).toBeVisible();
		await expect(aside).toContainText("这一项怎么算");
		await expect(page.getByTestId("score-detail-inline")).toBeHidden();

		await expect(main.locator('[data-node-id][data-depth="0"]')).toHaveCount(2);
		await expect(main.locator('[data-node-id][data-depth="1"]')).toHaveCount(6);
		await expect(main.locator('[data-node-id][data-depth="2"]')).toHaveCount(0);

		const initialHeight = await page.evaluate(
			() => document.documentElement.scrollHeight,
		);
		test.info().annotations.push({
			type: "页面高度",
			description: `桌面 1440x900 首屏页面高度 ${initialHeight}px（${(
				initialHeight / 900
			).toFixed(1)} 屏）`,
		});
		expect(initialHeight).toBeLessThan(2400);

		await stableScreenshot(page);
		await main.screenshot({
			path: `${shotDir}/desktop.png`,
			caret: "initial",
		});

		const collapsed = main.locator('[data-node-id][aria-expanded="false"]');
		expect(await collapsed.count()).toBeGreaterThan(0);
		await collapsed.first().click();
		await expect(main.locator('[data-node-id][data-depth="2"]')).toHaveCount(3);
		await expect(aside).toContainText("超过这一项的上限");

		const zero = main.getByRole("button", { name: /未得分项/ });
		if (await zero.count()) {
			await expect(zero).toHaveAttribute("aria-expanded", "false");
			await zero.click();
			await expect(zero).toHaveAttribute("aria-expanded", "true");
			await expect(main.locator('[data-node-id][data-depth="3"]').first()).toBeVisible();
		}

		const activityGroup = main
			.locator("section")
			.filter({ has: page.getByRole("heading", { name: "活动与成果" }) });
		await activityGroup.getByRole("button", { name: /^查看/ }).first().click();
		let dialog = page.getByRole("dialog");
		await expect(dialog).toContainText("计分依据");
		await expect(dialog).toContainText("证明材料");
		await expect(dialog.getByRole("link", { name: "查看活动详情" })).toHaveClass(
			/inline-flex/,
		);
		await dialog.getByRole("button", { name: "关闭" }).click();

		const gradeGroup = main
			.locator("section")
			.filter({ has: page.getByRole("heading", { name: "成绩录入" }) });
		await gradeGroup.getByRole("button", { name: /^查看/ }).first().click();
		dialog = page.getByRole("dialog");
		await expect(dialog).toContainText("变更记录");
		await dialog.getByRole("button", { name: "关闭" }).click();

		await page.getByRole("button", { name: "成绩说明" }).click();
		dialog = page.getByRole("dialog");
		await expect(dialog).toContainText("评分方案");
		await expect(dialog).toContainText("发布批次");
		await dialog.getByRole("button", { name: "关闭" }).click();

		const expandedHeight = await page.evaluate(
			() => document.documentElement.scrollHeight,
		);
		test.info().annotations.push({
			type: "展开后高度",
			description: `桌面 1440x900 展开后页面高度 ${expandedHeight}px`,
		});

		await stableScreenshot(page);
		await main.screenshot({
			path: `${shotDir}/desktop-expanded.png`,
			caret: "initial",
		});

		expect(errors).toEqual([]);
	});
});

test.describe("学生成绩页 - 移动端", () => {
	test.use({ viewport: { width: 390, height: 844 } });

	test("单列阅读，没有横向滚动", async ({ page }) => {
		skipWithoutStudentAccount();
		const errors = collectErrors(page);
		await openOwnResult(page);

		const main = page.locator("#main-content");
		await expect(page.getByTestId("result-total-value")).toBeVisible();
		await expect(page.getByTestId("score-detail-aside")).toBeHidden();
		await expect(page.getByTestId("score-detail-inline")).toBeVisible();
		await expectNoTechnicalText(page);
		await expectAllLinksStyled(page);

		const buttons = main.getByRole("button", { name: /^查看/ });
		const count = await buttons.count();
		for (let index = 0; index < Math.min(count, 3); index += 1) {
			const box = await buttons.nth(index).boundingBox();
			expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
		}

		await main.locator('[data-node-id][data-depth="0"]').first().click();
		await expect(page.getByTestId("score-detail-inline")).toBeVisible();
		await expect(page.getByTestId("score-detail-inline")).toContainText(
			"这一项占综合测评总成绩",
		);

		const overflow = await page.evaluate(() => {
			const root = document.documentElement;
			return {
				scrollWidth: root.scrollWidth,
				clientWidth: root.clientWidth,
			};
		});
		expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);

		await main
			.locator("section")
			.filter({ has: page.getByRole("heading", { name: "成绩录入" }) })
			.getByRole("button", { name: /^查看/ })
			.first()
			.click();
		const dialog = page.getByRole("dialog");
		await expect(dialog).toContainText("变更记录");
		const dialogOverflow = await dialog.evaluate((node) => ({
			scrollWidth: node.scrollWidth,
			clientWidth: node.clientWidth,
		}));
		expect(dialogOverflow.scrollWidth).toBeLessThanOrEqual(
			dialogOverflow.clientWidth + 1,
		);
		await dialog.getByRole("button", { name: "关闭" }).click();

		const height = await page.evaluate(() => document.documentElement.scrollHeight);
		test.info().annotations.push({
			type: "页面高度",
			description: `移动 390x844 全页高度 ${height}px`,
		});
		expect(height).toBeLessThan(4000);

		await stableScreenshot(page);
		await main.screenshot({
			path: `${shotDir}/mobile.png`,
			caret: "initial",
		});

		expect(errors).toEqual([]);
	});
});

test.describe("学生成绩页 - 状态", () => {
	test.use({ viewport: { width: 1440, height: 900 } });

	async function mockResult(
		page: Page,
		change: (data: Record<string, unknown>) => void,
	) {
		await page.route("**/api/results?**", async (route) => {
			const response = await route.fetch();
			const data = (await response.json()) as Record<string, unknown>;
			change(data);
			await route.fulfill({ response, json: data });
		});
		await signInStudent(page);
		await page.goto("/results");
		await expect(page.getByTestId("result-total-value")).toBeVisible({
			timeout: 30_000,
		});
	}

	test("核对阶段出现确认与异议入口", async ({ page }) => {
		skipWithoutStudentAccount();
		await mockResult(page, (data) => {
			(data.term as Record<string, unknown>).phase = "CHECKING";
			data.publication = {
				id: "e2e-publication",
				sequence: 2,
				publishedAt: new Date().toISOString(),
				checkingEndsAt: new Date(Date.now() + 86_400_000).toISOString(),
				requireConfirmation: true,
			};
			data.resultHash = "e2e-result-hash";
			data.confirmation = null;
			data.rank = 3;
			data.population = 20;
		});

		await expect(page.getByTestId("result-metric-status")).toContainText("核对中");
		await expect(page.getByTestId("result-metric-confirmation")).toContainText(
			"待确认",
		);
		await expect(page.getByTestId("result-metric-rank")).toContainText("3 / 20");
		await expect(page.getByRole("button", { name: "确认成绩" })).toBeVisible();
		await expect(page.getByRole("button", { name: "提出异议" })).toBeVisible();
		await expect(
			page.getByRole("link", { name: "查看计分依据" }),
		).toHaveCount(0);

		await page.getByRole("button", { name: "确认成绩" }).click();
		const alert = page.getByRole("alertdialog");
		await expect(alert).toContainText("确认本版成绩？");
		await alert.getByRole("button", { name: "再核对一下" }).click();
		await expect(alert).toBeHidden();

		await page.getByRole("button", { name: "提出异议" }).click();
		const dialog = page.getByRole("dialog");
		await expect(dialog).toContainText("提出成绩异议");
		await page.keyboard.press("Escape");
		await expect(dialog).toBeHidden();

		await stableScreenshot(page);
		await page.getByTestId("result-summary").screenshot({
			path: `${shotDir}/desktop-checking.png`,
			caret: "initial",
		});
	});

	test("未录完时显示暂计成绩和缺项", async ({ page }) => {
		skipWithoutStudentAccount();
		let provisional = "";
		await mockResult(page, (data) => {
			const result = data.result as Record<string, unknown>;
			result.complete = false;
			result.total = null;
			result.missing = [{ id: "missing-node", name: "学业成绩" }];
			provisional = String(result.provisionalTotal);
		});

		await expect(page.getByTestId("result-finality")).toHaveText("暂计成绩");
		await expect(page.getByTestId("result-total-value")).toHaveText(
			Number(provisional).toFixed(2),
		);
		const alert = page.locator("#main-content").getByRole("alert");
		await expect(alert).toContainText("还有 1 项成绩未录入");
		await expect(alert).toContainText("学业成绩");
	});
});

test.describe("学生成绩页 - 管理员查看", () => {
	test.use({ viewport: { width: 1440, height: 900 } });

	test("管理员查看学生扣分依据与变更记录", async ({ page }) => {
		test.skip(!adminLogin || !adminPassword, "未配置管理员验收账号");
		await login(page, adminLogin!, adminPassword!);
		const terms = await page.evaluate(async () => {
			const response = await fetch("/api/terms");
			return (await response.json()) as { id: string; phase: string }[];
		});
		const term = terms.find((item) => item.phase === "ACTIVE") ?? terms[0];
		await page.goto(`/results?termId=${term.id}&login=240801130`);
		await expect(page.getByTestId("result-total-value")).toBeVisible({
			timeout: 30_000,
		});

		const main = page.locator("#main-content");
		await expect(main.getByRole("link", { name: "导出成绩明细表" })).toBeVisible();
		await expect(main.getByRole("link", { name: "返回学生名单" })).toBeVisible();
		await expect(main.getByLabel("学生学号")).toHaveValue("240801130");

		const deductionGroup = main
			.locator("section")
			.filter({ has: page.getByRole("heading", { name: "扣分" }) });
		await expect(
			deductionGroup.getByRole("button", { name: /^查看/ }),
		).toHaveCount(1);
		await deductionGroup.getByRole("button", { name: /^查看/ }).click();

		const dialog = page.getByRole("dialog");
		await expect(dialog).toContainText("扣分事由");
		await expect(dialog).toContainText("实际扣分");
		await expect(dialog).toContainText("变更记录");
		await page.addStyleTag({
			content: `nextjs-portal { display: none !important; }`,
		});
		await page.screenshot({
			path: `${shotDir}/desktop-admin-deduction.png`,
			fullPage: false,
			caret: "initial",
		});
		await dialog.getByRole("button", { name: "关闭" }).click();
	});
});
