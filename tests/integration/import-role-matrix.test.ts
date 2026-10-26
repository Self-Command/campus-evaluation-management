import { afterAll, beforeAll, expect, test } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { organizationFixture } from "./organization-fixture";
import { createTerm, saveScheme, activateTerm } from "@/server/terms";
import { nodeSchema } from "@/lib/scoring/types";
import { classKey } from "@/server/activity-policy";
import {
	commitAccountImport,
	previewAccountImport,
} from "@/server/account-import";
import { commitGradeImport, previewGradeImport } from "@/server/grade-import";
import {
	commitParticipationImport,
	previewParticipationImport,
} from "@/server/participation-import";
import {
	templateCsv,
	templateFor,
	type ImportTemplate,
} from "@/lib/imports/templates";
import { resolveImportTemplate } from "@/server/import-templates";

const address = new URL(process.env.DATABASE_URL!);
if (
	address.hostname !== "127.0.0.1" ||
	!/^\/campus_test_[a-f0-9]{12}$/.test(address.pathname)
)
	throw new Error("必须由隔离运行器执行");

const marker = `matrix-${randomUUID().slice(0, 8)}`;
let termId = "";
let org: Awaited<ReturnType<typeof organizationFixture>>;
let collegeB: { id: string; name: string };
const users: Record<string, { id: string; session: string }> = {};
const classIds: string[] = [];
const collegeIds: string[] = [];
const students: Record<string, { id: string; login: string; name: string }> = {};
let savedNodeId = "";
const activityIds: string[] = [];

async function identity(
	label: string,
	role: "ADMIN" | "PUBLISHER" | "COLLEGE" | "COUNSELOR",
	collegeId?: string,
) {
	const user = await db.user.create({
		data: {
			login: `${marker}-${label}`,
			name: label,
			role,
			collegeId,
			passwordHash: "fixture-only",
			mustChangePassword: false,
		},
	});
	const session = await db.authSession.create({
		data: {
			userId: user.id,
			version: 0,
			expiresAt: new Date(Date.now() + 600_000),
		},
	});
	users[label] = { id: user.id, session: session.id };
	return users[label];
}

async function student(label: string, login: string, name: string) {
	const profile = {
		college: org.college.name,
		major: org.major.name,
		className: org.schoolClass.name,
	};
	const user = await db.user.create({
		data: {
			login,
			name,
			role: "STUDENT",
			passwordHash: "fixture-only",
			mustChangePassword: false,
			studentProfile: {
				create: {
					studentNumber: login,
					...profile,
					classId: org.schoolClass.id,
				},
			},
		},
	});
	students[label] = { id: user.id, login, name };
	return students[label];
}

function accountRows(
	template: ImportTemplate,
	rows: {
		login: string;
		name: string;
		college: string;
		major: string;
		className: string;
	}[],
) {
	return rows.map((row) => {
		const source = {
			学号: row.login,
			姓名: row.name,
			学院: row.college,
			专业: row.major,
			班级: row.className,
		} as Record<string, string>;
		return {
			login: source[template.headers[0]],
			name: source[template.headers[1]],
			college: source[template.headers[2]],
			major: source[template.headers[3]],
			className: source[template.headers[4]],
		};
	});
}

function participationRows(
	template: ImportTemplate,
	rows: {
		login: string;
		name: string;
		college: string;
		major: string;
		className: string;
	}[],
) {
	return rows.map((row) => {
		const source = {
			学号: row.login,
			姓名: row.name,
			学院: row.college,
			专业: row.major,
			班级: row.className,
		} as Record<string, string>;
		const parsed = Object.fromEntries(
			template.headers.map((header) => [header, source[header]]),
		);
		return {
			login: parsed["学号"],
			name: parsed["姓名"],
			...(template.headers.includes("学院")
				? { college: parsed["学院"] }
				: {}),
			...(template.headers.includes("专业") ? { major: parsed["专业"] } : {}),
			...(template.headers.includes("班级")
				? { className: parsed["班级"] }
				: {}),
		};
	});
}

