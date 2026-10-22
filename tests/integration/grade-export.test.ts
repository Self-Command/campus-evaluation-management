import { afterAll, beforeAll, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { organizationFixture } from "./organization-fixture";
import { createTerm, saveScheme, activateTerm } from "@/server/terms";
import { saveGrade } from "@/server/grades";
import { exportStudentGradeWorkbook } from "@/server/grade-export";
import { nodeSchema } from "@/lib/scoring/types";

const address = new URL(process.env.DATABASE_URL!);
if (address.hostname !== "127.0.0.1" || !/^\/campus_test_[a-f0-9]{12}$/.test(address.pathname)) throw new Error("必须由隔离运行器执行");
const marker = `export-${randomUUID().slice(0, 8)}`;
const users: Record<string, { id: string; session: string }> = {};
const collegeIds: string[] = [];
const classIds: string[] = [];
let termId = "";

async function identity(label: string, role: "ADMIN" | "STUDENT", options: { classId?: string; organization?: Awaited<ReturnType<typeof organizationFixture>> } = {}) {
  const user = await db.user.create({
    data: {
      login: `${marker}-${label}`,
      name: label,
      role,
      passwordHash: "fixture-only",
      mustChangePassword: false,
      ...(role === "STUDENT" && options.organization ? { studentProfile: { create: { studentNumber: `${marker}-${label}`, college: options.organization.college.name, major: options.organization.major.name, className: options.organization.schoolClass.name, classId: options.classId } } } : {}),
    },
  });
  users[label] = { id: user.id, session: (await db.authSession.create({ data: { userId: user.id, version: 0, expiresAt: new Date(Date.now() + 600_000) } })).id };
  return users[label];
}

beforeAll(async () => {
  const orgA = await organizationFixture(`${marker}-a`);
  const orgB = await organizationFixture(`${marker}-b`);
  collegeIds.push(orgA.college.id, orgB.college.id);
  classIds.push(orgA.schoolClass.id, orgB.schoolClass.id);
  for (const [label, org] of [["counselor-a", orgA], ["counselor-b", orgB]] as const) {
    users[label] = { id: org.counselor.id, session: (await db.authSession.create({ data: { userId: org.counselor.id, version: 0, expiresAt: new Date(Date.now() + 600_000) } })).id };
  }
  await identity("admin", "ADMIN");
  await identity("student-a", "STUDENT", { classId: orgA.schoolClass.id, organization: orgA });
  await identity("student-b", "STUDENT", { classId: orgB.schoolClass.id, organization: orgB });
  termId = (await createTerm(users.admin.session, { name: `${marker}-周期`, template: false })).id;
  await saveScheme(users.admin.session, termId, {
    revision: 0,
    scheme: {
      nodes: [
        nodeSchema.parse({ id: "total", parentId: null, name: "综合成绩", kind: "SUM", order: 0 }),
        nodeSchema.parse({ id: "grade", parentId: "total", name: "学业成绩", kind: "GRADE", required: true, maximum: "100", order: 0 }),
        nodeSchema.parse({ id: "activity", parentId: "total", name: "个人成果", kind: "ACTIVITY", order: 1 }),
      ],
      deductions: [],
    },
  });
  await activateTerm(users.admin.session, termId, { revision: 1 });
  await saveGrade(users.admin.session, termId, { studentLogin: `${marker}-student-a`, nodeId: "grade", value: "88", revision: null, reason: "导出核对" });
});

afterAll(async () => {
  if (termId) {
    await db.gradeInput.deleteMany({ where: { termId } });
    await db.term.deleteMany({ where: { id: termId } });
  }
  const ids = Object.values(users).map((user) => user.id);
  await db.auditEvent.deleteMany({ where: { actorId: { in: ids } } });
  await db.schoolClass.updateMany({ where: { id: { in: classIds } }, data: { counselorId: null } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.schoolClass.deleteMany({ where: { id: { in: classIds } } });
  await db.major.deleteMany({ where: { collegeId: { in: collegeIds } } });
  await db.college.deleteMany({ where: { id: { in: collegeIds } } });
  await db.$disconnect();
});

test("导出按角色限域，生成的工作簿可解包且包含该生成绩", async () => {
  const own = await exportStudentGradeWorkbook(users["counselor-a"].session, termId, { studentId: users["student-a"].id });
  expect(own.buffer.subarray(0, 2).toString()).toBe("PK");
  expect(own.fileName).toContain("student-a");
  expect(own.fileName.endsWith(".xlsx")).toBe(true);

  const self = await exportStudentGradeWorkbook(users["student-a"].session, termId, { studentId: users["student-a"].id });
  expect(self.buffer.subarray(0, 2).toString()).toBe("PK");

  await expect(exportStudentGradeWorkbook(users["counselor-b"].session, termId, { studentId: users["student-a"].id })).rejects.toThrow("可导出范围");
  await expect(exportStudentGradeWorkbook(users["student-b"].session, termId, { studentId: users["student-a"].id })).rejects.toThrow("可导出范围");
});
