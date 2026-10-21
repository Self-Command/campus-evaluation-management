import { afterAll, beforeAll, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db } from "@/server/db";
import { organizationFixture } from "./organization-fixture";
import { uploadEvidence } from "@/server/evidence";
import { createTerm, saveScheme, activateTerm } from "@/server/terms";
import { submitClaim, changeClaim, pageClaims } from "@/server/claims";
import { getStudentResult } from "@/server/results";
import { nodeSchema } from "@/lib/scoring/types";

const address = new URL(process.env.DATABASE_URL!);
if (address.hostname !== "127.0.0.1" || !/^\/campus_test_[a-f0-9]{12}$/.test(address.pathname)) throw new Error("必须由隔离运行器执行");
const marker = `review-${randomUUID().slice(0, 8)}`;
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=", "base64");
const users: Record<string, { id: string; session: string }> = {};
const collegeIds: string[] = [];
const classIds: string[] = [];
let termId = "", directory: string, evidenceA = "", evidenceB = "";
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

const claimInput = (title: string, evidenceIds: string[]) => ({ title, occurredOn: "2026-10-01", note: `${title}的事实说明与本人贡献`, evidenceIds });

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "campus-claims-review-"));
  process.env.EVIDENCE_DIR = directory;
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
  await saveScheme(users.admin.session, termId, { revision: 0, scheme: { nodes: [nodeSchema.parse({ id: "total", parentId: null, name: "综合成绩", kind: "SUM", order: 0 }), nodeSchema.parse({ id: "grade", parentId: "total", name: "学业成绩", kind: "GRADE", required: true, order: 0 }), nodeSchema.parse({ id: "activity", parentId: "total", name: "个人成果", kind: "ACTIVITY", order: 1 }), nodeSchema.parse({ id: "practice", parentId: "total", name: "实践成果", kind: "ACTIVITY", order: 2 })], deductions: [] } });
  await activateTerm(users.admin.session, termId, { revision: 1 });
  evidenceA = (await uploadEvidence(users["student-a"].session, "本人成果.png", png)).id;
  evidenceB = (await uploadEvidence(users["student-b"].session, "本人成果.png", png)).id;
});