function gradeRows(
	template: ImportTemplate,
	rows: {
		login: string;
		name: string;
		college: string;
		major: string;
		className: string;
		value: string;
	}[],
) {
	return rows.map((row) => {
		const source = {
			学号: row.login,
			姓名: row.name,
			学院: row.college,
			专业: row.major,
			班级: row.className,
			成绩: row.value,
		} as Record<string, string>;
		const parsed = Object.fromEntries(
			template.headers.map((header) => [header, source[header]]),
		);
		return {
			login: parsed["学号"],
			name: parsed["姓名"],
			value: parsed["成绩"],
			...(template.headers.includes("学院")
				? { college: parsed["学院"] }
				: {}),
			...(template.headers.includes("专业") ? { major: parsed["专业"] } : {}),
			...(template.headers.includes("班级")
				? { className: parsed["班级"] }
				: {}),
		};
	});
}

async function fixtureRows(label: string) {
	const row = students[label];
	if (!row) throw new Error(`missing student ${label}`);
	const profile = await db.studentProfile.findUniqueOrThrow({
		where: { userId: row.id },
	});
	return {
		login: row.login,
		name: row.name,
		college: profile.college,
		major: profile.major,
		className: profile.className,
	};
}

async function createActivity(
	label: string,
	ownerId: string,
	collegeId: string,
) {
	const activity = await db.activity.create({
		data: {
			termId,
			ownerId,
			collegeId,
			name: `${marker}-${label}`,
			organizer: "测试主办方",
			content: "角色矩阵导入测试活动",
			startsAt: new Date(Date.now() - 3_600_000),
			endsAt: new Date(Date.now() + 86_400_000),
			nodeId: savedNodeId,
			points: "10",
			confirmed: true,
			publishedAt: new Date(),
			audienceScope: "CLASS",
			audienceColleges: [],
			audienceClasses: [
				classKey({
					college: org.college.name,
					major: org.major.name,
					className: org.schoolClass.name,
				}),
			],
		},
	});
	activityIds.push(activity.id);
	return activity;
}

beforeAll(async () => {
	org = await organizationFixture(`${marker}-org`, {
		college: `${marker}学院`,
		major: `${marker}专业`,
		className: `${marker}班级`,
	});
	classIds.push(org.schoolClass.id);
	collegeIds.push(org.college.id);
	collegeB = await db.college.create({
		data: { code: `${marker}-B`, name: `${marker}外院` },
	});
	collegeIds.push(collegeB.id);
	await identity("admin", "ADMIN");
	await identity("publisher", "PUBLISHER");
	await identity("college", "COLLEGE", org.college.id);
	await identity("college-b", "COLLEGE", collegeB.id);
	users["counselor"] = {
		id: org.counselor.id,
		session: (
			await db.authSession.create({
				data: {
					userId: org.counselor.id,
					version: 0,
					expiresAt: new Date(Date.now() + 600_000),
				},
			})
		).id,
	};
	await student("grade-admin", "90000001", "成绩管理员学生");
	await student("grade-counselor", "90000002", "成绩辅导员学生");
	await student("participation-admin", "90000003", "参与管理员学生");
	await student("participation-publisher", "90000004", "参与发布者学生");
	await student("participation-college", "90000005", "参与学院学生");

	const term = await createTerm(users.admin.session, {
		name: `${marker}-周期`,
		template: false,
	});
	termId = term.id;
	await saveScheme(users.admin.session, termId, {
		revision: 0,
		scheme: {
			nodes: [
				nodeSchema.parse({
					id: "total",
					parentId: null,
					name: "综合成绩",
					kind: "SUM",
					order: 0,
				}),
				nodeSchema.parse({
					id: "grade",
					parentId: "total",
					name: "学业成绩",
					kind: "GRADE",
					required: false,
					order: 0,
				}),
				nodeSchema.parse({
					id: "activity",
					parentId: "total",
					name: "活动成果",
					kind: "ACTIVITY",
					order: 1,
				}),
			],
			deductions: [],
		},
	});
	await activateTerm(users.admin.session, termId, { revision: 1 });
	savedNodeId = "activity";

	const evidence = await db.evidence.create({
		data: {
			ownerId: users.admin.id,
			name: "角色矩阵证明.pdf",
			mime: "application/pdf",
			size: 1,
			sha256: "a".repeat(64),
			storageKey: `${marker}-evidence`,
		},
	});
	for (const [label, ownerId, collegeId] of [
		["admin-activity", users.admin.id, org.college.id],
		["publisher-activity", users.publisher.id, org.college.id],
		["college-activity", users.admin.id, org.college.id],
	] as const) {
		const activity = await createActivity(label, ownerId, collegeId);
		await db.activityEvidence.create({
			data: {
				activityId: activity.id,
				evidenceId: evidence.id,
				version: 1,
				active: true,
				uploadedBy: users.admin.id,
				note: "角色矩阵测试证明",
			},
		});
	}
});

