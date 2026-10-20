import "dotenv/config";
import { existsSync, cpSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { homedir, platform } from "node:os";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { Client } from "pg";

async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  if (platform() !== "win32") throw new Error("此启动器用于 Windows；其他系统请使用本机 PostgreSQL。");
  if (url.hostname !== "127.0.0.1" || !url.pathname.endsWith("_dev")) throw new Error("仅允许本地开发数据库");
  // Windows PostgreSQL bootstrap cannot reliably read binaries under a Chinese path.
  const root = resolve(homedir(), ".campus-evaluation-dev");
  const native = resolve(root, "postgres-18.4");
  const data = resolve(root, "postgres");
  mkdirSync(root, { recursive: true });
  const require = createRequire(import.meta.url);
  const source = resolve(dirname(require.resolve("@embedded-postgres/windows-x64")), "../native");
  if (!existsSync(resolve(native, "bin/initdb.exe"))) cpSync(source, native, { recursive: true });
  const env = { ...process.env, TZ: "UTC", PGTZ: "UTC", LC_ALL: "C", LC_MESSAGES: "C" };
  if (!existsSync(resolve(data, "PG_VERSION"))) {
    const passwordFile = resolve(root, "init-password.tmp");
    writeFileSync(passwordFile, url.password, { mode: 0o600 });
    try {
      await new Promise<void>((done, fail) => {
        const child = spawn(resolve(native, "bin/initdb.exe"), ["-D", data, "-U", url.username, `--pwfile=${passwordFile}`, "--auth=scram-sha-256", "--encoding=UTF8", "--locale=C"], { cwd: root, env, stdio: "inherit" });
        child.on("error", fail); child.on("exit", code => code === 0 ? done() : fail(new Error(`initdb exit ${code}`)));
      });
    } finally { unlinkSync(passwordFile); }
  }
  const server = spawn(resolve(native, "bin/postgres.exe"), ["-D", data, "-p", url.port, "-h", "127.0.0.1"], { cwd: root, env, stdio: ["ignore", "ignore", "pipe"] });
  server.on("error", error => { console.error(error); process.exit(1); });
  server.on("exit", code => process.exit(code ?? 1));
  let ready = false;
  server.stderr.on("data", async chunk => {
    const message = String(chunk);
    if (!message.includes("ready to accept connections")) { if (message.includes("FATAL")) console.error(message); return; }
    if (ready) return; ready = true;
    const client = new Client({ connectionString: new URL("/postgres", url).toString() });
    try {
      await client.connect();
      const name = url.pathname.slice(1);
      if (!/^[a-z_]+$/.test(name)) throw new Error("非法数据库名");
      const found = await client.query("SELECT 1 FROM pg_database WHERE datname=$1", [name]);
      if (!found.rowCount) await client.query(`CREATE DATABASE "${name}"`);
      console.log("本机 PostgreSQL 已就绪，沿用原有持久化数据。");
    } catch (error) { console.error(error); server.kill(); }
    finally { await client.end(); }
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => server.kill());
}
main().catch(error => { console.error(error); process.exit(1); });
