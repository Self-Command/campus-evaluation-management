import { beforeAll, afterAll, expect, test } from "vitest";
import { compare } from "bcryptjs";
import { db } from "@/server/db";
import { previewAccountImport, commitAccountImport } from "@/server/account-import";
import { parseAccountFile } from "@/server/spreadsheet";
import { workbookFixture } from "./xlsx-fixture";
import { organizationFixture } from "./organization-fixture";
if (!new URL(process.env.DATABASE_URL!).pathname.startsWith("/campus_test_")) throw new Error("必须使用临时测试数据库");
let session: string;
const row = { login: "00002345", name: "导入学生", college: "信息学院", major: "计算机", className: "计科一班" };
beforeAll(async () => {
  await db.accountImport.deleteMany();
  await db.user.deleteMany();
  await db.auditEvent.deleteMany();
  const admin = await db.user.create({ data: { login: "import-admin", name: "导入管理员", role: "ADMIN", passwordHash: "unused", mustChangePassword: false } });
  session = (await db.authSession.create({ data: { userId: admin.id, version: 0, expiresAt: new Date(Date.now() + 600_000) } })).id;
  await organizationFixture("import-org", row);
});
afterAll(async () => db.$disconnect());
test("CSV 保留前导零，拒绝无效编码和超限名单", async () => {
  const result = await parseAccountFile("学生.csv", Buffer.from("学号,姓名\n00002345,导入学生"));
  expect(result.rows[0][0]).toEqual({ value: "00002345", numeric: false });
  await expect(parseAccountFile("学生.csv", Buffer.from([255, 254]))).rejects.toThrow("UTF-8");
  await expect(parseAccountFile("学生.csv", Buffer.from("学号\n" + "00001\n".repeat(101)))).rejects.toThrow("100");
});
test("XLSX 保留文本学号，标记数字学号并拒绝公式与损坏文件", async () => {
  const text = await parseAccountFile("学生.xlsx", workbookFixture("00002345"));
  expect(text.rows[0][0]).toEqual({ value: "00002345", numeric: false });
  const numeric = await parseAccountFile("学生.xlsx", workbookFixture("2345", true));
  expect(numeric.rows[0][0].numeric).toBe(true);
  await expect(parseAccountFile("学生.xlsx", workbookFixture("2", false, true))).rejects.toThrow("公式");
  await expect(parseAccountFile("学生.xlsx", Buffer.from("not a workbook"))).rejects.toThrow("无效");
});
test("预览不写入账号，错误批次整批拒绝", async () => {
  const preview = await previewAccountImport(session, [row, { ...row, login: "error-row", college: "" }]);
  expect(preview.errors).toBe(1);
  expect(await db.user.count({ where: { login: row.login } })).toBe(0);
  await expect(commitAccountImport(session, preview.id)).rejects.toThrow("错误行");
  expect(await db.user.count({ where: { login: row.login } })).toBe(0);
});
test("重复记录跳过，并发提交只建一次且不重复交付密码", async () => {
  const preview = await previewAccountImport(session, [row, row]);
  expect(preview.rows.map(r => r.state)).toEqual(["NEW", "SKIP"]);
  const results = await Promise.all([commitAccountImport(session, preview.id), commitAccountImport(session, preview.id)]);
  expect(results.map(r => r.replay).sort()).toEqual([false, true]);
  expect(results.reduce((sum, r) => sum + r.credentials.length, 0)).toBe(1);
  const user = await db.user.findUniqueOrThrow({ where: { login: row.login }, include: { studentProfile: true } });
  const secret = results.flatMap(r => r.credentials)[0].initialPassword;
  expect(await compare(secret, user.passwordHash)).toBe(true);
  expect(user.mustChangePassword).toBe(true);
  expect(user.studentProfile?.studentNumber).toBe(row.login);
  expect(JSON.stringify(await db.auditEvent.findMany())).not.toContain(secret);
  const repeat = await previewAccountImport(session, [row]);
  expect(repeat.rows[0].state).toBe("SKIP");
  expect((await commitAccountImport(session, repeat.id)).created).toBe(0);
  expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash).toBe(user.passwordHash);
});
test("过期、他人批次与过时预览均拒绝提交", async () => {
  const preview = await previewAccountImport(session, [{ ...row, login: "stale-row" }]);
  const admin = await db.user.create({ data: { login: "other-import-admin", name: "其他管理员", role: "ADMIN", passwordHash: "unused", mustChangePassword: false } });
  const other = await db.authSession.create({ data: { userId: admin.id, version: 0, expiresAt: new Date(Date.now() + 600_000) } });
  await expect(commitAccountImport(other.id, preview.id)).rejects.toThrow("其他管理员");
  await db.user.create({ data: { login: "stale-row", name: "并发创建", role: "PUBLISHER", passwordHash: "unused" } });
  await expect(commitAccountImport(session, preview.id)).rejects.toThrow("已变化");
  const expired = await previewAccountImport(session, [{ ...row, login: "expired-row" }]);
  await db.accountImport.update({ where: { id: expired.id }, data: { expiresAt: new Date(0) } });
  await expect(commitAccountImport(session, expired.id)).rejects.toThrow("已过期");
  expect(await db.user.count({ where: { login: "expired-row" } })).toBe(0);
});