afterAll(async () => {
	const ids = [
		users.admin?.id,
		users.publisher?.id,
		users.college?.id,
		users["college-b"]?.id,
		org?.counselor.id,
		...Object.values(students).map((student) => student.id),
	].filter((id): id is string => !!id);
	const extraUsers = await db.user.findMany({
		where: { login: { in: ["90000010"] } },
		select: { id: true },
	});
	ids.push(...extraUsers.map((user) => user.id));
	if (termId) {
		await db.accountImport.deleteMany({ where: { actorId: { in: ids } } });
		await db.gradeImport.deleteMany({ where: { termId } });
		await db.participationImport.deleteMany({ where: { termId } });
		await db.gradeChange.deleteMany({ where: { termId } });
		await db.gradeInput.deleteMany({ where: { termId } });
		await db.recognitionSource.deleteMany({
			where: { participation: { activity: { termId } } },
		});
		await db.participation.deleteMany({
			where: { activity: { termId } },
		});
		await db.activityEvidence.deleteMany({
			where: { activity: { termId } },
		});
		await db.activity.deleteMany({ where: { termId } });
		await db.term.deleteMany({ where: { id: termId } });
	}
	await db.duplicateIdentityException.deleteMany({
		where: { actorId: { in: ids } },
	});
	await db.auditEvent.deleteMany({ where: { actorId: { in: ids } } });
	await db.studentAffiliation.deleteMany({ where: { studentId: { in: ids } } });
	await db.classCounselorAssignment.deleteMany({
		where: { OR: [{ classId: { in: classIds } }, { counselorId: { in: ids } }] },
	});
	await db.schoolClass.updateMany({
		where: { id: { in: classIds } },
		data: { counselorId: null },
	});
	await db.evidence.deleteMany({ where: { ownerId: { in: ids } } });
	await db.user.deleteMany({ where: { id: { in: ids } } });
	await db.schoolClass.deleteMany({ where: { id: { in: classIds } } });
	await db.major.deleteMany({ where: { collegeId: { in: collegeIds } } });
	await db.college.deleteMany({ where: { id: { in: collegeIds } } });
	await db.$disconnect();
});

test("账号模板按允许角色校验，管理员可预览并提交，其他角色不得导入", async () => {
	const template = templateFor("accounts");
	expect(template.version).toBe("accounts-v2");
	const rows = accountRows(template, [
		{
			login: "90000010",
			name: "账号模板学生",
			college: org.college.name,
			major: org.major.name,
			className: org.schoolClass.name,
		},
	]);
	await expect(
		previewAccountImport(users.counselor.session, rows),
	).rejects.toThrow("没有管理权限");
	const preview = await previewAccountImport(users.admin.session, {
		rows,
		note: "使用内置账号模板导入",
		fileHash: createHash("sha256").update(templateCsv(template)).digest("hex"),
		templateVersion: template.version,
	});
	expect(preview.rows[0].state).toBe("NEW");
	const committed = await commitAccountImport(users.admin.session, preview.id);
	expect(committed.created).toBe(1);
	expect(committed.credentials[0].login).toBe("90000010");
	const imported = await db.user.findUniqueOrThrow({
		where: { login: "90000010" },
		include: { studentProfile: true },
	});
	expect(imported.studentProfile?.classId).toBe(org.schoolClass.id);
	const templateResult = await resolveImportTemplate(
		users.admin.session,
		"accounts",
		{},
	);
	expect(templateResult.version).toBe("accounts-v2");
	await expect(
		resolveImportTemplate(users.counselor.session, "accounts", {}),
	).rejects.toThrow("没有访问权限");
});

