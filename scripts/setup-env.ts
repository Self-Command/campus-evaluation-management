import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
if (existsSync(".env")) throw new Error(".env 已存在，未覆盖。");
mkdirSync(".local", { recursive: true });
const password = randomBytes(24).toString("hex");
writeFileSync(".env", `DATABASE_URL="postgresql://campus:${password}@127.0.0.1:55432/campus_dev"\nNEXTAUTH_URL="http://localhost:3000"\nNEXTAUTH_SECRET="${randomBytes(48).toString("hex")}"\nDEV_SEED_ENABLED="true"\n`, { mode: 0o600 });
console.log("本地环境已生成；密钥仅保存在被忽略的 .env。");
