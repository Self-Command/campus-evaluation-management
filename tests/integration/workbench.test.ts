import { beforeAll, afterAll, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { getWorkbench } from "@/server/workbench";
import { createTerm, activateTerm } from "@/server/terms";
import { previewPublication, publishResults, confirmResult } from "@/server/publications";
import { getStudentResult } from "@/server/results";

const database = new URL(process.env.DATABASE_URL!);
if (database.hostname !== "127.0.0.1" || !/^\/campus_test_[a-f0-9]+$/.test(database.pathname)) throw new Error("必须使用项目隔离数据库运行器");
const marker = `workbench-${randomUUID().slice(0, 8)}`;
const users: Record<string, { id: string; session: string }> = {};
const termIds: string[] = [];
let selectedTerm: string, privateActivity: string, otherActivity: string, claim: string;
beforeAll(async () => {
  for (const [key, role] of [["admin", "ADMIN"], ["publisher", "PUBLISHER"], ["otherPublisher", "PUBLISHER"], ["student", "STUDENT"], ["otherStudent", "STUDENT"]] as const) {
    const user = await db.user.create({ data: { login: `${marker}-${key}`, name: `${marker}-${key}`, role, passwordHash: "not-a-login-secret", mustChangePassword: false, ...(role === "STUDENT" ? { studentProfile: { create: { studentNumber: `${marker}-${key}`, college: "工作台学院", major: "工作台专业", className: "原班级" } } } : {}) } });
    const session = await db.authSession.create({ data: { userId: user.id, version: 0, expiresAt: new Date(Date.now() + 600_000) } });
    users[key] = { id: user.id, session: session.id };
  }
  const term = await createTerm(users.admin.session, { name: `${marker}-选中周期`, template: false });
  termIds.push(term.id); selectedTerm = term.id;
  await activateTerm(users.admin.session, term.id, { revision: 0 });
  const otherTerm = await createTerm(users.admin.session, { name: `${marker}-其他周期`, template: false }); termIds.push(otherTerm.id);
  const common = { termId: term.id, organizer: "活动组织", content: "真实活动内容", requirements: "参加要求", startsAt: new Date(Date.now() - 3600_000), endsAt: new Date(Date.now() + 86400_000), nodeId: "total", points: "5", confirmed: true };
  const own = await db.activity.create({ data: { ...common, name: `${marker}-本人负责活动`, ownerId: users.publisher.id } }); privateActivity = own.id;
  const other = await db.activity.create({ data: { ...common, name: `${marker}-他人负责活动`, ownerId: users.otherPublisher.id } }); otherActivity = other.id;
  await db.activity.create({ data: { ...common, name: `${marker}-未确认活动`, ownerId: users.publisher.id, confirmed: false } });
  await db.activity.create({ data: { ...common, name: `${marker}-其他周期活动`, ownerId: users.publisher.id, termId: otherTerm.id } });
  const fact = await db.participation.create({ data: { activityId: own.id, studentId: users.student.id } });
  await db.recognitionSource.createMany({ data: [
    { participationId: fact.id, submitterId: users.publisher.id, status: "APPROVED", note: "组织认定" },
    { participationId: fact.id, submitterId: users.student.id, status: "APPROVED", note: "本人材料" },
    { participationId: fact.id, submitterId: users.student.id, status: "PENDING_COUNSELOR", note: "另项待审材料" },
    { participationId: fact.id, submitterId: users.publisher.id, status: "RETURNED", note: "组织需补材料", reviewReason: "组织证明须补充" },
    { participationId: fact.id, submitterId: users.student.id, status: "RETURNED", note: "本人需补材料", reviewReason: "本人证明须补充" },
  ] });
  const otherFact = await db.participation.create({ data: { activityId: other.id, studentId: users.otherStudent.id } });
  await db.recognitionSource.create({ data: { participationId: otherFact.id, submitterId: users.otherPublisher.id, status: "REJECTED", note: "不应向另一个发布者或学生展示", reviewReason: `${marker}-他人私有理由` } });
  claim = (await db.personalClaim.create({ data: { termId: term.id, studentId: users.student.id, title: `${marker}-个人成果`, occurredOn: "2026-10-01", note: "本人成果", status: "RETURNED", reviewReason: "成果须补证明" } })).id;
  await db.personalClaim.create({ data: { termId: term.id, studentId: users.otherStudent.id, title: `${marker}-他人成果`, occurredOn: "2026-10-01", note: `${marker}-他人申报`, status: "PENDING_COUNSELOR" } });
});
afterAll(async () => {
  // All cleanup is restricted to fixture IDs created by this suite, including partial setup.
  for (const termId of termIds) {
    await db.appealEvidence.deleteMany({ where: { appeal: { termId } } });
    await db.resultAppeal.deleteMany({ where: { termId } });
    await db.resultConfirmation.deleteMany({ where: { result: { publication: { termId } } } });
    await db.publishedResult.deleteMany({ where: { publication: { termId } } });
    await db.settlementSnapshot.deleteMany({ where: { termId } });
    await db.termReopen.deleteMany({ where: { termId } });
    await db.resultPublication.deleteMany({ where: { termId } });
    await db.claimEvidence.deleteMany({ where: { claim: { termId } } });
    await db.personalClaim.deleteMany({ where: { termId } });
    await db.recognitionProject.deleteMany({ where: { termId } });
    await db.evidenceReference.deleteMany({ where: { source: { participation: { activity: { termId } } } } });
    await db.recognitionSource.deleteMany({ where: { participation: { activity: { termId } } } });
    await db.participation.deleteMany({ where: { activity: { termId } } });
    await db.activity.deleteMany({ where: { termId } });
    await db.term.delete({ where: { id: termId } });
  }
  const ids = Object.values(users).map(row => row.id);
  await db.auditEvent.deleteMany({ where: { actorId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
});

test("管理工作台显示当前周期全局待审、发布者只显示本人活动与本人待补", async () => {
  const admin = await getWorkbench(users.admin.session, selectedTerm);
  expect(admin.role).toBe("ADMIN"); if (admin.role !== "ADMIN") throw new Error("应为管理员工作台");
  expect(admin.stats.pendingRecognitions).toBe(1); expect(admin.stats.pendingClaims).toBe(1);
  expect(admin.stats.unconfirmedActivities).toBe(1);
  expect(admin.reviewQueue.map(row => row.kind).sort()).toEqual(["ACTIVITY", "CLAIM"]);
  const publisher = await getWorkbench(users.publisher.session, selectedTerm);
  expect(publisher.role).toBe("PUBLISHER"); if (publisher.role !== "PUBLISHER") throw new Error("应为发布者工作台");
  expect(publisher.stats.activities).toBe(2); expect(publisher.stats.pendingRecognitions).toBe(1);
  expect(publisher.stats.approvedRecognitions).toBe(1); expect(publisher.stats.needsChanges).toBe(2);
  expect(publisher.activities.find(row => row.id === privateActivity)?.approvedCount).toBe(1);
  expect(publisher.activities.some(row => row.id === otherActivity)).toBe(false);
  expect(publisher.followUps.map(row => row.description).sort()).toEqual(["本人证明须补充", "组织证明须补充"].sort());
  expect(JSON.stringify(publisher)).not.toContain("他人私有理由");
  expect(publisher).not.toHaveProperty("reviewQueue"); expect(publisher).not.toHaveProperty("outcome");
  expect(JSON.stringify(publisher)).not.toContain("passwordHash");
});

test("学生工作台只含本人事项，重复通过来源只计一个有效参与事实", async () => {
  const data = await getWorkbench(users.student.session, selectedTerm);
  expect(data.role).toBe("STUDENT"); if (data.role !== "STUDENT") throw new Error("应为学生工作台");
  expect(data.outcome.state).toBe("ACTIVE"); expect(data.outcome.total).toBe("5.00");
  expect(data.stats.approvedRecognitions).toBe(1); expect(data.stats.pendingRecognitions).toBe(1);
  expect(data.stats.needsChanges).toBe(3); expect(data.stats.pendingClaims).toBe(0);
  expect(data.followUps.map(row => row.description).sort()).toEqual(["本人证明须补充", "组织证明须补充", "成果须补证明"].sort());
  expect(data.opportunities.every(row => !row.name.includes("未确认") && !row.name.includes("其他周期"))).toBe(true);
  expect(JSON.stringify(data)).not.toContain("他人私有理由"); expect(JSON.stringify(data)).not.toContain("他人成果");
  expect(data).not.toHaveProperty("periods"); expect(data).not.toHaveProperty("activities");
});

test("工作台处理未配置、未入发布范围和会话撤销，不假造零分", async () => {
  const configuration = await getWorkbench(users.student.session, termIds[1]);
  if (configuration.role !== "STUDENT") throw new Error("应为学生工作台");
  expect(configuration.outcome.state).toBe("CONFIGURATION"); expect(configuration.outcome.total).toBeNull();
  const none = await getWorkbench(users.student.session);
  if (none.role !== "STUDENT") throw new Error("应为学生工作台");
  expect(none.outcome.state).toBe("NO_TERM"); expect(none.outcome.total).toBeNull();
  await expect(getWorkbench(users.student.session, "not-an-existing-period")).rejects.toThrow("周期不存在");
  await db.authSession.update({ where: { id: users.otherPublisher.session }, data: { revokedAt: new Date() } });
  await expect(getWorkbench(users.otherPublisher.session, selectedTerm)).rejects.toThrow("会话已失效");
});

test("学生工作台采用冻结发布成绩、本人名次及绑定版本确认", async () => {
  await db.recognitionSource.updateMany({ where: { participation: { activity: { termId: selectedTerm } }, status: { in: ["PENDING_COUNSELOR", "RETURNED"] } }, data: { status: "REJECTED" } });
  await db.personalClaim.updateMany({ where: { termId: selectedTerm, status: { in: ["PENDING_COUNSELOR", "PENDING_COLLEGE", "RESCORING", "RETURNED"] } }, data: { status: "ABANDONED" } });
  await db.personalClaim.update({ where: { id: claim }, data: { status: "APPROVED", score: "3", scoreNodeId: "total", scoredAt: new Date() } });
  const preview = await previewPublication(users.admin.session, selectedTerm);
  const publication = await publishResults(users.admin.session, selectedTerm, { revision: preview.termRevision, inputRevision: preview.inputRevision, token: preview.token, checkingEndsAt: new Date(Date.now() + 600_000).toISOString(), requireConfirmation: true, requestId: randomUUID() });
  await db.activity.update({ where: { id: privateActivity }, data: { points: "99" } });
  const before = await getWorkbench(users.student.session, selectedTerm);
  if (before.role !== "STUDENT") throw new Error("应为学生工作台");
  expect(before.outcome.state).toBe("PUBLISHED"); expect(before.outcome.total).toBe("8.00");
  expect(before.outcome.rank).toBe(1); expect(before.outcome.confirmedAt).toBeNull();
  const result = await getStudentResult(users.student.session, selectedTerm);
  if (!("resultHash" in result)) throw new Error("应为固定发布结果");
  await confirmResult(users.student.session, selectedTerm, publication.id, result.resultHash);
  const confirmed = await getWorkbench(users.student.session, selectedTerm);
  if (confirmed.role !== "STUDENT") throw new Error("应为学生工作台");
  expect(confirmed.outcome.publication?.id).toBe(publication.id); expect(confirmed.outcome.confirmedAt).toBeInstanceOf(Date);
  const admin = await getWorkbench(users.admin.session, selectedTerm);
  if (admin.role !== "ADMIN") throw new Error("应为管理员工作台");
  expect(admin.periods.find(row => row.id === selectedTerm)?.confirmedStudents).toBe(1);
  const late = await db.user.create({ data: { login: `${marker}-late`, name: "后加入学生", role: "STUDENT", passwordHash: "unused", mustChangePassword: false, studentProfile: { create: { studentNumber: `${marker}-late`, college: "学院", major: "专业", className: "班级" } } } });
  users.late = { id: late.id, session: (await db.authSession.create({ data: { userId: late.id, version: 0, expiresAt: new Date(Date.now() + 600_000) } })).id };
  const notIncluded = await getWorkbench(users.late.session, selectedTerm);
  if (notIncluded.role !== "STUDENT") throw new Error("应为学生工作台");
  expect(notIncluded.outcome.state).toBe("NOT_INCLUDED"); expect(notIncluded.outcome.total).toBeNull();
  expect(notIncluded.outcome.rank).toBeNull(); expect(notIncluded.outcome.population).toBeNull();
});