test("成绩模板按角色开放，管理员和辅导员均能实际写入，其他角色被拒绝", async () => {
	const template = templateFor("grades");
	expect(template.version).toBe("grades-v4");
	const adminRows = gradeRows(template, [
		{
			...(await fixtureRows("grade-admin")),
			value: "90",
		},
	]);
	const counselorRows = gradeRows(template, [
		{
			...(await fixtureRows("grade-counselor")),
			value: "91",
		},
	]);
	await expect(
		previewGradeImport(users.publisher.session, termId, {
			nodeId: "grade",
			rows: adminRows,
			reason: "越权测试",
		}),
	).rejects.toThrow("没有操作权限");
	const adminPreview = await previewGradeImport(
		users.admin.session,
		termId,
		{ nodeId: "grade", rows: adminRows, reason: "管理员模板导入" },
		{ fileHash: createHash("sha256").update(templateCsv(template)).digest("hex"), templateVersion: template.version },
	);
	expect(adminPreview.errors).toBe(0);
	const adminCommitted = await commitGradeImport(
		users.admin.session,
		termId,
		adminPreview.id,
	);
	expect(adminCommitted.written).toBe(1);
	const counselorPreview = await previewGradeImport(
		users.counselor.session,
		termId,
		{ nodeId: "grade", rows: counselorRows, reason: "辅导员模板导入" },
		{ fileHash: createHash("sha256").update(templateCsv(template)).digest("hex"), templateVersion: template.version },
	);
	expect(counselorPreview.errors).toBe(0);
	const counselorCommitted = await commitGradeImport(
		users.counselor.session,
		termId,
		counselorPreview.id,
	);
	expect(
		"submittedForReview" in counselorCommitted &&
			counselorCommitted.submittedForReview,
	).toBe(true);
	const adminTemplate = await resolveImportTemplate(
		users.admin.session,
		"grades",
		{ termId, nodeId: "grade" },
	);
	const counselorTemplate = await resolveImportTemplate(
		users.counselor.session,
		"grades",
		{ termId, nodeId: "grade" },
	);
	expect(adminTemplate.version).toBe("grades-v4");
	expect(counselorTemplate.version).toBe("grades-v4");
	await expect(
		resolveImportTemplate(users.college.session, "grades", {
			termId,
			nodeId: "grade",
		}),
	).rejects.toThrow("没有操作权限");
});

test("参与模板按角色开放，管理员、发布者、学院均能实际导入，其他角色被拒绝", async () => {
	const template = templateFor("participation");
	expect(template.version).toBe("participation-v6");
	expect(template.headers).toEqual(["学号", "姓名"]);
	const activities = await db.activity.findMany({
		where: { termId },
		orderBy: { name: "asc" },
	});
	const byOwner = new Map(activities.map((activity) => [activity.ownerId, activity]));
	const actorFor = {
		admin: {
			session: users.admin.session,
			student: "participation-admin",
			activityId: activities.find((activity) => activity.name.includes("admin-activity"))!.id,
		},
		publisher: {
			session: users.publisher.session,
			student: "participation-publisher",
			activityId: byOwner.get(users.publisher.id)!.id,
		},
		college: {
			session: users.college.session,
			student: "participation-college",
			activityId: activities.find((activity) => activity.name.includes("college-activity"))!.id,
		},
	} as const;
	await expect(
		previewParticipationImport(users.counselor.session, termId, {
			activityId: actorFor.admin.activityId,
			kind: "INITIAL",
			rows: participationRows(template, [await fixtureRows("participation-admin")]),
			note: "越权测试",
		}),
	).rejects.toThrow("没有操作权限");
	await expect(
		previewParticipationImport(users["college-b"].session, termId, {
			activityId: actorFor.admin.activityId,
			kind: "INITIAL",
			rows: participationRows(template, [await fixtureRows("participation-admin")]),
			note: "跨学院越权测试",
		}),
	).rejects.toThrow("主办学院");
	for (const key of ["admin", "publisher", "college"] as const) {
		const actor = actorFor[key];
		const preview = await previewParticipationImport(
			actor.session,
			termId,
			{
				activityId: actor.activityId,
				kind: "INITIAL",
				rows: participationRows(template, [await fixtureRows(actor.student)]),
				note: `${key} 使用内置模板导入`,
			},
			{ fileHash: createHash("sha256").update(templateCsv(template)).digest("hex") },
		);
		expect(preview.errors).toBe(0);
		const committed = await commitParticipationImport(
			actor.session,
			termId,
			preview.id,
		);
		expect(committed.submitted).toBe(1);
	}
	const adminTemplate = await resolveImportTemplate(
		users.admin.session,
		"participation",
		{ termId, activityId: actorFor.admin.activityId },
	);
	const publisherTemplate = await resolveImportTemplate(
		users.publisher.session,
		"participation",
		{ termId, activityId: actorFor.publisher.activityId },
	);
	const collegeTemplate = await resolveImportTemplate(
		users.college.session,
		"participation",
		{ termId, activityId: actorFor.college.activityId },
	);
	expect(adminTemplate.version).toBe("participation-v6");
	expect(publisherTemplate.version).toBe("participation-v6");
	expect(collegeTemplate.version).toBe("participation-v6");
	await expect(
		resolveImportTemplate(users.counselor.session, "participation", {
			termId,
			activityId: actorFor.admin.activityId,
		}),
	).rejects.toThrow("没有操作权限");
	await expect(
		resolveImportTemplate(users["college-b"].session, "participation", {
			termId,
			activityId: actorFor.admin.activityId,
		}),
	).rejects.toThrow("主办学院");
});

