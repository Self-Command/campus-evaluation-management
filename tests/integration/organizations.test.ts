import { afterAll, beforeAll, expect, test } from "vitest";
import { db } from "@/server/db";
import { createAccount, readStudentProfile, updateAccount } from "@/server/accounts";
import { pageStudents, updateStudentProfile } from "@/server/students";
import { listOrganizations, saveOrganization } from "@/server/organizations";
import { previewAccountImport, commitAccountImport } from "@/server/account-import";
import type { Role } from "@/generated/prisma/client";

if (!new URL(process.env.DATABASE_URL!).pathname.startsWith("/campus_test_")) throw new Error("必须使用临时测试数据库");
let admin: string, collegeA: string, collegeB: string, counselorA: string, counselorB: string;
let collegeAId: string, collegeBId: string, majorAId: string, majorBId: string, classAId: string, classBId: string;
let counselorAId: string, studentAId: string, studentBId: string;
async function identity(login: string, role: Role, collegeId?: string) {
  const user = await db.user.create({ data: { login: `org-${login}`, name: login, role, collegeId, passwordHash: "organization-fixture-only", mustChangePassword: false } });
  const session = await db.authSession.create({ data: { userId: user.id, version: 0, expiresAt: new Date(Date.now() + 600_000) } });
  return { user, session: session.id };
}
beforeAll(async () => {
  admin = (await identity("admin", "ADMIN")).session;
  let tree = await saveOrganization(admin, { kind: "college", code: "ORG-A", name: "A学院", enabled: true });
  collegeAId = tree.colleges.find(c => c.code === "ORG-A")!.id;
  tree = await saveOrganization(admin, { kind: "college", code: "ORG-B", name: "B学院", enabled: true });
  collegeBId = tree.colleges.find(c => c.code === "ORG-B")!.id;
  collegeA = (await identity("college-A", "COLLEGE", collegeAId)).session;
  collegeB = (await identity("college-B", "COLLEGE", collegeBId)).session;
  const ca = await identity("counselor-A", "COUNSELOR", collegeAId); counselorA = ca.session; counselorAId = ca.user.id;
  const cb = await identity("counselor-B", "COUNSELOR", collegeBId); counselorB = cb.session;
  tree = await saveOrganization(collegeA, { kind: "major", code: "M", name: "同名专业", enabled: true, parentId: collegeAId });
  majorAId = tree.colleges[0].majors[0].id;
  tree = await saveOrganization(collegeB, { kind: "major", code: "M", name: "同名专业", enabled: true, parentId: collegeBId });
  majorBId = tree.colleges[0].majors[0].id;
  tree = await saveOrganization(collegeA, { kind: "class", code: "C", name: "同名班级", enabled: true, parentId: majorAId, counselorId: ca.user.id });
  classAId = tree.colleges[0].majors[0].classes[0].id;
  tree = await saveOrganization(collegeB, { kind: "class", code: "C", name: "同名班级", enabled: true, parentId: majorBId, counselorId: cb.user.id });
  classBId = tree.colleges[0].majors[0].classes[0].id;
  studentAId = (await createAccount(admin, { login: "org-student-A", name: "A学生", role: "STUDENT", classId: classAId })).user.id;
  studentBId = (await createAccount(admin, { login: "org-student-B", name: "B学生", role: "STUDENT", classId: classBId })).user.id;
});
afterAll(async () => db.$disconnect());

test("同名专业班级按稳定ID隔离，名录详情及筛选选项都不能跨院跨班", async () => {
  const a = await pageStudents(collegeA, {});
  expect(a.items.map(s => s.id)).toEqual([studentAId]);
  expect(a.scopeOptions.colleges).toEqual(["A学院"]);
  expect((await pageStudents(counselorA, {})).items.map(s => s.id)).toEqual([studentAId]);
  expect((await pageStudents(collegeA, { classId: classBId })).total).toBe(0);
  expect((await pageStudents(collegeA, { college: "B学院" })).total).toBe(0);
  await expect(readStudentProfile(collegeA, studentBId)).rejects.toThrow("权限范围");
  await expect(readStudentProfile(counselorB, studentAId)).rejects.toThrow("权限范围");
  const profile = await readStudentProfile(collegeA, studentAId);
  expect(profile.studentProfile!.schoolClass!.counselor!.id).toBe(counselorAId);
  expect(profile.affiliationHistory[0].classId).toBe(classAId);
  expect((await listOrganizations(counselorA)).colleges.map(c => c.id)).toEqual([collegeAId]);
});

test("角色和组织双重校验，越权维护及错误辅导员均零写入", async () => {
  await expect(saveOrganization(collegeA, { kind: "college", code: "BAD", name: "越权学院", enabled: true })).rejects.toThrow("学校管理员");
  await expect(saveOrganization(collegeA, { kind: "major", code: "BAD", name: "越权专业", enabled: true, parentId: collegeBId })).rejects.toThrow("其他学院");
  await expect(saveOrganization(collegeA, { kind: "class", code: "BAD", name: "错误辅导员", enabled: true, parentId: majorAId, counselorId: (await db.user.findUniqueOrThrow({ where: { login: "org-counselor-B" } })).id })).rejects.toThrow("本院启用");
  await expect(saveOrganization(counselorA, { kind: "class", code: "BAD", name: "越权班级", enabled: true, parentId: majorAId })).rejects.toThrow("管理权限");
  expect(await db.schoolClass.count({ where: { code: "BAD" } })).toBe(0);
  await expect(updateStudentProfile(collegeA, studentAId, { name: "A学生", classId: classBId, revision: 0, reason: "错误跨院转班" })).rejects.toThrow("其他学院");
  await expect(updateStudentProfile(counselorA, studentAId, { name: "A学生", classId: classAId, revision: 0, reason: "无权修改" })).rejects.toThrow("管理权限");
});

