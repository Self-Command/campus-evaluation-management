import "dotenv/config";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { hash } from "bcryptjs";
import { db } from "../src/server/db";
async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  if (process.env.NODE_ENV === "production" || process.env.DEV_SEED_ENABLED !== "true" || url.hostname !== "127.0.0.1" || !url.pathname.endsWith("_dev")) throw new Error("开发账号种子仅允许本地开发数据库");
  const credentials: { role: string; login: string; password: string }[] = [];
  for (const entry of [{ login: "admin.dev", name: "测试管理员", role: "ADMIN" as const }, { login: "publisher.dev", name: "测试活动发布者", role: "PUBLISHER" as const }, { login: "20260001", name: "测试学生", role: "STUDENT" as const }]) {
    if (await db.user.findUnique({ where: { login: entry.login } })) { console.log(`${entry.login} 已存在，未重置密码`); continue; }
    const password = `Dev!${randomBytes(9).toString("base64url")}7a`;
    await db.user.create({ data: { ...entry, passwordHash: await hash(password, 12), mustChangePassword: false } });
    credentials.push({ role: entry.role, login: entry.login, password });
  }
  if (credentials.length) {
    mkdirSync(".local", { recursive: true });
    const path = `.local/dev-accounts-${Date.now()}.json`;
    writeFileSync(path, JSON.stringify(credentials, null, 2), { mode: 0o600 });
    const summary = "测试账号（仅本地）.md";
    if (!existsSync(summary)) writeFileSync(summary, "# 本地登录测试账号\n\n登录地址：http://localhost:3000\n\n仅限本地开发，禁止提交或公开。用户修改密码后请自行更新记录。\n", { mode: 0o600 });
    const existing = readFileSync(summary, "utf8");
    const names = { ADMIN: "管理员", PUBLISHER: "活动发布者", STUDENT: "学生" };
    for (const account of credentials) if (!existing.includes(`\`${account.login}\``)) appendFileSync(summary, `\n- ${names[account.role as keyof typeof names]}：\`${account.login}\` / \`${account.password}\`\n`);
    console.log(`本轮开发账号凭据保存在 ${path}，并已汇总到 ${summary}；仅限本地测试。`);
  }
  await db.$disconnect();
}
main().catch(async (error) => { console.error(error); await db.$disconnect(); process.exit(1); });
