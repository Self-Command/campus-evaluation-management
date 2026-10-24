import "dotenv/config";
import { test, expect } from "@playwright/test";
import { login } from "./login";

const roles = [
	{
		label: "管理员",
		login: process.env.E2E_ADMIN_LOGIN ?? "",
		password: process.env.E2E_ADMIN_PASSWORD ?? "",
		routes: ["/", "/terms", "/activities", "/recognitions", "/settings", "/students", "/accounts", "/publication", "/rankings", "/grades", "/deductions", "/imports"],
	},
	{
		label: "二级学院",
		login: process.env.E2E_COLLEGE_LOGIN ?? "",
		password: process.env.E2E_COLLEGE_PASSWORD ?? "",
		routes: ["/", "/students", "/activities", "/recognitions", "/claims", "/grades", "/deductions", "/organizations", "/imports?kind=participation"],
	},
	{
		label: "辅导员",
		login: process.env.E2E_COUNSELOR_LOGIN ?? "",
		password: process.env.E2E_COUNSELOR_PASSWORD ?? "",
		routes: ["/", "/students", "/activities", "/recognitions", "/claims", "/grades", "/deductions"],
	},
	{
		label: "学生",
		login: process.env.E2E_STUDENT_LOGIN ?? "",
		password: process.env.E2E_STUDENT_PASSWORD ?? "",
		routes: ["/", "/my-activities", "/my-activities?view=joined", "/results", "/claims", "/appeals", "/profile"],
	},
];

for (const role of roles) {
	test(`${role.label} 页面巡检`, async ({ page }) => {
		test.skip(!role.login || !role.password, `未配置 ${role.label} 的 E2E 账号环境变量`);
		test.setTimeout(180_000);
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
		page.on("console", (message) => {
			if (message.type() === "error") errors.push(`console: ${message.text()}`);
		});
		page.on("response", (response) => {
			if (response.status() >= 400) errors.push(`http ${response.status()}: ${response.url()}`);
		});
		await login(page, role.label, role.login, role.password);
		for (const route of role.routes) {
			errors.length = 0;
			const response = await page.goto(route, { waitUntil: "networkidle" });
			await expect(page.locator("body")).toBeVisible();
			if (response && response.status() >= 500) errors.push(`document ${response.status()}: ${route}`);
			const body = await page.locator("body").innerText();
			if (/Application error|Unhandled Runtime Error|missing required error components|Internal Server Error/i.test(body))
				errors.push(`error overlay text on ${route}`);
			if (errors.length) console.log(`\n[${role.label} ${route}]\n${errors.join("\n")}`);
			expect(errors, `${role.label} ${route}`).toEqual([]);
		}
	});
}
