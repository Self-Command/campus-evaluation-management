import { afterAll, beforeAll, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import yauzl from "yauzl";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { organizationFixture } from "./organization-fixture";
import { createTerm, saveScheme, activateTerm } from "@/server/terms";
import { saveGrade } from "@/server/grades";
import { previewGradeImport } from "@/server/grade-import";
import { exportStudentGradeWorkbook } from "@/server/grade-export";
import { AccountError } from "@/server/account-error";
import { exportClassGradeWorkbook, gradeExportScope } from "@/server/class-grade-export";
import { exportRankingGradeWorkbook } from "@/server/rankings";
import { collectStudentResults, resultStudentSelect } from "@/server/results";
import { digest } from "@/server/publications";
import { jsonValue } from "@/server/claims";
import { nodeSchema } from "@/lib/scoring/types";

const address = new URL(process.env.DATABASE_URL!);
if (address.hostname !== "127.0.0.1" || !/^\/campus_test_[a-f0-9]{12}$/.test(address.pathname)) throw new Error("必须由隔离运行器执行");
const marker = `export-${randomUUID().slice(0, 8)}`;
const users: Record<string, { id: string; session: string }> = {};
const collegeIds: string[] = [];
const classIds: string[] = [];
let termId = "";
let publicationId = "";

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

function rowContaining(sheet: string, text: string) {
  const row = (sheet.match(/<row\b[^>]*>[\s\S]*?<\/row>/g) ?? []).find((item) => item.includes(text));
  if (!row) throw new Error(`工作表中找不到包含 ${text} 的行`);
  return row;
}

function numericCell(row: string, column: string) {
  const match = new RegExp(`<c r="${column}\\d+"[^>]*>(?:<f>.*?</f>)?<v>([^<]+)</v>`).exec(row);
  if (!match) throw new Error(`行中找不到 ${column} 列数值`);
  return Number(match[1]);
}

async function identity(
  label: string,
  role: "ADMIN" | "STUDENT" | "COLLEGE",
  options: { classId?: string; collegeId?: string; organization?: Awaited<ReturnType<typeof organizationFixture>> } = {},
) {
  const user = await db.user.create({
    data: {
      login: `${marker}-${label}`,
      name: label,
      role,
      passwordHash: "fixture-only",
      mustChangePassword: false,
      ...(role === "COLLEGE" ? { collegeId: options.collegeId } : {}),
      ...(role === "STUDENT" && options.organization ? { studentProfile: { create: { studentNumber: `${marker}-${label}`, college: options.organization.college.name, major: options.organization.major.name, className: options.organization.schoolClass.name, classId: options.classId } } } : {}),
    },
  });
  users[label] = { id: user.id, session: (await db.authSession.create({ data: { userId: user.id, version: 0, expiresAt: new Date(Date.now() + 600_000) } })).id };
  return users[label];
}

beforeAll(async () => {
  const orgA = await organizationFixture(`${marker}-a`, { college: "导出学院A", major: "导出专业A", className: "导出班级A" });
  const orgB = await organizationFixture(`${marker}-b`, { college: "导出学院B", major: "导出专业B", className: "导出班级B" });
  collegeIds.push(orgA.college.id, orgB.college.id);
  classIds.push(orgA.schoolClass.id, orgB.schoolClass.id);
  for (const [label, org] of [["counselor-a", orgA], ["counselor-b", orgB]] as const) {
    users[label] = { id: org.counselor.id, session: (await db.authSession.create({ data: { userId: org.counselor.id, version: 0, expiresAt: new Date(Date.now() + 600_000) } })).id };
  }
  await identity("admin", "ADMIN");
  await identity("college-a", "COLLEGE", { collegeId: orgA.college.id });
  await identity("college-b", "COLLEGE", { collegeId: orgB.college.id });
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
  await saveGrade(users.admin.session, termId, { studentLogin: `${marker}-student-b`, nodeId: "grade", value: "70", revision: null, reason: "导出核对" });
});

afterAll(async () => {
  if (termId) {
    await db.resultConfirmation.deleteMany({ where: { result: { publication: { termId } } } });
    await db.publishedResult.deleteMany({ where: { publication: { termId } } });
    await db.resultPublication.deleteMany({ where: { termId } });
    await db.gradeChange.deleteMany({ where: { termId } });
    await db.gradeImport.deleteMany({ where: { termId } });
    await db.gradeInput.deleteMany({ where: { termId } });
    await db.term.deleteMany({ where: { id: termId } });
  }
  const ids = Object.values(users).map((user) => user.id);
  await db.auditEvent.deleteMany({ where: { actorId: { in: ids } } });
  await db.schoolClass.updateMany({ where: { id: { in: classIds } }, data: { counselorId: null } });
  await db.user.deleteMany({ where: { OR: [{ id: { in: ids } }, { login: { startsWith: `${marker}-bulk-` } }] } });
  await db.schoolClass.deleteMany({ where: { id: { in: classIds } } });
  await db.major.deleteMany({ where: { collegeId: { in: collegeIds } } });
  await db.college.deleteMany({ where: { id: { in: collegeIds } } });
  await db.$disconnect();
}, 120_000);

test("学生只能导出本人，辅导员与学院不能越权导出其他学生", async () => {
  const self = await exportStudentGradeWorkbook(users["student-a"].session, termId, { studentId: users["student-a"].id });
  expect(self.buffer.subarray(0, 2).toString()).toBe("PK");
  expect(self.fileName).toContain("student-a");
  expect(self.fileName).toContain("_当前阶段_");
  expect(self.fileName.endsWith(".xlsx")).toBe(true);
  expect(self.published).toBe(false);
  const selfSheet = (await readEntries(self.buffer))["xl/worksheets/sheet1.xml"];
  expect(selfSheet).not.toContain("得分");
  expect(selfSheet).toContain("学院");
  expect(selfSheet).toContain("专业");
  expect(selfSheet).toContain("班级");

  const own = await exportStudentGradeWorkbook(users["counselor-a"].session, termId, { studentId: users["student-a"].id });
  expect(own.buffer.subarray(0, 2).toString()).toBe("PK");
  expect(own.published).toBe(false);

  await expect(exportStudentGradeWorkbook(users["counselor-b"].session, termId, { studentId: users["student-a"].id })).rejects.toThrow("可导出范围");
  await expect(exportStudentGradeWorkbook(users["student-b"].session, termId, { studentId: users["student-a"].id })).rejects.toThrow("可导出范围");
});

test("辅导员导出本人全部班级，学院导出本院全部学生，管理员导出全校", async () => {
  const profileA = await db.studentProfile.findUniqueOrThrow({ where: { userId: users["student-a"].id } });
  const counselorScope = await gradeExportScope(users["counselor-a"].session, termId);
  expect(counselorScope.classes.map((item) => item.id)).toEqual([profileA.classId]);
  expect(counselorScope.published).toBe(false);

  const counselor = await exportClassGradeWorkbook(users["counselor-a"].session, termId, { scope: "counselor" });
  expect(counselor.count).toBe(1);
  expect(counselor.buffer.subarray(0, 2).toString()).toBe("PK");
  expect(counselor.fileName).toContain("_当前阶段_");

  const collegeScope = await gradeExportScope(users["college-a"].session, termId);
  expect(collegeScope.classes.map((item) => item.id)).toEqual([profileA.classId]);
  const college = await exportClassGradeWorkbook(users["college-a"].session, termId, { scope: "college" });
  expect(college.count).toBe(1);

  const schoolScope = await gradeExportScope(users["admin"].session, termId);
  expect(schoolScope.classes.map((item) => item.id)).toEqual(expect.arrayContaining([profileA.classId, (await db.studentProfile.findUniqueOrThrow({ where: { userId: users["student-b"].id } })).classId]));
  const school = await exportClassGradeWorkbook(users["admin"].session, termId, { scope: "school" });
  expect(school.count).toBeGreaterThanOrEqual(2);
  expect(school.fileName).toContain("_当前阶段_");
  const files = await readEntries(school.buffer);
  const detail = files["xl/worksheets/sheet1.xml"];
  expect(detail).toContain("全校综合素质测评成绩明细表（");
  expect(numericCell(rowContaining(detail, `${marker}-student-a`), "G")).toBe(88);
  expect(numericCell(rowContaining(detail, `${marker}-student-b`), "G")).toBe(70);
  expect(files["xl/workbook.xml"]).toContain('name="评分规则"');
  expect(files["xl/worksheets/sheet2.xml"]).toContain("项目类型");
  expect(files["xl/worksheets/sheet2.xml"]).toContain("权重（乘数）");
  expect(files["xl/worksheets/sheet2.xml"]).toContain("扣分系数");

  // 默认不传筛选条件时，也按当前账号范围导出，而不是要求客户端指定班级。
  expect((await exportClassGradeWorkbook(users["counselor-a"].session, termId, {})).count).toBe(1);
  expect((await exportClassGradeWorkbook(users["college-a"].session, termId, {})).count).toBe(1);
  expect((await exportClassGradeWorkbook(users["admin"].session, termId, {})).count).toBe(school.count);

  await expect(exportClassGradeWorkbook(users["counselor-b"].session, termId, { classId: profileA.classId! })).rejects.toThrow("不在可导出范围");
  await expect(exportClassGradeWorkbook(users["college-b"].session, termId, { classId: profileA.classId! })).rejects.toThrow("不在可导出范围");
  await expect(exportClassGradeWorkbook(users["student-a"].session, termId, { classId: profileA.classId! })).rejects.toThrow("没有操作权限");
  await expect(exportClassGradeWorkbook(users["college-a"].session, termId, { scope: "school" })).rejects.toThrow("只有学校管理员");
  await expect(exportClassGradeWorkbook(users["counselor-a"].session, termId, { scope: "college" })).rejects.toThrow("只有学院管理人员");
});

test("成绩导入核对姓名、学院、专业、班级，不能只凭学号写入", async () => {
  const profile = await db.studentProfile.findUniqueOrThrow({ where: { userId: users["student-a"].id } });
  const base = {
    login: `${marker}-student-a`,
    name: "student-a",
    college: profile.college,
    major: profile.major,
    className: profile.className,
    value: "88",
  };
  const wrongName = await previewGradeImport(users["admin"].session, termId, {
    nodeId: "grade",
    rows: [{ ...base, name: "错误姓名" }],
    reason: "核对身份字段",
  });
  expect(wrongName.rows[0]).toMatchObject({ state: "ERROR" });
  expect(wrongName.rows[0].message).toContain("姓名");

  const same = await previewGradeImport(users["admin"].session, termId, {
    nodeId: "grade",
    rows: [base],
    reason: "核对身份字段",
  });
  expect(same.rows[0]).toMatchObject({ state: "SAME" });
});

test("核对或锁定阶段导出使用已发布快照，忽略之后的现场改动", async () => {
  const studentRows = await db.user.findMany({
    where: { id: { in: [users["student-a"].id, users["student-b"].id] } },
    select: resultStudentSelect,
    orderBy: { id: "asc" },
  });
  const publication = await db.$transaction(async (tx) => {
    const term = await tx.term.findUniqueOrThrow({ where: { id: termId } });
    const records = await collectStudentResults(tx, term, studentRows);
    expect(records.every((record) => record.result.complete)).toBe(true);
    const created = await tx.resultPublication.create({
      data: {
        termId,
        sequence: term.publicationSequence + 1,
        actorId: users["admin"].id,
        requestId: randomUUID(),
        requestHash: "fixture-publication",
        scheme: jsonValue(term.scheme),
        termRevision: term.revision + 1,
        inputRevision: term.inputRevision,
        studentCount: records.length,
        checkingEndsAt: new Date(Date.now() + 3_600_000),
        requireConfirmation: false,
      },
    });
    await tx.publishedResult.createMany({
      data: records.map((payload) => {
        const profile = payload.student.profile!;
        return {
          publicationId: created.id,
          studentId: payload.student.id,
          login: payload.student.login,
          name: payload.student.name,
          college: profile.college,
          major: profile.major,
          className: profile.className,
          total: new Prisma.Decimal(payload.result.total!),
          resultHash: digest({ student: payload.student, result: payload.result, grades: payload.grades, deductions: payload.deductions, participations: payload.participations, claims: payload.claims }),
          payload: jsonValue(payload),
        };
      }),
    });
    await tx.term.update({
      where: { id: termId },
      data: {
        phase: "CHECKING",
        publishedResultSetId: created.id,
        publicationSequence: created.sequence,
        revision: { increment: 1 },
      },
    });
    return created;
  });
  publicationId = publication.id;

  // 发布后改动现场成绩和班级名，导出不得跟着变化。
  await db.gradeInput.updateMany({ where: { termId, studentId: users["student-a"].id }, data: { value: "99" } });
  await db.studentProfile.update({ where: { userId: users["student-a"].id }, data: { className: "发布后现场班级" } });

  const adminScope = await gradeExportScope(users["admin"].session, termId);
  expect(adminScope.published).toBe(true);
  const personal = await exportStudentGradeWorkbook(users["admin"].session, termId, { studentId: users["student-a"].id });
  expect(personal.published).toBe(true);
  expect(personal.fileName).toContain("_正式发布_");
  const personalFiles = await readEntries(personal.buffer);
  const personalSheet = personalFiles["xl/worksheets/sheet1.xml"];
  const personalRow = rowContaining(personalSheet, `${marker}-student-a`);
  expect(numericCell(personalRow, "G")).toBe(88);
  expect(numericCell(personalRow, "I")).toBe(88);
  expect(numericCell(personalRow, "J")).toBe(88);
  expect(personalSheet).toContain("<f>");
  expect(personalSheet).toContain("扣分前总分");
  expect(personalSheet).toContain("综合测评总分（扣分后）");
  expect(personalSheet).toContain("<sheetProtection");
  expect(personalSheet).toContain("第 1 次发布");
  expect(personalSheet).toContain("正式发布快照");
  expect(personalSheet).toContain("导出班级A");
  expect(personalSheet).not.toContain("发布后现场班级");
  expect(personalFiles["xl/workbook.xml"]).toContain('name="成绩明细"');
  expect(personalFiles["xl/workbook.xml"]).toContain('name="评分规则"');
  expect(personalFiles["xl/worksheets/sheet2.xml"]).toContain("权重（乘数）");
  expect(personalFiles["xl/worksheets/sheet2.xml"]).toContain("<sheetProtection");

  const school = await exportClassGradeWorkbook(users["admin"].session, termId, { scope: "school" });
  expect(school.count).toBe(2);
  const files = await readEntries(school.buffer);
  const detail = files["xl/worksheets/sheet1.xml"];
  expect(numericCell(rowContaining(detail, `${marker}-student-a`), "G")).toBe(88);
  expect(numericCell(rowContaining(detail, `${marker}-student-b`), "G")).toBe(70);
  expect(numericCell(rowContaining(detail, `${marker}-student-a`), "J")).toBe(88);
  expect(numericCell(rowContaining(detail, `${marker}-student-b`), "J")).toBe(70);
  expect(detail).toContain("<f>");
  expect(detail).toContain("<sheetProtection");
  expect(detail).not.toContain("发布后现场班级");
  expect(detail).toContain("导出班级A");
  expect(files["xl/workbook.xml"]).toContain('name="评分规则"');
  expect(files["xl/worksheets/sheet2.xml"]).toContain("项目类型");
  expect(files["xl/worksheets/sheet2.xml"]).toContain("权重（乘数）");
  expect(files["xl/worksheets/sheet2.xml"]).toContain("扣分系数");
  expect(publication.id).toBe(publicationId);
});

test("管理员可按学院筛选导出，范围统计与实际学生一致", async () => {
	const scope = await gradeExportScope(users["admin"].session, termId);
	const collegeA = scope.colleges.find((item) => item.name === "导出学院A");
	const collegeB = scope.colleges.find((item) => item.name === "导出学院B");
	expect(collegeA).toMatchObject({ classCount: 1, studentCount: 1 });
	expect(collegeB).toMatchObject({ classCount: 1, studentCount: 1 });
	const profileA = await db.studentProfile.findUniqueOrThrow({ where: { userId: users["student-a"].id } });
	expect(scope.classes.find((item) => item.id === profileA.classId)?.collegeId).toBe(collegeA?.id);

	const filtered = await exportClassGradeWorkbook(users["admin"].session, termId, { collegeIds: [collegeA!.id] });
	expect(filtered.count).toBe(1);
	expect(filtered.published).toBe(true);
	expect(filtered.fileName).toContain("导出学院A");
	expect(filtered.fileName).not.toContain("全校");
	const files = await readEntries(filtered.buffer);
	const detail = files["xl/worksheets/sheet1.xml"];
	expect(detail).toContain(`${marker}-student-a`);
	expect(detail).not.toContain(`${marker}-student-b`);
	expect(detail).toContain("导出班级A");
	expect(detail).not.toContain("发布后现场班级");
	expect(detail).not.toContain("全校综合素质测评");
	expect(detail).toContain("正式发布快照");

	await expect(exportClassGradeWorkbook(users["college-a"].session, termId, { collegeIds: [collegeA!.id] })).rejects.toThrow("只有学校管理员");
	await expect(exportClassGradeWorkbook(users["admin"].session, termId, { collegeIds: ["missing-college"] })).rejects.toThrow("不在可导出范围");
});

test("管理员排名导出为所选发布版本的全校明细表，忽略分数筛选", async () => {
  for (const input of [{ publicationId }, {}]) {
    const ranking = await exportRankingGradeWorkbook(users["admin"].session, termId, input);
    expect(ranking.count).toBe(2);
    expect(ranking.fileName).toContain("_正式发布_");
    const files = await readEntries(ranking.buffer);
    const detail = files["xl/worksheets/sheet1.xml"];
    expect(detail).toContain("全校综合素质测评成绩明细表");
    expect(detail).not.toContain("得分");
    expect(detail).toContain("<f>");
    expect(detail).toContain("扣分前总分");
    expect(detail).toContain("综合测评总分（扣分后）");
    expect(detail).toContain("<sheetProtection");
    expect(detail).toContain("导出班级A");
    expect(detail).not.toContain("发布后现场班级");
    expect(numericCell(rowContaining(detail, `${marker}-student-a`), "G")).toBe(88);
    expect(numericCell(rowContaining(detail, `${marker}-student-b`), "G")).toBe(70);
    expect(numericCell(rowContaining(detail, `${marker}-student-a`), "J")).toBe(88);
    expect(numericCell(rowContaining(detail, `${marker}-student-b`), "J")).toBe(70);
    expect(files["xl/workbook.xml"]).toContain('name="评分规则"');
    expect(files["xl/worksheets/sheet2.xml"]).toContain("权重（乘数）");
    expect(files["xl/worksheets/sheet2.xml"]).toContain("<sheetProtection");
  }
  await expect(exportRankingGradeWorkbook(users["student-a"].session, termId, {})).rejects.toThrow("没有操作权限");
  await expect(exportRankingGradeWorkbook(users["college-a"].session, termId, {})).rejects.toThrow("没有操作权限");
});

test("超过10,000人时拒绝整批导出，排名导出使用同一上限", async () => {
	const profileA = await db.studentProfile.findUniqueOrThrow({ where: { userId: users["student-a"].id } });
	const bulk: { id: string; login: string; name: string }[] = [];
	for (let start = 0; start < 10_001; start += 2_000) {
		const created = await db.user.createManyAndReturn({
			data: Array.from({ length: Math.min(2_000, 10_001 - start) }, (_, offset) => {
				const index = start + offset;
				return {
					login: `${marker}-bulk-${index}`,
					name: `批量学生${index}`,
					role: "STUDENT" as const,
					passwordHash: "fixture-only",
					mustChangePassword: false,
				};
			}),
			select: { id: true, login: true, name: true },
		});
		bulk.push(...created);
		await db.studentProfile.createMany({
			data: created.map((student) => ({
				userId: student.id,
				studentNumber: student.login,
				college: "导出学院A",
				major: "导出专业A",
				className: "导出班级A",
				classId: profileA.classId,
			})),
		});
	}
	expect(bulk).toHaveLength(10_001);

	const exportError = await exportClassGradeWorkbook(users["admin"].session, termId, { scope: "school" }).catch((cause) => cause);
	expect(exportError).toBeInstanceOf(AccountError);
	expect(exportError.status).toBe(413);
	expect(exportError.message).toContain("超过单次 10,000 人上限");

	const term = await db.term.findUniqueOrThrow({ where: { id: termId } });
	const publication = await db.resultPublication.create({
		data: {
			termId,
			sequence: term.publicationSequence + 1,
			actorId: users["admin"].id,
			requestId: randomUUID(),
			requestHash: "capacity-fixture",
			scheme: jsonValue(term.scheme),
			termRevision: term.revision,
			inputRevision: term.inputRevision,
			studentCount: bulk.length,
			checkingEndsAt: new Date(Date.now() + 3_600_000),
			requireConfirmation: false,
		},
	});
	for (let start = 0; start < bulk.length; start += 2_000) {
		await db.publishedResult.createMany({
			data: bulk.slice(start, start + 2_000).map((student) => ({
				publicationId: publication.id,
				studentId: student.id,
				login: student.login,
				name: student.name,
				college: "导出学院A",
				major: "导出专业A",
				className: "导出班级A",
				total: new Prisma.Decimal(0),
				resultHash: "capacity-fixture",
				payload: {},
			})),
		});
	}
	const rankingError = await exportRankingGradeWorkbook(users["admin"].session, termId, { publicationId: publication.id }).catch((cause) => cause);
	expect(rankingError).toBeInstanceOf(AccountError);
	expect(rankingError.status).toBe(413);
	expect(rankingError.message).toContain("通过成绩明细表按学院或班级分批导出");
}, 180_000);
