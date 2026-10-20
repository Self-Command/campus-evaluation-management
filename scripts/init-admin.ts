import "dotenv/config";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { initializeAdmin } from "../src/server/initialize-admin";
import { db } from "../src/server/db";
async function main() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("仅允许在交互式终端初始化管理员");
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const login = (await readline.question("首个管理员登录名：")).trim();
    if (!/^[a-zA-Z0-9._-]{3,64}$/.test(login)) throw new Error("登录名需为3–64位字母、数字、点、下划线或连字符");
    const password = `Init!${randomBytes(18).toString("base64url")}7a`;
    await initializeAdmin(login, password);
    console.log(`管理员已创建。一次性初始密码（请安全保存）：${password}\n首次登录必须修改；请勿将此终端输出上传或共享。`);
  } finally { readline.close(); await db.$disconnect(); }
}
main().catch(async error => { console.error(error instanceof Error ? error.message : "初始化失败"); await db.$disconnect(); process.exit(1); });