test("新学生不可使用缺辅导员、停用或自由文本归属，旧未绑定档案不自动扩大范围", async () => {
  const tree = await saveOrganization(collegeA, { kind: "class", code: "DRAFT", name: "待完善班", enabled: true, parentId: majorAId });
  const pending = tree.colleges[0].majors[0].classes.find(c => c.code === "DRAFT")!;
  await expect(createAccount(admin, { name: "未绑定", login: "org-no-counselor", role: "STUDENT", classId: pending.id })).rejects.toThrow("责任辅导员");
  await expect(createAccount(admin, { name: "伪造", login: "org-forged", role: "STUDENT", classId: classAId, college: "B学院" })).rejects.toThrow();
  const legacy = await db.user.create({ data: { login: "org-legacy", name: "旧档案", role: "STUDENT", passwordHash: "preserve-original-hash", studentProfile: { create: { studentNumber: "org-legacy", college: "A学院", major: "同名专业", className: "同名班级" } } } });
  expect((await pageStudents(collegeA, {})).items.some(s => s.id === legacy.id)).toBe(false);
  const kept = await updateAccount(admin, legacy.id, { revision: 0, reason: "暂时停用旧账号", disabled: true, account: { login: legacy.login, name: legacy.name, role: "STUDENT" } });
  expect(kept.studentProfile!.classId).toBeNull();
  expect((await db.user.findUniqueOrThrow({ where: { id: legacy.id } })).passwordHash).toBe("preserve-original-hash");
});

test("组织停用与辅导员身份变动必须先交接，旧revision并发只成功一次", async () => {
  const input = { kind: "class", id: classAId, parentId: majorAId, code: "C", name: "同名班级", enabled: false, revision: 0, reason: "尝试停用在读班级", counselorId: counselorAId };
  await expect(saveOrganization(collegeA, input)).rejects.toThrow("已有学生");
  await expect(saveOrganization(collegeA, { ...input, enabled: true, counselorId: null })).rejects.toThrow("先交接");
  await expect(updateAccount(admin, counselorAId, { revision: 0, reason: "直接停用", disabled: true, account: { name: "counselor-A", login: "org-counselor-A", role: "COUNSELOR", collegeId: collegeAId } })).rejects.toThrow("先交接");
  const results = await Promise.allSettled([saveOrganization(collegeA, { ...input, enabled: true, name: "新班名1" }), saveOrganization(collegeA, { ...input, enabled: true, name: "新班名2" })]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
  expect((await db.studentProfile.findUniqueOrThrow({ where: { userId: studentAId } })).className).toBe((await db.schoolClass.findUniqueOrThrow({ where: { id: classAId } })).name);
});

test("受控交接后当前名录更换负责人，责任区间保留，旧账号密码不变", async () => {
  const next = await identity("counselor-A2", "COUNSELOR", collegeAId);
  const previous = await db.schoolClass.findUniqueOrThrow({ where: { id: classAId } });
  await saveOrganization(collegeA, { kind: "class", id: classAId, parentId: majorAId, code: previous.code, name: previous.name, enabled: true, revision: previous.revision, reason: "辅导员正常工作交接", counselorId: next.user.id });
  expect((await pageStudents(counselorA, {})).total).toBe(0);
  expect((await pageStudents(next.session, {})).items.map(s => s.id)).toEqual([studentAId]);
  const history = await db.classCounselorAssignment.findMany({ where: { classId: classAId }, orderBy: { startedAt: "asc" } });
  expect(history).toHaveLength(2); expect(history[0].endedAt).not.toBeNull(); expect(history[1].endedAt).toBeNull();
  expect((await db.user.findUniqueOrThrow({ where: { id: counselorAId } })).passwordHash).toBe("organization-fixture-only");
});

test("账号导入必须完整匹配组织目录，组织变化使旧预览失效且零写入", async () => {
  const row = { login: "org-import-1", name: "导入学生", college: "B学院", major: "同名专业", className: "同名班级" };
  const bad = await previewAccountImport(admin, [row, { ...row, login: "org-import-2", major: "不存在专业" }]);
  expect(bad.errors).toBe(1);
  await expect(commitAccountImport(admin, bad.id)).rejects.toThrow("错误行");
  expect(await db.user.count({ where: { login: { in: ["org-import-1", "org-import-2"] } } })).toBe(0);
  const good = await previewAccountImport(admin, [row]);
  await saveOrganization(collegeB, { kind: "class", id: classBId, parentId: majorBId, code: "C", name: "变更后班级", enabled: true, revision: 0, reason: "班级名称更正" });
  await expect(commitAccountImport(admin, good.id)).rejects.toThrow("已变化");
  expect(await db.user.count({ where: { login: row.login } })).toBe(0);
});
