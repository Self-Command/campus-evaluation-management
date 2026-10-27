import { afterAll, beforeAll, expect, test } from "vitest";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db } from "@/server/db";
import { organizationFixture } from "./organization-fixture";
import { uploadEvidence, downloadEvidence } from "@/server/evidence";
import { saveSettings, readSiteSettings } from "@/server/settings";
import { defaultSettings } from "@/lib/settings-schema";
import { createTerm, activateTerm } from "@/server/terms";
import { submitClaim } from "@/server/claims";
import sharp from "sharp";
import type { Role } from "@/generated/prisma/client";

const address = new URL(process.env.DATABASE_URL!);
if (address.hostname !== "127.0.0.1" || !/^\/campus_test_[a-f0-9]{12}$/.test(address.pathname)) throw new Error("必须由隔离运行器执行");
const prefix = `preview-${randomUUID().slice(0, 8)}`;
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=", "base64");
const users: Record<string, { id: string; session: string }> = {};
let directory: string, fileId: string, termId: string;
let organizationA: Awaited<ReturnType<typeof organizationFixture>>;
const collegeIds: string[] = [];

async function identity(label: string, role: Role, collegeId?: string, classId?: string) {
  const user = await db.user.create({ data: { login: `${prefix}-${label}`, name: label, role, passwordHash: "fixture-only", mustChangePassword: false, collegeId,
    ...(classId ? { studentProfile: { create: { studentNumber: `${prefix}-${label}`, college: label, major: label, className: label, classId } } } : {}) } });
  users[label] = { id: user.id, session: (await db.authSession.create({ data: { userId: user.id, version: 0, expiresAt: new Date(Date.now() + 600_000) } })).id };
  return users[label];
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "campus-evidence-preview-")); process.env.EVIDENCE_DIR = directory;
  organizationA = await organizationFixture(`${prefix}-a`);
  const organizationB = await organizationFixture(`${prefix}-b`);
  collegeIds.push(organizationA.college.id, organizationB.college.id);
  for (const [label, counselor] of [["counselor-a", organizationA.counselor], ["counselor-b", organizationB.counselor]] as const) users[label] = { id: counselor.id, session: (await db.authSession.create({ data: { userId: counselor.id, version: 0, expiresAt: new Date(Date.now() + 600_000) } })).id };
  await identity("admin", "ADMIN"); await identity("college-a", "COLLEGE", organizationA.college.id); await identity("college-b", "COLLEGE", organizationB.college.id);
  await identity("student-a", "STUDENT", undefined, organizationA.schoolClass.id); await identity("student-b", "STUDENT", undefined, organizationB.schoolClass.id);
  await identity("unbound-counselor", "COUNSELOR");
  const admin = users.admin.session;
  const term = await createTerm(admin, { name: `${prefix}-材料`, template: false }); termId = term.id;
  await activateTerm(admin, termId, { revision: 0 });
  fileId = (await uploadEvidence(users["student-a"].session, "中文材料.png", png)).id;
  await submitClaim(users["student-a"].session, termId, { title: "本人材料", occurredOn: "2026-10-20", note: "材料预览真实引用", evidenceIds: [fileId] });
});

