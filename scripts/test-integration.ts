import "dotenv/config";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { Client } from "pg";
async function main() {
  const base = new URL(process.env.DATABASE_URL!);
  if (base.hostname !== "127.0.0.1") throw new Error("只允许本地测试数据库");
  const name = `campus_test_${randomBytes(6).toString("hex")}`;
  const client = new Client({ connectionString: new URL("/postgres", base).toString() });
  await client.connect();
  await client.query(`CREATE DATABASE "${name}"`);
  const env = { ...process.env, DATABASE_URL: new URL(`/${name}`, base).toString() };
  const run = (script: string, args: string[]) => new Promise<void>((done, fail) => {
    const child = spawn(process.execPath, [script, ...args], { env, stdio: "inherit" });
    child.on("error", fail); child.on("exit", code => code === 0 ? done() : fail(new Error(`Test command exit ${code}`)));
  });
  try {
    await run("node_modules/prisma/build/index.js", ["migrate", "deploy"]);
    await run("node_modules/vitest/vitest.mjs", ["run"]);
  } finally {
    await client.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await client.end();
  }
}
main().catch(error => { console.error(error.message); process.exit(1); });
