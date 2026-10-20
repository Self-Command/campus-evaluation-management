import { beforeAll, afterAll, expect, test } from "vitest";
import { db } from "@/server/db";
import { createTerm, saveScheme, activateTerm } from "@/server/terms";
import { schoolScheme } from "@/lib/scoring/template";
if (!new URL(process.env.DATABASE_URL!).pathname.startsWith("/campus_test_")) throw new Error("必须使用临时测试数据库");
let admin: string, student: string;
beforeAll(async () => {
  await db.user.deleteMany(); await db.term.deleteMany(); await db.auditEvent.deleteMany();
  for (const role of ["ADMIN", "STUDENT"] as const) {
    const user = await db.user.create({ data: { login: `term-${role}`, name: role, role, passwordHash: "unused", mustChangePassword: false } });
    const session = await db.authSession.create({ data: { userId: user.id, version: 0, expiresAt: new Date(Date.now() + 600_000) } });
    if (role === "ADMIN") admin = session.id; else student = session.id;
  }
});
afterAll(async () => db.$disconnect());
test("管理员建期保存，过期编辑、非法树和低权限写入拒绝", async () => {
  const term = await createTerm(admin, { name: "评分配置学期" });
  expect(term.phase).toBe("CONFIGURATION");
  const scheme = schoolScheme(); scheme.nodes[0].name = "自定义总分";
  const saved = await saveScheme(admin, term.id, { revision: 0, scheme });
  expect(saved.revision).toBe(1);
  await expect(saveScheme(admin, term.id, { revision: 0, scheme })).rejects.toThrow("已变化");
  const invalid = structuredClone(scheme); invalid.nodes.find(n => n.id === "academic")!.weight = "0.2";
  await expect(saveScheme(admin, term.id, { revision: 1, scheme: invalid })).rejects.toThrow("100%");
  expect((await db.term.findUniqueOrThrow({ where: { id: term.id } })).revision).toBe(1);
  await expect(createTerm(student, { name: "越权创建" })).rejects.toThrow("管理权限");
  await expect(saveScheme(student, term.id, { revision: 1, scheme })).rejects.toThrow("操作权限");
  const active = await activateTerm(admin, term.id, { revision: 1 });
  expect(active.phase).toBe("ACTIVE");
  await expect(saveScheme(admin, term.id, { revision: 2, scheme })).rejects.toThrow("阶段");
});
