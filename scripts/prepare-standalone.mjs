import { cpSync, existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const dist = resolve(root, ".next-production");
const standalone = resolve(dist, "standalone");
const staticSource = resolve(dist, "static");
const staticTarget = resolve(standalone, ".next-production", "static");

if (!existsSync(standalone)) {
  throw new Error("未找到 .next-production/standalone，请先执行 next build");
}
if (!existsSync(staticSource)) {
  throw new Error("未找到 .next-production/static，请先执行 next build");
}

rmSync(staticTarget, { recursive: true, force: true });
cpSync(staticSource, staticTarget, { recursive: true });

const publicSource = resolve(root, "public");
if (existsSync(publicSource)) {
  const publicTarget = resolve(standalone, "public");
  rmSync(publicTarget, { recursive: true, force: true });
  cpSync(publicSource, publicTarget, { recursive: true });
}

console.log("standalone 静态资源已同步");
