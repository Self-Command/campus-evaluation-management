import { afterAll, beforeAll, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { organizationFixture } from "./organization-fixture";
import { createTerm, saveScheme, activateTerm } from "@/server/terms";
import { saveGrade } from "@/server/grades";
import { getStudentResult } from "@/server/results";
import { nodeSchema } from "@/lib/scoring/types";
import {
  submitGradeChange, changeGradeChange, readGradeQueue, readGradeRoster, readGradeDetail,
} from "@/server/grade-changes";
import {
  submitDeductionChange, changeDeductionChange, readDeductionQueue, readDeductionRoster, readDeductionDetail,
} from "@/server/deduction-changes";

const address = new URL(process.env.DATABASE_URL!);
if (address.hostname !== "127.0.0.1" || !/^\/campus_test_[a-f0-9]{12}$/.test(address.pathname)) throw new Error("必须由隔离运行器执行");
const marker = `input-${randomUUID().slice(0, 8)}`;
const users: Record<string, { id: string; session: string }> = {};
const collegeIds: string[] = [];
const classIds: string[] = [];
let termId = "";
let organizationA: Awaited<ReturnType<typeof organizationFixture>>;
let organizationB: Awaited<ReturnType<typeof organizationFixture>>;

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
  organizationA = await organizationFixture(`${marker}-a`, { college: "经济学院", major: "经济学", className: "经济一班" });
  organizationB = await organizationFixture(`${marker}-b`, { college: "法学院", major: "法学", className: "法学一班" });
  collegeIds.push(organizationA.college.id, organizationB.college.id);
  classIds.push(organizationA.schoolClass.id, organizationB.schoolClass.id);
  for (const [label, organization] of [["counselor-a", organizationA], ["counselor-b", organizationB]] as const) users[label] = { id: organization.counselor.id, session: (await db.authSession.create({ data: { userId: organization.counselor.id, version: 0, expiresAt: new Date(Date.now() + 600_000) } })).id };
  await identity("admin", "ADMIN");
  await identity("college-a", "COLLEGE", { collegeId: organizationA.college.id });
  await identity("college-b", "COLLEGE", { collegeId: organizationB.college.id });
  await identity("student-a", "STUDENT", { classId: organizationA.schoolClass.id, organization: organizationA });
  await identity("student-b", "STUDENT", { classId: organizationB.schoolClass.id, organization: organizationB });
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
});

