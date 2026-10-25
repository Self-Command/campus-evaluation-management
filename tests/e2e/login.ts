import { expect, type Page } from "@playwright/test";
import { solveCaptcha } from "./captcha";

export async function login(page: Page, loginName: string, password: string) {
	await page.goto("/login");
	await page.getByLabel("学号或账号").fill(loginName);
	await page.getByLabel("密码", { exact: true }).fill(password);
	const captcha = page.getByAltText("英文验证码，点击可更换");
	await expect(captcha).toBeVisible();
	const captchaSrc = await captcha.getAttribute("src");
	if (!captchaSrc) throw new Error("验证码图片未加载");
	await page.getByLabel("图片验证码", { exact: true }).fill(solveCaptcha(captchaSrc));
	await page.getByRole("button", { name: "登录", exact: true }).click();
	await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
}