test("参与名单按学号姓名匹配，组织差异只提示并可按系统档案提交", async () => {
	const relaxed = await student(
		"participation-relaxed",
		"90000011",
		"参与放宽学生",
	);
	const activity = await createActivity(
		"relaxed-activity",
		users.admin.id,
		org.college.id,
	);
	const evidence = await db.evidence.create({
		data: {
			ownerId: users.admin.id,
			name: "放宽身份测试证明.pdf",
			mime: "application/pdf",
			size: 1,
			sha256: "b".repeat(64),
			storageKey: `${marker}-relaxed-evidence`,
		},
	});
	await db.activityEvidence.create({
		data: {
			activityId: activity.id,
			evidenceId: evidence.id,
			version: 1,
			active: true,
			uploadedBy: users.admin.id,
			note: "放宽身份测试证明",
		},
	});
	const template = templateFor("participation");
	expect(template.headers).toEqual(["学号", "姓名"]);
	const preview = await previewParticipationImport(users.admin.session, termId, {
		activityId: activity.id,
		kind: "INITIAL",
		rows: [
			{
				login: "９０００００１１",
				name: "参与 放宽学生",
				college: "错误学院",
				major: "错误专业",
				className: "错误班级",
			},
		],
		note: "组织差异提示测试",
	});
	expect(preview.errors).toBe(0);
	expect(preview.warnings).toBe(1);
	expect(preview.rows[0].login).toBe("90000011");
	expect(preview.rows[0].college).toBe(org.college.name);
	expect(preview.rows[0].warnings[0]).toContain("已按系统档案处理");
	const committed = await commitParticipationImport(
		users.admin.session,
		termId,
		preview.id,
	);
	expect(committed.submitted).toBe(1);
	expect(committed.warnings).toBe(1);
	const fact = await db.participation.findFirstOrThrow({
		where: { activityId: activity.id, studentId: relaxed.id },
		include: { sources: true },
	});
	expect(fact.sources[0].status).toBe("PENDING_COUNSELOR");
});

test("成绩导入组织差异只提示，姓名不一致仍整批阻断", async () => {
	const target = await student("grade-relaxed", "90000012", "成绩放宽学生");
	const preview = await previewGradeImport(users.admin.session, termId, {
		nodeId: "grade",
		rows: [
			{
				login: target.login,
				name: target.name,
				college: "错误学院",
				major: "错误专业",
				className: "错误班级",
				value: "93",
			},
		],
		reason: "组织差异提示测试",
	});
	expect(preview.errors).toBe(0);
	expect(preview.warnings).toBe(1);
	expect(preview.rows[0].college).toBe(org.college.name);
	const committed = await commitGradeImport(
		users.admin.session,
		termId,
		preview.id,
	);
	expect(committed.written).toBe(1);
	expect(committed.warnings).toBe(1);
	const grade = await db.gradeInput.findFirstOrThrow({
		where: { termId, nodeId: "grade", studentId: target.id },
	});
	expect(grade.value.toFixed()).toBe("93");
	const mismatch = await previewGradeImport(users.admin.session, termId, {
		nodeId: "grade",
		rows: [{ login: target.login, name: "错误姓名", value: "94" }],
		reason: "姓名不一致测试",
	});
	expect(mismatch.errors).toBe(1);
	expect(mismatch.rows[0].message).toContain("学号与姓名不一致");
	const activity = await createActivity(
		"name-mismatch-activity",
		users.admin.id,
		org.college.id,
	);
	const participationMismatch = await previewParticipationImport(
		users.admin.session,
		termId,
		{
			activityId: activity.id,
			kind: "INITIAL",
			rows: [{ login: target.login, name: "错误姓名" }],
			note: "姓名不一致测试",
		},
	);
	expect(participationMismatch.errors).toBe(1);
	expect(participationMismatch.rows[0].message).toContain("学号与姓名不一致");
});
