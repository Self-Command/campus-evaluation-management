import "dotenv/config";
import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { hash } from "bcryptjs";
import { db } from "../../src/server/db";
const prefix = `imp-${randomBytes(5).toString("hex")}`;
const password = `Test!${randomBytes(12).toString("hex")}`;
let adminId: string;
test.beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (url.hostname !== "127.0.0.1" || !url.pathname.endsWith("_dev")) throw new Error("仅允许开发测试库");
  const admin = await db.user.create({ data: { login: `${prefix}-admin`, name: "导入测试管理员", role: "ADMIN", passwordHash: await hash(password, 12), mustChangePassword: false } });
  adminId = admin.id;
});
test.afterAll(async () => {
  await db.accountImport.deleteMany({ where: { actorId: adminId } });
  await db.user.deleteMany({ where: { login: { startsWith: prefix } } });
  await db.$disconnect();
});
test("名单列匹配、错误阻断、预览与整批提交", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("账号", { exact: true }).fill(`${prefix}-admin`);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录工作空间" }).click();
  await expect(page).toHaveURL(/\/workspace/);
  await page.goto("/accounts");
  await page.getByRole("link", { name: "导入学生账号", exact: true }).click();
  await expect(page).toHaveURL(/\/accounts\/import/);
  const upload = async (college: string) => {
    await page.getByLabel("学生名单", { exact: true }).setInputFiles({ name: "学生.csv", mimeType: "text/csv", buffer: Buffer.from(`学号,姓名,学院,专业,班级\n${prefix}-00001,名单学生,${college},计算机,计科一班`) });
    await page.getByRole("button", { name: "读取名单" }).click();
    await page.getByRole("button", { name: "生成预览" }).click();
  };
  await upload("");
  await expect(page.getByRole("button", { name: "确认导入" })).toBeDisabled();
  expect(await db.user.count({ where: { login: `${prefix}-00001` } })).toBe(0);
  await upload("信息学院");
  await expect(page.getByRole("button", { name: "确认导入" })).toBeEnabled();
  await page.getByRole("button", { name: "确认导入" }).click();
  await expect(page.getByRole("button", { name: "保存初始凭据" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: `${prefix}-00001` })).toBeVisible();
  const student = await db.user.findUniqueOrThrow({ where: { login: `${prefix}-00001` }, include: { studentProfile: true } });
  expect(student.studentProfile?.college).toBe("信息学院");
  expect(student.mustChangePassword).toBe(true);
  await page.screenshot({ path: ".local/account-import-page.png", fullPage: true });
});