afterAll(async () => {
  if (termId) {
    await db.gradeChange.deleteMany({ where: { termId } });
    await db.deductionChange.deleteMany({ where: { termId } });
    await db.gradeInput.deleteMany({ where: { termId } });
    await db.deductionInput.deleteMany({ where: { termId } });
    await db.gradeImport.deleteMany({ where: { termId } });
    await db.term.deleteMany({ where: { id: termId } });
  }
  const ids = Object.values(users).map(user => user.id);
  await db.auditEvent.deleteMany({ where: { actorId: { in: ids } } });
  await db.schoolClass.updateMany({ where: { id: { in: classIds } }, data: { counselorId: null } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.schoolClass.deleteMany({ where: { id: { in: classIds } } });
  await db.major.deleteMany({ where: { collegeId: { in: collegeIds } } });
  await db.college.deleteMany({ where: { id: { in: collegeIds } } });
  await db.$disconnect();
});

const grade = (studentId: string, value: string, requestId = randomUUID()) => ({ studentId, nodeId: "grade", value, reason: "核对原始成绩单后更正", requestId });

test("GRD-01：辅导员提交成绩修订，学院通过前不影响有效成绩与总分", async () => {
  const submitted = await submitGradeChange(users["counselor-a"].session, termId, grade(users["student-a"].id, "80"));
  expect(submitted.status).toBe("PENDING_COLLEGE");
  expect(submitted.baseValue).toBeNull();
  const detail = await readGradeDetail(users["counselor-a"].session, termId, users["student-a"].id);
  expect(detail.nodes.find(node => node.id === "grade")?.input).toBeNull();
  expect(detail.nodes.find(node => node.id === "grade")?.change?.value).toBe("80");
  expect(await db.gradeInput.count({ where: { termId, studentId: users["student-a"].id } })).toBe(0);
  expect((await getStudentResult(users["student-a"].session, termId)).result.total).toBeNull();
  await expect(changeGradeChange(users["counselor-a"].session, termId, submitted.id, { revision: 0, action: "approve", reason: "辅导员自审" })).rejects.toThrow("只有学院可以审核成绩");
  await expect(changeGradeChange(users["college-b"].session, termId, submitted.id, { revision: 0, action: "approve", reason: "跨院审核" })).rejects.toThrow("只能处理本院学生");
  await expect(changeGradeChange(users.admin.session, termId, submitted.id, { revision: 0, action: "approve", reason: "管理员代审" })).rejects.toThrow("没有操作权限");
  const queue = await readGradeQueue(users["college-a"].session, termId, {});
  expect(queue.items.map(item => item.id)).toContain(submitted.id);
  expect(queue.stats.pending).toBe(1);
  expect((await readGradeQueue(users["college-b"].session, termId, {})).total).toBe(0);
  const roster = await readGradeRoster(users["counselor-a"].session, termId, {});
  expect(roster.items.find(item => item.id === users["student-a"].id)?.pending).toBe(1);
  const before = (await db.term.findUniqueOrThrow({ where: { id: termId } })).inputRevision;
  const approved = await changeGradeChange(users["college-a"].session, termId, submitted.id, { revision: 0, action: "approve", reason: "与原始成绩单一致" });
  expect(approved.status).toBe("APPROVED");
  const saved = await db.gradeInput.findUniqueOrThrow({ where: { termId_studentId_nodeId: { termId, studentId: users["student-a"].id, nodeId: "grade" } } });
  expect(saved.value.toFixed()).toBe("80");
  expect((await db.term.findUniqueOrThrow({ where: { id: termId } })).inputRevision).toBe(before + 1);
  expect((await getStudentResult(users["student-a"].session, termId)).result.total).toBe("80.00");
  await expect(changeGradeChange(users["college-a"].session, termId, submitted.id, { revision: 1, action: "approve", reason: "重复批准" })).rejects.toThrow("仅待学院审核");
});

test("GRD-02：退回必填理由并交原辅导员修正重提，重提后重新进入待审", async () => {
  const submitted = await submitGradeChange(users["counselor-a"].session, termId, grade(users["student-a"].id, "85"));
  await expect(changeGradeChange(users["college-a"].session, termId, submitted.id, { revision: 0, action: "return" })).rejects.toThrow("请填写退回理由");
  const sentBack = await changeGradeChange(users["college-a"].session, termId, submitted.id, { revision: 0, action: "return", reason: "请附原始成绩单截图" });
  expect(sentBack.status).toBe("RETURNED");
  await expect(changeGradeChange(users["counselor-b"].session, termId, submitted.id, { revision: 1, action: "resubmit", value: "86", reason: "他人代改" })).rejects.toThrow("只能处理本人负责班级的学生");
  await expect(changeGradeChange(users["counselor-a"].session, termId, submitted.id, { revision: 1, action: "resubmit", value: "101", reason: "超出范围" })).rejects.toThrow("范围");
  const resent = await changeGradeChange(users["counselor-a"].session, termId, submitted.id, { revision: 1, action: "resubmit", value: "86", reason: "已附成绩单" });
  expect(resent.status).toBe("PENDING_COLLEGE");
  expect(resent.baseValue?.toFixed()).toBe("80");
  expect(resent.history).toHaveLength(3);
  const approved = await changeGradeChange(users["college-a"].session, termId, submitted.id, { revision: 2, action: "approve" });
  expect(approved.status).toBe("APPROVED");
  const saved = await db.gradeInput.findUniqueOrThrow({ where: { termId_studentId_nodeId: { termId, studentId: users["student-a"].id, nodeId: "grade" } } });
  expect(saved.value.toFixed()).toBe("86");
  expect(saved.revision).toBe(1);
  expect((await getStudentResult(users["student-a"].session, termId)).result.total).toBe("86.00");
});

test("GRD-03：同项只能有一个待审修订，重复请求重放，有效值变化后旧修订不得静默覆盖", async () => {
  const requestId = randomUUID();
  const first = await submitGradeChange(users["counselor-a"].session, termId, grade(users["student-a"].id, "90", requestId));
  const replay = await submitGradeChange(users["counselor-a"].session, termId, grade(users["student-a"].id, "90", requestId));
  expect(replay.id).toBe(first.id);
  await expect(submitGradeChange(users["counselor-a"].session, termId, grade(users["student-a"].id, "91"))).rejects.toThrow("已有待审或退回修改中的修订");
  await expect(submitGradeChange(users["counselor-b"].session, termId, grade(users["student-a"].id, "70"))).rejects.toThrow("只能处理本人负责班级的学生");
  await expect(submitGradeChange(users["college-a"].session, termId, grade(users["student-a"].id, "70"))).rejects.toThrow("没有操作权限");
  // An administrator exception correction lands between submission and review.
  await saveGrade(users.admin.session, termId, { studentLogin: `${marker}-student-a`, nodeId: "grade", value: "88", revision: 1, reason: "原始成绩单存在录入系统错误" });
  await expect(changeGradeChange(users["college-a"].session, termId, first.id, { revision: 0, action: "approve", reason: "按旧值批准" })).rejects.toThrow("有效值已变化");
  const detail = await readGradeDetail(users["college-a"].session, termId, users["student-a"].id);
  expect(detail.changes.find(change => change.id === first.id)?.status).toBe("PENDING_COLLEGE");
  const abandon = await changeGradeChange(users["counselor-a"].session, termId, first.id, { revision: 0, action: "abandon", reason: "改为按管理员更正结果处理" });
  expect(abandon.status).toBe("ABANDONED");
  expect((await db.gradeInput.findUniqueOrThrow({ where: { termId_studentId_nodeId: { termId, studentId: users["student-a"].id, nodeId: "grade" } } })).value.toFixed()).toBe("88");
  await expect(submitGradeChange(users["counselor-a"].session, termId, grade(users["student-a"].id, "88"))).rejects.toThrow("与当前有效成绩相同");
  expect((await readGradeDetail(users["counselor-a"].session, termId, users["student-a"].id)).canSubmit).toBe(true);
  await expect(readGradeDetail(users["college-b"].session, termId, users["student-a"].id)).rejects.toThrow("只能处理本院学生");
});

test("DED-01：扣分按独立事件提交与累计，待审不计分，学院通过后生效", async () => {
  const submitted = await submitDeductionChange(users["counselor-a"].session, termId, { studentId: users["student-a"].id, projectId: "discipline", action: "CREATE", amount: "3", reason: "夜不归宿一次", requestId: randomUUID() });
  expect(submitted.status).toBe("PENDING_COLLEGE");
  expect(submitted.amount?.toFixed()).toBe("3");
  expect(await db.deductionInput.count({ where: { termId, studentId: users["student-a"].id } })).toBe(0);
  expect((await getStudentResult(users["student-a"].session, termId)).result.total).toBe("88.00");
  const before = (await db.term.findUniqueOrThrow({ where: { id: termId } })).inputRevision;
  await changeDeductionChange(users["college-a"].session, termId, submitted.id, { revision: 0, action: "approve", reason: "违纪事实清楚" });
  expect((await db.term.findUniqueOrThrow({ where: { id: termId } })).inputRevision).toBe(before + 1);
 expect((await getStudentResult(users["student-a"].session, termId)).result.total).toBe("85.00");
  const catalog = await readDeductionDetail(users["counselor-a"].session, termId, users["student-a"].id);
  expect(catalog.events.map(event => [event.occurrence, event.amount])).toEqual([[0, "3"]]);
  expect(catalog.events[0].coefficient).toBe("1");
  // A second incident on the same project is a separate event, not an overwrite.
  const second = await submitDeductionChange(users["counselor-a"].session, termId, { studentId: users["student-a"].id, projectId: "discipline", action: "CREATE", amount: "2", reason: "宿舍违规电器", requestId: randomUUID() });
  await changeDeductionChange(users["college-a"].session, termId, second.id, { revision: 0, action: "approve" });
  const events = (await readDeductionDetail(users["counselor-a"].session, termId, users["student-a"].id)).events;
  expect(events.map(event => [event.occurrence, event.amount])).toEqual([[0, "3"], [1, "2"]]);
  expect((await getStudentResult(users["student-a"].session, termId)).result.total).toBe("83.00");
  const roster = await readDeductionRoster(users["college-a"].session, termId, {});
  expect(roster.items.find(item => item.id === users["student-a"].id)?.events).toBe(2);
  expect(roster.stats.events).toBe(2);
  await expect(submitDeductionChange(users["counselor-a"].session, termId, { studentId: users["student-a"].id, projectId: "discipline", action: "CREATE", amount: "0", reason: "非法分值", requestId: randomUUID() })).rejects.toThrow("扣分额必须为正数");
  await expect(submitDeductionChange(users["counselor-b"].session, termId, { studentId: users["student-a"].id, projectId: "discipline", action: "CREATE", amount: "1", reason: "跨班登记", requestId: randomUUID() })).rejects.toThrow("只能处理本人负责班级的学生");
});

test("DED-02：撤销需学院审核并校验目标版本，退回修正后重提，重复撤销受控", async () => {
  const [first, second] = (await readDeductionDetail(users["counselor-a"].session, termId, users["student-a"].id)).events;
  const requestId = randomUUID();
  const revoke = await submitDeductionChange(users["counselor-a"].session, termId, { studentId: users["student-a"].id, projectId: "discipline", action: "REVOKE", targetInputId: first.id, targetRevision: first.revision, reason: "重复登记同一事件", requestId });
  const replay = await submitDeductionChange(users["counselor-a"].session, termId, { studentId: users["student-a"].id, projectId: "discipline", action: "REVOKE", targetInputId: first.id, targetRevision: first.revision, reason: "重复登记同一事件", requestId });
  expect(replay.id).toBe(revoke.id);
  await expect(submitDeductionChange(users["counselor-a"].session, termId, { studentId: users["student-a"].id, projectId: "discipline", action: "REVOKE", targetInputId: first.id, targetRevision: first.revision, reason: "第二次撤销", requestId: randomUUID() })).rejects.toThrow("已有待审或退回修改中的撤销申请");
  await expect(submitDeductionChange(users["counselor-a"].session, termId, { studentId: users["student-a"].id, projectId: "discipline", action: "REVOKE", targetInputId: second.id, targetRevision: 99, reason: "过期版本", requestId: randomUUID() })).rejects.toThrow("扣分事件已变化");
  await changeDeductionChange(users["college-a"].session, termId, revoke.id, { revision: 0, action: "return", reason: "请说明重复登记依据" });
  const resent = await changeDeductionChange(users["counselor-a"].session, termId, revoke.id, { revision: 1, action: "resubmit", reason: "学院原始扣分单已核对为重复" });
  expect(resent.status).toBe("PENDING_COLLEGE");
  await changeDeductionChange(users["college-a"].session, termId, revoke.id, { revision: 2, action: "approve", reason: "确为重复登记" });
  const events = (await readDeductionDetail(users["counselor-a"].session, termId, users["student-a"].id)).events;
  expect(events.find(event => event.id === first.id)?.revoked).toBe(true);
  expect((await getStudentResult(users["student-a"].session, termId)).result.total).toBe("86.00");
  await expect(submitDeductionChange(users["counselor-a"].session, termId, { studentId: users["student-a"].id, projectId: "discipline", action: "REVOKE", targetInputId: first.id, targetRevision: events.find(event => event.id === first.id)!.revision, reason: "再次撤销", requestId: randomUUID() })).rejects.toThrow("已撤销");
  const queue = await readDeductionQueue(users["college-b"].session, termId, {});
  expect(queue.total).toBe(0);
});

test("SCOPE-01：非进行阶段拒绝提交，名录与队列按本人范围返回", async () => {
  await db.term.update({ where: { id: termId }, data: { phase: "CHECKING" } });
  await expect(submitGradeChange(users["counselor-a"].session, termId, grade(users["student-a"].id, "70"))).rejects.toThrow("当前学期阶段不允许此操作");
  await expect(submitDeductionChange(users["counselor-a"].session, termId, { studentId: users["student-a"].id, projectId: "discipline", action: "CREATE", amount: "1", reason: "核对阶段写入", requestId: randomUUID() })).rejects.toThrow("当前学期阶段不允许此操作");
  await db.term.update({ where: { id: termId }, data: { phase: "ACTIVE" } });
  const counselorRoster = await readGradeRoster(users["counselor-a"].session, termId, {});
  expect(counselorRoster.items.map(item => item.id)).toEqual([users["student-a"].id]);
  const counselorB = await readGradeRoster(users["counselor-b"].session, termId, {});
  expect(counselorB.items.map(item => item.id)).toEqual([users["student-b"].id]);
  const adminRoster = await readGradeRoster(users["admin"].session, termId, { q: marker });
  expect(adminRoster.total).toBe(2);
  expect(adminRoster.canCorrect).toBe(true);
  expect(counselorRoster.canSubmit).toBe(true);
  expect((await readGradeRoster(users["college-a"].session, termId, {})).canReview).toBe(true);
});