afterAll(async () => {
  if (termId) {
    await db.claimEvidence.deleteMany({ where: { claim: { termId } } });
    await db.personalClaim.deleteMany({ where: { termId } });
    await db.recognitionProject.deleteMany({ where: { termId } });
    await db.term.deleteMany({ where: { id: termId } });
  }
  const ids = Object.values(users).map(user => user.id);
  await db.evidence.deleteMany({ where: { ownerId: { in: ids } } });
  await db.auditEvent.deleteMany({ where: { actorId: { in: ids } } });
  await db.studentProfile.deleteMany({ where: { userId: { in: ids } } });
  await db.schoolClass.deleteMany({ where: { major: { collegeId: { in: collegeIds } } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.major.deleteMany({ where: { collegeId: { in: collegeIds } } });
  await db.college.deleteMany({ where: { id: { in: collegeIds } } });
  // Only this suite's owned attachment path is removed.
  if (directory && directory.startsWith(join(tmpdir(), "campus-evidence-preview-"))) await rm(directory, { recursive: true, force: true });
  delete process.env.EVIDENCE_DIR; await db.$disconnect();
});

test("同一原文件可由本人、管理员、本院和本班辅导员授权读取，跨院跨班及未绑定人员拒绝", async () => {
  for (const label of ["student-a", "admin", "college-a", "counselor-a"]) {
    const read = await downloadEvidence(users[label].session, fileId);
    expect(read.bytes).toEqual(png); expect(read.file.mime).toBe("image/png");
  }
  for (const label of ["student-b", "college-b", "counselor-b", "unbound-counselor"]) await expect(downloadEvidence(users[label].session, fileId)).rejects.toThrow(/权限|归属/);
  const unlinked = await uploadEvidence(users["student-a"].session, "未提交.png", png);
  await expect(downloadEvidence(users["college-a"].session, unlinked.id)).rejects.toThrow("权限");
});

test("授权按当前责任关系重新读取，交接后旧辅导员不能依赖旧页面继续读取", async () => {
  const next = await identity("next-counselor", "COUNSELOR", organizationA.college.id);
  await db.schoolClass.update({ where: { id: organizationA.schoolClass.id }, data: { counselorId: next.id } });
  await expect(downloadEvidence(users["counselor-a"].session, fileId)).rejects.toThrow("权限");
  expect((await downloadEvidence(next.session, fileId)).bytes).toEqual(png);
  await db.schoolClass.update({ where: { id: organizationA.schoolClass.id }, data: { counselorId: users["counselor-a"].id } });
});

test("图片/PDF类型来自文件签名，篡改文件及已撤销会话不能进入预览", async () => {
  const pdf = await uploadEvidence(users["student-a"].session, "证明.pdf", Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n"));
  expect((await downloadEvidence(users["student-a"].session, pdf.id)).file.mime).toBe("application/pdf");
  const file = await db.evidence.findUniqueOrThrow({ where: { id: fileId } });
  await writeFile(join(directory, file.storageKey), Buffer.from("tampered"));
  await expect(downloadEvidence(users.admin.session, fileId)).rejects.toThrow("校验");
  await writeFile(join(directory, file.storageKey), png);
  await db.authSession.update({ where: { id: users["counselor-a"].session }, data: { revokedAt: new Date() } });
  await expect(downloadEvidence(users["counselor-a"].session, fileId)).rejects.toThrow("失效");
});

function noiseBigPng() {
  return sharp(randomBytes(1400 * 800 * 3), { raw: { width: 1400, height: 800, channels: 3 } }).png().toBuffer();
}

test("证明大小上限与类型白名单按系统设置执行", async () => {
  const admin = users.admin.session;
  try {
    const saved = await saveSettings(admin, { ...defaultSettings, evidenceMaxSizeMb: 1, evidenceAllowPdf: false, revision: (await readSiteSettings()).revision, reason: "收紧证明上传设置" });
    const big = await noiseBigPng();
    expect(big.length).toBeGreaterThan(1024 * 1024);
    await expect(uploadEvidence(users["student-a"].session, "超限大图.png", big)).rejects.toThrow("每份证明需在1MB以内");
    await expect(uploadEvidence(users["student-a"].session, "证明.pdf", Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n"))).rejects.toThrow("系统已关闭 PDF 证明上传");
    await saveSettings(admin, { ...defaultSettings, evidenceMaxSizeMb: 1, evidenceAllowImage: false, revision: saved.revision, reason: "关闭图片证明" });
    await expect(uploadEvidence(users["student-a"].session, "图片.png", png)).rejects.toThrow("系统已关闭图片证明上传");
  } finally {
    await saveSettings(admin, { ...defaultSettings, revision: (await readSiteSettings()).revision, reason: "恢复默认上传设置" });
  }
});

test("证明图片超过阈值自动压缩为 WebP，开关关闭时保留原样", async () => {
  const admin = users.admin.session;
  try {
    const big = await noiseBigPng();
    expect(big.length).toBeGreaterThan(300 * 1024);
    const uploaded = await uploadEvidence(users["student-a"].session, "大图证明.png", big);
    expect(uploaded.mime).toBe("image/webp");
    expect(uploaded.size).toBeLessThan(big.length);
    const { bytes } = await downloadEvidence(users["student-a"].session, uploaded.id);
    expect(bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(bytes.subarray(8, 12).toString("ascii")).toBe("WEBP");
    await saveSettings(admin, { ...defaultSettings, imageCompressionEnabled: false, revision: (await readSiteSettings()).revision, reason: "关闭图片压缩" });
    const raw = await uploadEvidence(users["student-a"].session, "原图证明.png", big);
    expect(raw.mime).toBe("image/png");
    expect(raw.size).toBe(big.length);
    const small = await uploadEvidence(users["student-a"].session, "小图证明.png", png);
    expect(small.mime).toBe("image/png");
  } finally {
    await saveSettings(admin, { ...defaultSettings, revision: (await readSiteSettings()).revision, reason: "恢复默认上传设置" });
  }
});