afterAll(async () => {
  if (termId) {
    await db.claimEvidence.deleteMany({ where: { claim: { termId } } });
    await db.personalClaim.deleteMany({ where: { termId } });
    await db.term.deleteMany({ where: { id: termId } });
  }
  const ids = Object.values(users).map(user => user.id);
  await db.evidence.deleteMany({ where: { ownerId: { in: ids } } });
  await db.auditEvent.deleteMany({ where: { actorId: { in: ids } } });
  await db.schoolClass.updateMany({ where: { id: { in: classIds } }, data: { counselorId: null } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.schoolClass.deleteMany({ where: { id: { in: classIds } } });
  await db.major.deleteMany({ where: { collegeId: { in: collegeIds } } });
  await db.college.deleteMany({ where: { id: { in: collegeIds } } });
  if (directory && directory.startsWith(join(tmpdir(), "campus-claims-review-"))) await rm(directory, { recursive: true, force: true });
  delete process.env.EVIDENCE_DIR;
  await db.$disconnect();
});

test("REV-01～06：辅导员评分初审、学院终审、越权隔离、退回重评及受控撤销", async () => {
  const claim = await submitClaim(users["student-a"].session, termId, claimInput("省级竞赛获奖", [evidenceA]));
  expect(claim.status).toBe("PENDING_COUNSELOR");
  expect(claim.score).toBeNull();
  expect((await pageClaims(users["student-b"].session, termId)).items).toHaveLength(0);
  expect((await pageClaims(users["counselor-b"].session, termId)).items).toHaveLength(0);
  expect((await pageClaims(users["college-b"].session, termId)).items).toHaveLength(0);
  expect((await pageClaims(users["counselor-a"].session, termId, 1, "PENDING")).items).toHaveLength(1);
  await expect(changeClaim(users["counselor-b"].session, termId, claim.id, { revision: 0, action: "submitScore", nodeId: "activity", score: "3" })).rejects.toThrow("本人负责班级");
  await expect(changeClaim(users["college-b"].session, termId, claim.id, { revision: 0, action: "approve" })).rejects.toThrow("本院学生");
  await expect(changeClaim(users["college-a"].session, termId, claim.id, { revision: 0, action: "approve" })).rejects.toThrow("仅待学院");
  await expect(changeClaim(users.admin.session, termId, claim.id, { revision: 0, action: "submitScore", nodeId: "activity", score: "3" })).rejects.toThrow("初审评分权限");
  await expect(changeClaim(users["student-a"].session, termId, claim.id, { revision: 0, action: "submitScore", nodeId: "activity", score: "3" })).rejects.toThrow("初审评分权限");
  await expect(changeClaim(users["counselor-a"].session, termId, claim.id, { revision: 0, action: "submitScore" })).rejects.toThrow("请选择计分模块");
  await expect(changeClaim(users["counselor-a"].session, termId, claim.id, { revision: 0, action: "submitScore", nodeId: "grade", score: "3" })).rejects.toThrow("最底层");
  await expect(changeClaim(users["counselor-a"].session, termId, claim.id, { revision: 0, action: "submitScore", nodeId: "activity", score: "101" })).rejects.toThrow("范围");
  const scored = await changeClaim(users["counselor-a"].session, termId, claim.id, { revision: 0, action: "submitScore", nodeId: "activity", score: "2.5" });
  expect(scored.status).toBe("PENDING_COLLEGE");
  await expect(changeClaim(users["college-a"].session, termId, claim.id, { revision: 0, action: "approve" })).rejects.toThrow("已变化");
  await changeClaim(users["college-a"].session, termId, claim.id, { revision: 1, action: "rescore", reason: "评分档次适用错误" });
  await changeClaim(users["counselor-a"].session, termId, claim.id, { revision: 2, action: "submitScore", nodeId: "practice", score: "3" });
  const before = (await db.term.findUniqueOrThrow({ where: { id: termId } })).inputRevision;
  const approved = await changeClaim(users["college-a"].session, termId, claim.id, { revision: 3, action: "approve", reason: "材料完整属实" });
  expect(approved.status).toBe("APPROVED");
  expect(approved.score?.toFixed()).toBe("3");
  expect((await db.term.findUniqueOrThrow({ where: { id: termId } })).inputRevision).toBe(before + 1);
  await expect(changeClaim(users["college-a"].session, termId, claim.id, { revision: 4, action: "approve" })).rejects.toThrow("仅待学院");
  const result = await getStudentResult(users["student-a"].session, termId);
  expect(result.claims).toHaveLength(1);
  expect(result.claims[0].points).toBe("3");
  await expect(changeClaim(users.admin.session, termId, claim.id, { revision: 4, action: "revoke" })).rejects.toThrow("撤销理由");
  const revoked = await changeClaim(users.admin.session, termId, claim.id, { revision: 4, action: "revoke", reason: "同类赛事重复认定" });
  expect(revoked.status).toBe("REVOKED");
  expect((await db.term.findUniqueOrThrow({ where: { id: termId } })).inputRevision).toBe(before + 2);
  expect((await getStudentResult(users["student-a"].session, termId)).claims).toHaveLength(0);
});

test("REV-04～06：退回修改交原学生、重提清除旧评分并重走审核，学院可退回重评", async () => {
  const claim = await submitClaim(users["student-b"].session, termId, claimInput("社会实践成果", [evidenceB]));
  await expect(changeClaim(users["counselor-b"].session, termId, claim.id, { revision: 0, action: "return" })).rejects.toThrow("退回修改理由");
  const sentBack = await changeClaim(users["counselor-b"].session, termId, claim.id, { revision: 0, action: "return", reason: "请补充实践单位证明" });
  expect(sentBack.status).toBe("RETURNED");
  expect(sentBack.reviewReason).toBe("请补充实践单位证明");
  await expect(changeClaim(users["college-b"].session, termId, claim.id, { revision: 1, action: "approve" })).rejects.toThrow("仅待学院");
  await expect(changeClaim(users["student-b"].session, termId, claim.id, { revision: 1, action: "resubmit", title: "社会实践成果" })).rejects.toThrow("请完整填写");
  const resubmitted = await changeClaim(users["student-b"].session, termId, claim.id, { revision: 1, action: "resubmit", title: "社会实践成果", occurredOn: "2026-10-02", note: "已补充实践单位证明与本人分工", evidenceIds: [evidenceB] });
  expect(resubmitted.status).toBe("PENDING_COUNSELOR");
  expect(resubmitted.score).toBeNull();
  expect(resubmitted.scorerId).toBeNull();
  const scored = await changeClaim(users["counselor-b"].session, termId, claim.id, { revision: 2, action: "submitScore", nodeId: "activity", score: "4" });
  expect(scored.score?.toFixed()).toBe("4");
  const rescoring = await changeClaim(users["college-b"].session, termId, claim.id, { revision: 3, action: "rescore", reason: "材料无误，评分依据不足" });
  expect(rescoring.status).toBe("RESCORING");
  expect(rescoring.score?.toFixed()).toBe("4");
  await expect(changeClaim(users["student-a"].session, termId, claim.id, { revision: 4, action: "abandon" })).rejects.toThrow("申报不存在");
  await changeClaim(users["counselor-b"].session, termId, claim.id, { revision: 4, action: "submitScore", nodeId: "practice", score: "5" });
  const approved = await changeClaim(users["college-b"].session, termId, claim.id, { revision: 5, action: "approve" });
  expect(approved.status).toBe("APPROVED");
  expect(approved.history).toHaveLength(7);
  await expect(changeClaim(users["student-b"].session, termId, claim.id, { revision: 6, action: "abandon" })).rejects.toThrow("仅待辅导员或退回修改");
});

test("REV-07：退回后可逻辑删除放弃，历史保留并从待办移除；放弃与重提并发只有一种结果", async () => {
  const claim = await submitClaim(users["student-b"].session, termId, claimInput("志愿服务时长", [evidenceB]));
  await changeClaim(users["counselor-b"].session, termId, claim.id, { revision: 0, action: "return", reason: "服务时长与证明不一致" });
  const abandoned = await changeClaim(users["student-b"].session, termId, claim.id, { revision: 1, action: "abandon" });
  expect(abandoned.status).toBe("ABANDONED");
  expect(abandoned.history).toHaveLength(3);
  expect((await pageClaims(users["student-b"].session, termId, 1, "PENDING")).items).toHaveLength(0);
  expect((await pageClaims(users["student-b"].session, termId, 1, "ABANDONED")).items).toHaveLength(1);
  await expect(changeClaim(users["student-b"].session, termId, claim.id, { revision: 2, action: "resubmit", title: "志愿服务时长", occurredOn: "2026-10-01", note: "重新提交", evidenceIds: [evidenceB] })).rejects.toThrow("仅退回修改");

  const race = await submitClaim(users["student-a"].session, termId, claimInput("并发放弃申报", [evidenceA]));
  await changeClaim(users["counselor-a"].session, termId, race.id, { revision: 0, action: "return", reason: "请核对成果日期" });
  const outcomes = await Promise.allSettled([
    changeClaim(users["student-a"].session, termId, race.id, { revision: 1, action: "abandon" }),
    changeClaim(users["student-a"].session, termId, race.id, { revision: 1, action: "resubmit", title: "并发放弃申报", occurredOn: "2026-10-01", note: "已核对日期并重新提交", evidenceIds: [evidenceA] }),
  ]);
  expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(1);
  const current = await db.personalClaim.findUniqueOrThrow({ where: { id: race.id } });
  expect(["ABANDONED", "PENDING_COUNSELOR"]).toContain(current.status);
  expect(current.revision).toBe(2);
  expect(current.history).toHaveLength(3);
});
