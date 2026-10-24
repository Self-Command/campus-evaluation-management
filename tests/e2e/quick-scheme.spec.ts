import "dotenv/config";
import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { hash } from "bcryptjs";
import { db } from "../../src/server/db";
import { nodeSchema, type Scheme } from "../../src/lib/scoring/types";
import { solveCaptcha } from "./captcha";

function schoolScheme(): Scheme {
	const template = JSON.parse(
		readFileSync(
			resolve(process.cwd(), "docs/examples/学校评分模板.json"),
			"utf8",
		),
	);
	const nodes: Scheme["nodes"] = [];
	const deductions: Scheme["deductions"] = [];
	const stack: {
		node: {
			id: string;
			name: string;
			kind: string;
			weight?: string;
			aggregation?: string;
			cap?: string;
			missing?: string;
			children?: unknown[];
			deductions?: {
				id: string;
				name: string;
				weight?: string;
			}[];
		};
		parentId: string | null;
		order: number;
	}[] = [{ node: template.root, parentId: null, order: 0 }];
	while (stack.length) {
		const { node, parentId, order } = stack.pop()!;
		nodes.push(
			nodeSchema.parse({
				id: node.id,
				name: node.name,
				parentId,
				order,
				kind:
					node.kind === "group"
						? node.aggregation === "weighted_sum"
							? "WEIGHTED"
							: "SUM"
						: node.missing === "required"
							? "GRADE"
							: "ACTIVITY",
				weight: node.weight ?? "1",
				cap: node.cap ?? null,
				required: node.missing === "required",
				maximum: node.missing === "required" ? "100" : "9999999999",
			}),
		);
		for (const item of node.deductions ?? [])
			deductions.push({
				id: item.id,
				nodeId: node.id,
				name: item.name,
				coefficient: item.weight ?? "1",
			});
		const children = (node.children ?? []) as typeof stack[number]["node"][];
		for (let index = children.length - 1; index >= 0; index--)
			stack.push({ node: children[index], parentId: node.id, order: index });
	}
	return { nodes, deductions };
}

const prefix = `quick-${randomBytes(5).toString("hex")}`;
const password = `Test!${randomBytes(12).toString("hex")}`;
let adminId = "";
let termId = "";

test.beforeAll(async () => {
	const url = new URL(process.env.DATABASE_URL!);
	if (url.hostname !== "127.0.0.1" || !url.pathname.endsWith("_dev"))
		throw new Error("仅允许开发测试库");
	const admin = await db.user.create({
		data: {
			login: `${prefix}-admin`,
			name: "快速配置测试管理员",
			role: "ADMIN",
			passwordHash: await hash(password, 12),
			mustChangePassword: false,
		},
	});
	adminId = admin.id;
	const term = await db.term.create({
		data: {
			name: `快速配置测试周期-${prefix}`,
			phase: "CONFIGURATION",
			revision: 1,
			scheme: JSON.parse(JSON.stringify(schoolScheme())),
		},
	});
	termId = term.id;
});

test.afterAll(async () => {
	await db.term.deleteMany({ where: { id: termId } });
	await db.user.deleteMany({ where: { id: adminId } });
	await db.$disconnect();
});

