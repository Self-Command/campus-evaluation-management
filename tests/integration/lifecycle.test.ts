import { beforeAll, afterAll, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import yauzl from "yauzl";
import { db } from "@/server/db";
import { createTerm, saveScheme, activateTerm } from "@/server/terms";
import { nodeSchema } from "@/lib/scoring/types";
import { uploadEvidence, downloadEvidence } from "@/server/evidence";
import { saveProject, submitClaim, changeClaim, pageClaims } from "@/server/claims";
import { saveGrade, listGrades } from "@/server/grades";
import { listDeductions } from "@/server/deductions";
import { getStudentResult, ranked, pageResultStudents } from "@/server/results";
import { previewPublication, publishResults, confirmResult, previewSettlement, lockSettlement, reopenTerm, digest } from "@/server/publications";
import { createAppeal, changeAppeal, pageAppeals } from "@/server/appeals";
import { getRankings } from "@/server/rankings";
import { exportClassGradeWorkbook } from "@/server/class-grade-export";
import { readSiteSettings, saveSettings, uploadBrandAsset, getBrandAsset } from "@/server/settings";
import { selfAccount } from "@/server/account-self";
import { previewGradeImport, commitGradeImport } from "@/server/grade-import";
import { Prisma } from "@/generated/prisma/client";

const database = new URL(process.env.DATABASE_URL!);
if (database.hostname !== "127.0.0.1" || !/^\/campus_test_[a-f0-9]+$/.test(database.pathname)) throw new Error("必须由隔离运行器创建临时数据库");
const identities: Record<string, { id: string; session: string; login: string }> = {};
let termId: string | undefined, claimId: string, evidenceId: string, publicationId: string, appealId: string, attachmentRoot: string | undefined;
let orgCollegeId = "", orgMajorId = "", orgClassId = "";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=", "base64");
function readEntries(buffer: Buffer) {
  return new Promise<Record<string, string>>((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(error ?? new Error("无法打开工作簿"));
      const files: Record<string, string> = {};
      zip.on("entry", (entry: yauzl.Entry) => {
        if (/\/$/.test(entry.fileName)) return zip.readEntry();
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) return reject(streamError ?? new Error("无法读取条目"));
          const chunks: Buffer[] = [];
          stream.on("data", (chunk: Buffer) => chunks.push(chunk));
          stream.on("end", () => {
            files[entry.fileName] = Buffer.concat(chunks).toString("utf8");
            zip.readEntry();
          });
        });
      });
      zip.on("end", () => resolve(files));
      zip.on("error", reject);
      zip.readEntry();
    });
  });
}
async function gradeImportRow(login: string, value: string) {
  const current = await db.term.findUniqueOrThrow({ where: { id: termId! }, select: { cohortPolicy: true, cohortPublicationId: true } });
  if (current.cohortPolicy === "PREVIOUS" && current.cohortPublicationId) {
    const published = await db.publishedResult.findFirstOrThrow({ where: { publicationId: current.cohortPublicationId, login }, select: { name: true, college: true, major: true, className: true } });
    return { login, ...published, value };
  }
  const user = await db.user.findUniqueOrThrow({ where: { login }, select: { name: true, studentProfile: { select: { college: true, major: true, className: true } } } });
  if (!user.studentProfile) throw new Error("测试学生缺少档案");
  return { login, name: user.name, ...user.studentProfile, value };
}
beforeAll(async () => {
  attachmentRoot = await mkdtemp(join(tmpdir(), "campus-lifecycle-")); process.env.EVIDENCE_DIR = attachmentRoot;
  for (const [key, role] of [["admin", "ADMIN"], ["publisher", "PUBLISHER"], ["student", "STUDENT"], ["other", "STUDENT"], ["counselor", "COUNSELOR"], ["college", "COLLEGE"]] as const) {
    const login = `lifecycle-${key}`;
    const user = await db.user.create({ data: { login, name: key === "student" ? "=恶意公式" : key, role, passwordHash: "unused", mustChangePassword: false, ...(role === "STUDENT" ? { studentProfile: { create: { studentNumber: login, college: "学院", major: "专业", className: "班级" } } } : {}) } });
    identities[key] = { id: user.id, login, session: (await db.authSession.create({ data: { userId: user.id, version: 0, expiresAt: new Date(Date.now() + 600_000) } })).id };
  }
  // 个人申报按班级责任辅导员初审、归属学院终审，先建立完整组织链。
  orgCollegeId = (await db.college.create({ data: { code: `lifecycle-${randomUUID().slice(0, 8)}`, name: "闭环学院" } })).id;
  await db.user.update({ where: { id: identities.counselor.id }, data: { collegeId: orgCollegeId } });
  await db.user.update({ where: { id: identities.college.id }, data: { collegeId: orgCollegeId } });
  orgMajorId = (await db.major.create({ data: { code: `lifecycle-${randomUUID().slice(0, 8)}`, name: "闭环专业", collegeId: orgCollegeId } })).id;
  orgClassId = (await db.schoolClass.create({ data: { code: `lifecycle-${randomUUID().slice(0, 8)}`, name: "闭环班级", majorId: orgMajorId, counselorId: identities.counselor.id } })).id;
  await db.studentProfile.update({ where: { userId: identities.student.id }, data: { classId: orgClassId } });
  await db.studentProfile.update({ where: { userId: identities.other.id }, data: { classId: orgClassId } });
  termId = (await createTerm(identities.admin.session, { name: "闭环验证", template: false })).id;
  await saveScheme(identities.admin.session, termId, { revision: 0, scheme: { nodes: [nodeSchema.parse({ id: "total", parentId: null, name: "综合成绩", kind: "SUM", order: 0 }), nodeSchema.parse({ id: "grade", parentId: "total", name: "学业成绩", kind: "GRADE", required: true, order: 0 }), nodeSchema.parse({ id: "activity", parentId: "total", name: "个人成果", kind: "ACTIVITY", order: 1 })], deductions: [] } });
  await activateTerm(identities.admin.session, termId, { revision: 1 });
});
afterAll(async () => {
  // Every destructive query is scoped to an ID created by this suite, even if setup failed midway.
  if (termId) {
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
    await db.gradeImport.deleteMany({ where: { termId } }); await db.gradeInput.deleteMany({ where: { termId } });
    await db.term.delete({ where: { id: termId } });
  }
  const ids = Object.values(identities).map(i => i.id);
  if (orgClassId) await db.schoolClass.updateMany({ where: { id: orgClassId }, data: { counselorId: null } });
  await db.evidence.deleteMany({ where: { ownerId: { in: ids } } });
  await db.auditEvent.deleteMany({ where: { actorId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  if (orgClassId) await db.schoolClass.deleteMany({ where: { id: orgClassId } });
  if (orgMajorId) await db.major.deleteMany({ where: { id: orgMajorId } });
  if (orgCollegeId) await db.college.deleteMany({ where: { id: orgCollegeId } });
  await db.siteSettings.deleteMany(); await db.brandAsset.deleteMany();
  if (attachmentRoot && attachmentRoot.startsWith(join(tmpdir(), "campus-lifecycle-"))) await rm(attachmentRoot, { recursive: true, force: true });
  delete process.env.EVIDENCE_DIR; await db.$disconnect();
});

test("个人申报两级审核、伪造分值拒收、证明归属及本人隔离", async () => {
  const admin = identities.admin.session, student = identities.student.session, counselor = identities.counselor.session, college = identities.college.session;
  await expect(saveProject(admin, termId!, { name: "成果项目", description: "经审核认定成果", nodeId: "activity", points: "3", enabled: true })).rejects.toThrow("认定项目目录已取消");
  const file = await uploadEvidence(student, "证明.png", png); evidenceId = file.id;
  // REV-01：学生申报不携带分数，伪造评分、项目或事实键的请求被拒且零写入。
  await expect(submitClaim(student, termId!, { title: "伪造申报", occurredOn: "2026-10-01", note: "携带伪造字段", evidenceIds: [file.id], points: "999", score: "999", projectId: "forged", factKey: "FACT-1", activityId: "forged" })).rejects.toThrow();
  expect(await db.personalClaim.count({ where: { termId } })).toBe(0);
  await expect(submitClaim(identities.other.session, termId!, { title: "他人证明", occurredOn: "2026-10-01", note: "使用他人证明材料", evidenceIds: [file.id] })).rejects.toThrow("提交者");
  const claim = await submitClaim(student, termId!, { title: "省级竞赛获奖", occurredOn: "2026-10-01", note: "本人取得成果", evidenceIds: [file.id] }); claimId = claim.id;
  expect(claim.status).toBe("PENDING_COUNSELOR");
  expect((await pageClaims(identities.other.session, termId!)).items).toHaveLength(0);
  await expect(changeClaim(identities.other.session, termId!, claimId, { action: "abandon", revision: 0 })).rejects.toThrow("申报不存在");
  // REV-02：辅导员评分校验——缺分、非计分模块、越范围；学生与学院不能自评。
  await expect(changeClaim(counselor, termId!, claimId, { action: "submitScore", revision: 0 })).rejects.toThrow("请选择计分模块");
  await expect(changeClaim(counselor, termId!, claimId, { action: "submitScore", revision: 0, nodeId: "grade", score: "3" })).rejects.toThrow("最底层");
  await expect(changeClaim(counselor, termId!, claimId, { action: "submitScore", revision: 0, nodeId: "activity", score: "101" })).rejects.toThrow("范围");
  await expect(changeClaim(student, termId!, claimId, { action: "submitScore", revision: 0, nodeId: "activity", score: "3" })).rejects.toThrow("初审评分权限");
  await expect(changeClaim(college, termId!, claimId, { action: "submitScore", revision: 0, nodeId: "activity", score: "3" })).rejects.toThrow("初审评分权限");
  // 合法零分可以先提交学院，再由学院退回重评纠正为实际分值。
  await changeClaim(counselor, termId!, claimId, { action: "submitScore", revision: 0, nodeId: "activity", score: "0" });
  await expect(changeClaim(counselor, termId!, claimId, { action: "approve", revision: 1 })).rejects.toThrow("终审权限");
  await expect(changeClaim(student, termId!, claimId, { action: "approve", revision: 1 })).rejects.toThrow("终审权限");
  await changeClaim(college, termId!, claimId, { action: "rescore", revision: 1, reason: "评分档次适用错误" });
  await changeClaim(counselor, termId!, claimId, { action: "submitScore", revision: 2, nodeId: "activity", score: "3" });
  // REV-04：学院普通退回必须填写理由并退给原学生。
  await expect(changeClaim(college, termId!, claimId, { action: "return", revision: 3 })).rejects.toThrow("请填写退回修改理由");
  await changeClaim(college, termId!, claimId, { action: "return", revision: 3, reason: "获奖证书需补原件扫描" });
  // REV-06：重新提交产生新修订，旧评分清除并重走辅导员初审。
  await expect(changeClaim(student, termId!, claimId, { action: "resubmit", revision: 4, title: "省级竞赛获奖", occurredOn: "2026-10-01" })).rejects.toThrow("请完整填写");
  await changeClaim(student, termId!, claimId, { action: "resubmit", revision: 4, title: "省级竞赛获奖", occurredOn: "2026-10-01", note: "已补充证书原件扫描", evidenceIds: [file.id] });
  const cleared = (await pageClaims(student, termId!)).items.find(row => row.id === claimId)!;
  expect(cleared.status).toBe("PENDING_COUNSELOR"); expect(cleared.score).toBeNull(); expect(cleared.scorer).toBeNull();
  await expect(changeClaim(college, termId!, claimId, { action: "approve", revision: 5 })).rejects.toThrow("仅待学院");
  await changeClaim(counselor, termId!, claimId, { action: "submitScore", revision: 5, nodeId: "activity", score: "3" });
  await changeClaim(college, termId!, claimId, { action: "approve", revision: 6, reason: "材料完整属实" });
  await expect(changeClaim(college, termId!, claimId, { action: "approve", revision: 7, reason: "不能覆盖通过" })).rejects.toThrow("仅待学院");
  const result = await getStudentResult(student, termId!);
  expect(result.claims[0].points).toBe("3"); expect(result.result.provisionalTotal).toBe("3.00");
  expect(result.claims[0].evidenceFiles).toEqual([{ id: evidenceId, name: "证明.png" }]);
  const roster = await pageResultStudents(admin, termId!, { q: identities.student.login });
  expect(roster.items).toHaveLength(1); expect(roster.items[0].complete).toBe(false); expect(roster.items[0].total).toBeNull();
  await expect(pageResultStudents(student, termId!, {})).rejects.toThrow("权限");
  expect((await pageClaims(student, termId!)).items.find(row => row.id === claimId)!.history).toHaveLength(8);
  await expect(downloadEvidence(identities.other.session, file.id)).rejects.toThrow("权限");
});

test("发布缺失阻断、并发重放、不可变结果与确认绑定", async () => {
  const admin = identities.admin.session;
  expect((await previewPublication(admin, termId!)).canPublish).toBe(false);
  const activeStudents = await db.user.findMany({ where: { role: "STUDENT", disabled: false, studentProfile: { isNot: null } } });
  for (const student of activeStudents) await saveGrade(admin, termId!, { studentLogin: student.login, nodeId: "grade", value: "70", revision: null, reason: "首次正式成绩" });
  const preview = await previewPublication(admin, termId!);
  expect(preview.canPublish).toBe(true);
  const input = { revision: preview.termRevision, inputRevision: preview.inputRevision, token: preview.token, checkingEndsAt: new Date(Date.now() + 60_000).toISOString(), requireConfirmation: false, requestId: randomUUID() };
  const concurrent = await Promise.all([publishResults(admin, termId!, input), publishResults(admin, termId!, input)]);
  expect(concurrent.filter(r => !r.replay)).toHaveLength(1); publicationId = concurrent[0].id;
  await expect(publishResults(admin, termId!, { ...input, requireConfirmation: true })).rejects.toThrow("标识");
  await expect(saveGrade(admin, termId!, { studentLogin: identities.student.login, nodeId: "grade", value: "80", revision: 0, reason: "核对阶段写入" })).rejects.toThrow("阶段");
  const result = await getStudentResult(identities.student.session, termId!);
  if (!("resultHash" in result)) throw new Error("应为固定发布结果");
  expect(result.result.total).toBe("73.00");
  await expect(confirmResult(identities.other.session, termId!, publicationId, result.resultHash)).rejects.toThrow("本人");
  const confirmed = await confirmResult(identities.student.session, termId!, publicationId, result.resultHash);
  expect((await confirmResult(identities.student.session, termId!, publicationId, result.resultHash)).id).toBe(confirmed.id);
  const frozenRoster = await pageResultStudents(admin, termId!, { q: identities.student.login });
  expect(frozenRoster.items[0].total).toBe("73.00"); expect(frozenRoster.items[0].complete).toBe(true); expect(frozenRoster.items[0].confirmedAt).not.toBeNull();
  await db.studentProfile.update({ where: { userId: identities.student.id }, data: { className: "临时转班" } });
  expect((await pageResultStudents(admin, termId!, { q: identities.student.login, className: "班级" })).items[0].className).toBe("班级");
  expect((await pageResultStudents(admin, termId!, { q: identities.student.login, className: "临时转班" })).items).toEqual([]);
  await db.studentProfile.update({ where: { userId: identities.student.id }, data: { className: "班级" } });
  await db.user.update({ where: { id: identities.other.id }, data: { disabled: true } });
  expect((await listGrades(admin, termId!, identities.other.login)).inputs[0].value).toBe("70");
  expect((await listDeductions(admin, termId!, identities.other.login)).records).toEqual([]);
  await db.user.update({ where: { id: identities.other.id }, data: { disabled: false } });
  const appeal = await createAppeal(identities.student.session, termId!, { publicationId, resultHash: result.resultHash, target: "学业成绩", reason: "成绩与原始证明不符", evidenceIds: [evidenceId] }); appealId = appeal.id;
  expect((await pageAppeals(identities.other.session, termId!)).items).toHaveLength(0);
  await expect(changeAppeal(admin, termId!, appealId, { revision: 0, action: "resolve", resolution: "尚无更正不能解决", resolvedPublicationId: publicationId })).rejects.toThrow("实际更正");
  const state = await previewSettlement(admin, termId!);
  expect(state.blockers.map(b => b.type)).toContain("APPEALS"); expect(state.blockers.map(b => b.type)).toContain("DEADLINE");
  await expect(lockSettlement(admin, termId!, { revision: state.revision, token: state.token, requestId: randomUUID() })).rejects.toThrow("核对截止");
});

test("理由更正生成新版本，旧确认不迁移、异议要求实际更正、排名与导出同源", async () => {
  const admin = identities.admin.session;
  const before = await db.publishedResult.findUniqueOrThrow({ where: { publicationId_studentId: { publicationId, studentId: identities.student.id } } });
  let term = await db.term.findUniqueOrThrow({ where: { id: termId! } });
  await expect(reopenTerm(admin, termId!, { revision: term.revision, reason: "" })).rejects.toThrow();
  await reopenTerm(admin, termId!, { revision: term.revision, reason: "依据异议更正成绩" });
  const staleBatch = await previewGradeImport(admin, termId!, { nodeId: "grade", rows: [await gradeImportRow(identities.student.login, "75")], reason: "导入旧预览" });
  await saveGrade(admin, termId!, { studentLogin: identities.student.login, nodeId: "grade", value: "80", revision: 0, reason: "按原始成绩单更正" });
  const p = await previewPublication(admin, termId!);
  const next = await publishResults(admin, termId!, { revision: p.termRevision, inputRevision: p.inputRevision, token: p.token, checkingEndsAt: new Date(Date.now() + 1500).toISOString(), requireConfirmation: false, requestId: randomUUID() });
  await expect(confirmResult(identities.student.session, termId!, publicationId, before.resultHash)).rejects.toThrow("发布结果已变化");
  const fixed = await getStudentResult(identities.student.session, termId!);
  expect(fixed.result.total).toBe("83.00");
  if (!("confirmation" in fixed)) throw new Error("应为固定发布结果");
  expect(fixed.confirmation).toBeNull();
  await changeAppeal(admin, termId!, appealId, { revision: 0, action: "resolve", resolution: "已核对成绩单并更正发布", resolvedPublicationId: next.id });
  expect((await db.publishedResult.findUniqueOrThrow({ where: { id: before.id } })).resultHash).toBe(before.resultHash);
  expect((await db.publishedResult.findUniqueOrThrow({ where: { id: before.id } })).payload).toEqual(before.payload);
  const ranking = await getRankings(admin, termId!, {});
  const rankingFile = await exportClassGradeWorkbook(admin, termId!, { scope: "school" });
  expect(rankingFile.buffer.subarray(0, 2).toString()).toBe("PK");
  const rankingSheet = (await readEntries(rankingFile.buffer))["xl/worksheets/sheet1.xml"];
  expect(rankingSheet).toContain("=恶意公式");
  expect(rankingSheet).toContain("<f>");
  expect(rankingSheet).toMatch(/<c r="B\d+"[^>]*t="inlineStr"[^>]*><is><t[^>]*>=恶意公式<\/t><\/is><\/c>/);
  expect(rankingSheet).toContain("<v>83</v>");
  expect(rankingSheet).toContain("学院");
  expect(rankingSheet).toContain("班级");
  expect(ranking.items[0].studentId).toBe(identities.student.id);
  expect((await getRankings(identities.student.session, termId!, {})).items).toHaveLength(1);
  await new Promise(r => setTimeout(r, 1700));
  const state = await previewSettlement(admin, termId!);
  expect(state.blockers).toEqual([]);
  const request = { revision: state.revision, token: state.token, requestId: randomUUID() };
  const snapshots = await Promise.all([lockSettlement(admin, termId!, request), lockSettlement(admin, termId!, request)]);
  expect(snapshots[0].id).toBe(snapshots[1].id);
  const snapshot = await db.settlementSnapshot.findUniqueOrThrow({ where: { id: snapshots[0].id } });
  expect(digest(snapshot.payload)).toBe(snapshot.sha256);
  await expect(commitGradeImport(admin, termId!, staleBatch.id)).rejects.toThrow("阶段");
  term = await db.term.findUniqueOrThrow({ where: { id: termId! } });
  await reopenTerm(admin, termId!, { revision: term.revision, reason: "锁定后另轮更正" });
  await db.studentProfile.update({ where: { userId: identities.student.id }, data: { className: "已转班" } });
  expect((await db.settlementSnapshot.findUniqueOrThrow({ where: { id: snapshot.id } })).payload).toEqual(snapshot.payload);
});

test("常用设置白名单/修订/品牌发布和本人账号设置权限", async () => {
  const admin = identities.admin.session, settings = await readSiteSettings();
  const image = await uploadBrandAsset(admin, png);
  await expect(getBrandAsset(image.id)).rejects.toThrow("不存在");
  const { revision, updatedAt, ...content } = settings;
  void updatedAt;
  const current = { ...content, revision };
  await expect(saveSettings(identities.student.session, { ...current, reason: "越权设置" })).rejects.toThrow("权限");
  const changed = await saveSettings(admin, { ...current, siteName: "综合测评", logoAssetId: image.id, reason: "更新学校站名" });
  expect(changed.revision).toBe(1);
  let publicSessionLookups = 0;
  const publicImage = await getBrandAsset(image.id, async () => {
    publicSessionLookups += 1;
    return undefined;
  });
  expect(publicImage.size).toBe(png.length);
  expect(publicImage.publicAsset).toBe(true);
  expect(publicSessionLookups).toBe(0);
  const privateImage = await uploadBrandAsset(admin, png);
  await expect(getBrandAsset(privateImage.id)).rejects.toThrow("不存在");
  let privateSessionLookups = 0;
  const privateAsset = await getBrandAsset(privateImage.id, async () => {
    privateSessionLookups += 1;
    return admin;
  });
  expect(privateAsset.size).toBe(png.length);
  expect(privateAsset.publicAsset).toBe(false);
  expect(privateSessionLookups).toBe(1);
  await expect(saveSettings(admin, { ...current, reason: "过期编辑" })).rejects.toThrow("已变化");
  await expect(saveSettings(admin, { ...current, revision: 1, themePreset: "<script>", reason: "非法主题" })).rejects.toThrow();
  const own = await selfAccount(identities.student.session);
  const edited = await selfAccount(identities.student.session, { revision: own.revision, name: "本人姓名" });
  expect(edited.name).toBe("本人姓名");
  await expect(selfAccount(identities.student.session, { revision: edited.revision, name: "越权角色", role: "ADMIN" })).rejects.toThrow();
});

test("排名精确到显示两位，同分竞赛序和导出文本不以公式执行", () => {
  const rows = ranked([{ studentId: "a", login: "a", total: new Prisma.Decimal("0.01") }, { studentId: "b", login: "b", total: new Prisma.Decimal("0.01") }, { studentId: "c", login: "c", total: new Prisma.Decimal("-1.02") }]);
  expect(rows.map(r => r.rank)).toEqual([1, 1, 3]);
});

test("12位小数从数据库回读和导入比较不转科学计数法", async () => {
  const input = { studentLogin: identities.student.login, nodeId: "grade", value: "0.000000000001", revision: 1, reason: "核对最高支持精度" };
  const grade = await saveGrade(identities.admin.session, termId!, input);
  expect(grade.value.toFixed()).toBe(input.value);
  const result = await getStudentResult(identities.student.session, termId!);
  expect(result.grades.find(g => g.nodeId === "grade")?.value).toBe(input.value);
  expect((await saveGrade(identities.admin.session, termId!, { ...input, revision: grade.revision })).revision).toBe(grade.revision);
  const preview = await previewGradeImport(identities.admin.session, termId!, { nodeId: "grade", rows: [await gradeImportRow(input.studentLogin, input.value)], reason: "相同精确值不覆盖" });
  expect(preview.rows[0].state).toBe("SAME");
});

