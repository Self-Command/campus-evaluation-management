import { afterAll, beforeAll, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { getWorkbench } from "@/server/workbench";
import { createTerm, saveScheme, activateTerm } from "@/server/terms";
import { nodeSchema } from "@/lib/scoring/types";
import { organizationFixture } from "./organization-fixture";

const database = new URL(process.env.DATABASE_URL!);
if (database.hostname !== "127.0.0.1" || !/^\/campus_test_[a-f0-9]+$/.test(database.pathname)) throw new Error("必须使用项目隔离数据库运行器");
const marker = `staff-${randomUUID().slice(0, 8)}`;
const users: Record<string, { id: string; session: string }> = {};
const organizationIds: { collegeIds: string[]; majorIds: string[]; classIds: string[] } = { collegeIds: [], majorIds: [], classIds: [] };
let termId = "";
let activityId = "";

async function identity(label: string, role: "ADMIN" | "COLLEGE" | "STUDENT", options: { collegeId?: string; classId?: string; organization?: Awaited<ReturnType<typeof organizationFixture>> } = {}) {
  const user = await db.user.create({
    data: {
      login: `${marker}-${label}`,
      name: label,
      role,
      collegeId: options.collegeId,
      passwordHash: "fixture-only",
      mustChangePassword: false,
      ...(role === "STUDENT" && options.organization ? { studentProfile: { create: { studentNumber: `${marker}-${label}`, college: options.organization.college.name, major: options.organization.major.name, className: options.organization.schoolClass.name, classId: options.classId } } } : {}),
    },
  });
  users[label] = { id: user.id, session: (await db.authSession.create({ data: { userId: user.id, version: 0, expiresAt: new Date(Date.now() + 600_000) } })).id };
  return users[label];
}

beforeAll(async () => {
  const a = await organizationFixture(`${marker}-a`, { college: "智能制造学院", major: "机械工程", className: "机电2401班" });
  const b = await organizationFixture(`${marker}-b`, { college: "经济管理学院", major: "会计学", className: "会计2401班" });
  organizationIds.collegeIds.push(a.college.id, b.college.id);
  organizationIds.majorIds.push(a.major.id, b.major.id);
  organizationIds.classIds.push(a.schoolClass.id, b.schoolClass.id);
  users["counselor-a"] = { id: a.counselor.id, session: (await db.authSession.create({ data: { userId: a.counselor.id, version: 0, expiresAt: new Date(Date.now() + 600_000) } })).id };
  users["counselor-b"] = { id: b.counselor.id, session: (await db.authSession.create({ data: { userId: b.counselor.id, version: 0, expiresAt: new Date(Date.now() + 600_000) } })).id };
  await identity("admin", "ADMIN");
  await identity("college-a", "COLLEGE", { collegeId: a.college.id });
  await identity("college-b", "COLLEGE", { collegeId: b.college.id });
  await identity("student-a1", "STUDENT", { classId: a.schoolClass.id, organization: a });
  await identity("student-a2", "STUDENT", { classId: a.schoolClass.id, organization: a });
  await identity("student-b1", "STUDENT", { classId: b.schoolClass.id, organization: b });
  termId = (await createTerm(users.admin.session, { name: `${marker}-周期`, template: false })).id;
  await saveScheme(users.admin.session, termId, {
    revision: 0,
    scheme: {
      nodes: [
        nodeSchema.parse({ id: "total", parentId: null, name: "综合成绩", kind: "SUM", order: 0 }),
        nodeSchema.parse({ id: "grade", parentId: "total", name: "学业成绩", kind: "GRADE", required: true, maximum: "100", order: 0 }),
        nodeSchema.parse({ id: "activity", parentId: "total", name: "个人成果", kind: "ACTIVITY", order: 1 }),
      ],
      deductions: [{ id: "discipline", name: "纪律扣分", nodeId: "total", coefficient: "1" }],
    },
  });
  await activateTerm(users.admin.session, termId, { revision: 1 });
  const activity = await db.activity.create({
    data: {
      termId, ownerId: users["college-a"].id, collegeId: a.college.id, name: `${marker}-红色文化实践`, organizer: "智能制造学院",
      content: "实践活动", startsAt: new Date(Date.now() - 3_600_000), endsAt: new Date(Date.now() + 86_400_000),
      nodeId: "activity", points: "5", confirmed: true, publishedAt: new Date(),
    },
  });
  activityId = activity.id;
  const fact = await db.participation.create({ data: { activityId, studentId: users["student-a1"].id } });
  await db.recognitionSource.createMany({ data: [
    { participationId: fact.id, submitterId: users["student-a1"].id, status: "PENDING_COUNSELOR", note: "本人参与材料" },
    { participationId: fact.id, submitterId: users["student-a1"].id, status: "PENDING_COLLEGE", note: "辅导员已核对" },
  ] });
  await db.personalClaim.create({ data: { termId, studentId: users["student-a2"].id, title: `${marker}-校级竞赛`, occurredOn: "2026-10-01", note: "二等奖", status: "PENDING_COUNSELOR" } });
  await db.personalClaim.create({ data: { termId, studentId: users["student-a2"].id, title: `${marker}-已评分待终审`, occurredOn: "2026-09-20", note: "辅导员已评分", status: "PENDING_COLLEGE" } });
  await db.personalClaim.create({ data: { termId, studentId: users["student-b1"].id, title: `${marker}-他院成果`, occurredOn: "2026-10-01", note: "不应出现在本院", status: "PENDING_COUNSELOR" } });
  await db.gradeInput.create({ data: { termId, studentId: users["student-a1"].id, nodeId: "grade", value: "88" } });
  await db.gradeChange.create({ data: { termId, studentId: users["student-a1"].id, nodeId: "grade", value: "90", baseValue: "88", reason: "补录", status: "PENDING_COLLEGE", requestId: `${marker}-g1`, submittedBy: users["counselor-a"].id } });
  await db.deductionChange.create({ data: { termId, studentId: users["student-a2"].id, projectId: "discipline", action: "CREATE", amount: "1", reason: "迟到", status: "PENDING_COLLEGE", requestId: `${marker}-d1`, submittedBy: users["counselor-a"].id } });
});

afterAll(async () => {
  if (termId) {
    await db.gradeChange.deleteMany({ where: { termId } });
    await db.deductionChange.deleteMany({ where: { termId } });
    await db.gradeInput.deleteMany({ where: { termId } });
    await db.personalClaim.deleteMany({ where: { termId } });
    if (activityId) {
      await db.recognitionSource.deleteMany({ where: { participation: { activityId } } });
      await db.participation.deleteMany({ where: { activityId } });
      await db.activity.deleteMany({ where: { id: activityId } });
    }
    await db.term.deleteMany({ where: { id: termId } });
  }
  const ids = Object.values(users).map(row => row.id);
  await db.auditEvent.deleteMany({ where: { actorId: { in: ids } } });
  await db.schoolClass.updateMany({ where: { id: { in: organizationIds.classIds } }, data: { counselorId: null } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.schoolClass.deleteMany({ where: { id: { in: organizationIds.classIds } } });
  await db.major.deleteMany({ where: { id: { in: organizationIds.majorIds } } });
  await db.college.deleteMany({ where: { id: { in: organizationIds.collegeIds } } });
  await db.$disconnect();
});

test("辅导员工作台只统计负责班级的待办、成绩录入完成度和被退回事项", async () => {
  const data = await getWorkbench(users["counselor-a"].session, termId);
  expect(data.role).toBe("COUNSELOR");
  if (data.role !== "COUNSELOR") throw new Error("应为辅导员工作台");
  expect(data.stats.classes).toBe(1);
  expect(data.stats.students).toBe(2);
  expect(data.stats.pendingRecognitions).toBe(1);
  expect(data.stats.pendingClaims).toBe(1);
  expect(data.stats.returnedChanges).toBe(0);
  expect(data.stats.gradeIncomplete).toBe(1);
  expect(data.classes[0].gradeComplete).toBe(1);
  expect(data.classes[0].pendingRecognitions).toBe(1);
  expect(data.classes[0].pendingClaims).toBe(1);
  expect(data.todos.map(row => row.kind).sort()).toEqual(["ACTIVITY", "CLAIM"]);
  expect(JSON.stringify(data)).not.toContain("他院成果");
  expect(data).not.toHaveProperty("activities");
});

test("学院工作台汇总本院四类待审与待导入名单活动，不越界到其他学院", async () => {
  const data = await getWorkbench(users["college-a"].session, termId);
  expect(data.role).toBe("COLLEGE");
  if (data.role !== "COLLEGE") throw new Error("应为学院工作台");
  expect(data.stats.classes).toBe(1);
  expect(data.stats.students).toBe(2);
  expect(data.stats.pendingRecognitions).toBe(1);
  expect(data.stats.pendingClaims).toBe(1);
  expect(data.stats.pendingGradeChanges).toBe(1);
  expect(data.stats.pendingDeductionChanges).toBe(1);
  expect(data.stats.awaitingRoster).toBe(1);
  expect(data.stats.gradeIncomplete).toBe(1);
  expect(data.activities.map(row => row.id)).toEqual([activityId]);
  expect(data.classes[0].pendingGradeChanges).toBe(1);
  expect(data.todos.map(row => row.kind).sort()).toEqual(["ACTIVITY", "CLAIM", "DEDUCTION", "GRADE"]);
  expect(JSON.stringify(data)).not.toContain("他院成果");
  const other = await getWorkbench(users["college-b"].session, termId);
  if (other.role !== "COLLEGE") throw new Error("应为学院工作台");
  expect(other.stats.students).toBe(1);
  expect(other.stats.pendingClaims).toBe(0);
  expect(other.stats.pendingRecognitions).toBe(0);
  expect(other.stats.pendingGradeChanges).toBe(0);
  expect(other.stats.awaitingRoster).toBe(0);
  expect(other.activities).toEqual([]);
});

test("没有测评周期时不报错，也不返回其他学院数据", async () => {
  const data = await getWorkbench(users["counselor-a"].session);
  expect(data.role).toBe("COUNSELOR");
  if (data.role !== "COUNSELOR") throw new Error("应为辅导员工作台");
  expect(data.term).toBeNull();
  expect(data.todos).toEqual([]);
  expect(data.classes).toEqual([]);
});