test("快速评分卡读取、修改、校验、恢复、移动和开启申报", async ({
	page,
}) => {
	test.setTimeout(120_000);
	await page.goto("/login");
	await page.getByLabel("登录身份").click();
	await page.getByRole("option", { name: "管理员" }).click();
	await page.getByLabel("学号或账号").fill(`${prefix}-admin`);
	await page.getByLabel("密码", { exact: true }).fill(password);
	const captcha = page.getByAltText("英文验证码，点击可更换");
	await expect(captcha).toBeVisible();
	const captchaSrc = await captcha.getAttribute("src");
	if (!captchaSrc) throw new Error("验证码图片未加载");
	await page.getByLabel("图片验证码", { exact: true }).fill(solveCaptcha(captchaSrc));
	await page.getByRole("button", { name: "登录", exact: true }).click();
	await page.waitForURL((url) => !url.pathname.startsWith("/login"));

	await page.goto(`/terms/${termId}?tab=scheme`);
	const card = page.locator('[data-testid="quick-scheme-card"]:visible');
	await expect(card).toBeVisible();
	await expect(card.getByText("综合测评成绩", { exact: true })).toBeVisible();
	await expect(card.getByText("配置完成", { exact: true })).toBeVisible();
	await expect(page.getByLabel("基础性素质占总分比例")).toHaveCount(0);

	await page.setViewportSize({ width: 390, height: 844 });
	await page.reload();
	await expect(card).toBeVisible();
	const mobileOverflow = await page.evaluate(
		() => document.documentElement.scrollWidth - window.innerWidth,
	);
	expect(mobileOverflow).toBeLessThanOrEqual(1);
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.reload();
	await expect(card).toBeVisible();

	await card.getByRole("button", { name: "调整分值" }).click();
	await page.getByLabel("基础性素质占总分比例").fill("70");
	await page.getByLabel("发展性素质占总分比例").fill("30");
	await page.getByLabel("红色文化引领工程占基础性素质比例").fill("20");
	await page.getByLabel("学业成绩占基础性素质比例").fill("70");
	await page.getByLabel("体育素质占基础性素质比例").fill("10");
	await page.getByLabel("红色文化引领工程最高分").fill("90");
	await page.getByLabel("志愿服务实践工程最高分").fill("35");
	await page.getByLabel("人文素质提升工程最高分").fill("30");
	await page.getByLabel("卓越工匠培养工程最高分").fill("35");
	await page.getByLabel("法制与校规校纪扣分比例").fill("80");
	await expect(page.getByText("三项合计", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "保存调整" }).click();
	// 行内成功提示会被 router.refresh 重挂载清空，以全局提示确认保存结果。
	await expect(
		page.getByRole("dialog", { name: "评分方案已保存" }),
	).toBeVisible();
	// Let the server refresh finish before interacting with the remounted card.
	await page.waitForTimeout(1500);

	const saved = await db.term.findUniqueOrThrow({ where: { id: termId } });
	const savedScheme = saved.scheme as {
		nodes: { id: string; weight: string; cap: string | null }[];
		deductions: { coefficient: string }[];
	};
	expect(
		savedScheme.nodes.find((node) => node.id === "foundation")?.weight,
	).toBe("0.700000000000");
	expect(
		savedScheme.nodes.find((node) => node.id === "red_culture")?.cap,
	).toBe("90");
	expect(savedScheme.deductions[0].coefficient).toBe("0.800000000000");

	await card.getByRole("button", { name: "调整分值" }).click();
	await page.getByLabel("学业成绩占基础性素质比例").fill("90");
	await expect(
		page.getByText("红色文化、学业成绩、体育素质合计 120%，应等于 100%。"),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "保存并开启" }),
	).toBeDisabled();
	await page.getByRole("button", { name: "取消" }).click();

	await card.getByRole("button", { name: "调整分值" }).click();
	await page.getByLabel("基础性素质占总分比例").fill("60");
	await page.getByRole("button", { name: "恢复模板数值" }).click();
	await expect(
		page.getByLabel("基础性素质占总分比例"),
	).toHaveValue("80");
	await page.getByRole("button", { name: "取消" }).click();

	await card.getByRole("button", { name: "高级结构编辑" }).click();
	await expect(
		page.getByText(/使用每行的上移、下移或移动到调整结构和顺序/),
	).toBeVisible();
	await page.getByRole("button", { name: "下移学业成绩" }).click();
	await expect(page.getByText(/模块位置已调整/)).toBeVisible();
	const physicalRow = page
		.getByRole("row")
		.filter({ hasText: "体育素质" })
		.first();
	await physicalRow.getByRole("button", { name: "移动到" }).click();
	await page.getByLabel("新的上级模块").selectOption({ label: "基础性素质" });
	await page.getByLabel("放在同级的位置").selectOption("first");
	await page.getByRole("button", { name: "确认移动" }).click();
	await expect(page.getByText(/模块位置已调整/)).toBeVisible();
	page.once("dialog", (dialog) => dialog.accept());
	await page.getByRole("button", { name: "快速配置", exact: true }).click();
	await expect(card).toBeVisible();

	page.once("dialog", (dialog) => dialog.accept());
	await card.getByRole("button", { name: "开启申报" }).click();
	await expect(
		page.getByText("评分方案已开启申报", { exact: true }),
	).toBeVisible();
	const activated = await db.term.findUniqueOrThrow({ where: { id: termId } });
	expect(activated.phase).toBe("ACTIVE");
});
