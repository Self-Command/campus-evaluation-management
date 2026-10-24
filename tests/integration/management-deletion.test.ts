import { afterAll, beforeAll, expect, test } from "vitest";
import { db } from "@/server/db";
import {
	accountUsage,
	createAccount,
	deleteAccount,
	deleteStudentAccount,
	updateAccount,
} from "@/server/accounts";
import { correctStudentNumber } from "@/server/students";
import { deleteOrganization, organizationUsage } from "@/server/organizations";
import {
	commitAccountImport,
	listAccountImports,
	previewAccountImport,
	readAccountImport,
	revokeAccountImport,
} from "@/server/account-import";
import { organizationFixture } from "./organization-fixture";

if (!new URL(process.env.DATABASE_URL!).pathname.startsWith("/campus_test_"))
	throw new Error("必须使用临时测试数据库");

const userIds = new Set<string>();
let adminId = "";
let adminSession = "";
let termId = "";
let orgA: Awaited<ReturnType<typeof organizationFixture>>;
let orgB: Awaited<ReturnType<typeof organizationFixture>>;

function track<T extends { id: string }>(row: T) {
	userIds.add(row.id);
	return row;
}

async function sessionFor(userId: string) {
	return (
		await db.authSession.create({
			data: {
				userId,
				version: 0,
				expiresAt: new Date(Date.now() + 600_000),
			},
		})
	).id;
}

async function student(label: string, org = orgA, name = `删除测试学生${label}`) {
	const created = await createAccount(adminSession, {
		name,
		login: `md-${label}`,
		role: "STUDENT",
		classId: org.schoolClass.id,
	});
	track(created.user);
	return created.user;
}

async function staff(
	label: string,
	role: "COUNSELOR" | "COLLEGE" = "COUNSELOR",
) {
	const created = await createAccount(adminSession, {
		name: `删除测试员工${label}`,
		login: `md-${label}`,
		role,
		collegeId: orgA.college.id,
	});
	track(created.user);
	return created.user;
}

beforeAll(async () => {
	await db.studentAffiliation.deleteMany();
	await db.duplicateIdentityException.deleteMany();
	await db.accountImport.deleteMany();
	await db.user.deleteMany();
	await db.auditEvent.deleteMany();
	const admin = await db.user.create({
		data: {
			login: "md-admin",
			name: "删除测试管理员",
			role: "ADMIN",
			passwordHash: "fixture-only",
			mustChangePassword: false,
		},
	});
	adminId = admin.id;
	adminSession = await sessionFor(admin.id);
	orgA = await organizationFixture("md-A", {
		college: "删除测试甲学院",
		major: "删除测试甲专业",
		className: "删除测试甲班",
	});
	orgB = await organizationFixture("md-B", {
		college: "删除测试乙学院",
		major: "删除测试乙专业",
		className: "删除测试乙班",
	});
	const term = await db.term.create({
		data: {
			name: "删除测试周期",
			scheme: { nodes: [], deductions: [] },
		},
	});
	termId = term.id;
});

afterAll(async () => {
	await db.gradeInput.deleteMany({ where: { termId } });
	if (termId) await db.term.deleteMany({ where: { id: termId } });
	await db.accountImport.deleteMany({ where: { actorId: adminId } });
	await db.duplicateIdentityException.deleteMany({
		where: {
			OR: [
				{ actorId: adminId },
				{ studentIdA: { in: [...userIds] } },
				{ studentIdB: { in: [...userIds] } },
			],
		},
	});
	await db.studentAffiliation.deleteMany({
		where: { studentId: { in: [...userIds] } },
	});
	await db.classCounselorAssignment.deleteMany({
		where: { counselorId: { in: [...userIds] } },
	});
	await db.schoolClass.updateMany({
		where: { counselorId: { in: [...userIds] } },
		data: { counselorId: null },
	});
	await db.schoolClass.updateMany({
		where: { id: { in: [orgA.schoolClass.id, orgB.schoolClass.id] } },
		data: { counselorId: null },
	});
	await db.auditEvent.deleteMany({
		where: { actorId: { in: [...userIds, adminId] } },
	});
	await db.user.deleteMany({ where: { id: { in: [...userIds] } } });
	await db.$disconnect();
});

test("组织删除先检查关联数据，空组织可按名称确认后删除", async () => {
	const emptyCollege = await db.college.create({
		data: { code: "md-empty-college", name: "删除测试空学院" },
	});
	const usage = await organizationUsage(adminSession, "college", emptyCollege.id);
	expect(usage.canDelete).toBe(true);
	await expect(
		deleteOrganization(adminSession, {
			kind: "college",
			id: emptyCollege.id,
			revision: usage.revision,
			reason: "重复建立",
			confirmName: "名称不匹配",
		}),
	).rejects.toThrow("完整的组织名称");
	await deleteOrganization(adminSession, {
		kind: "college",
		id: emptyCollege.id,
		revision: usage.revision,
		reason: "重复建立",
		confirmName: emptyCollege.name,
	});
	expect(await db.college.count({ where: { id: emptyCollege.id } })).toBe(0);

	const blocked = await organizationUsage(
		adminSession,
		"college",
		orgA.college.id,
	);
	expect(blocked.canDelete).toBe(false);
	expect(blocked.blockers.map((item) => item.key)).toEqual(
		expect.arrayContaining(["majors", "staff"]),
	);
	await expect(
		deleteOrganization(adminSession, {
			kind: "college",
			id: orgA.college.id,
			revision: blocked.revision,
			reason: "测试阻断",
			confirmName: orgA.college.name,
		}),
	).rejects.toThrow("不能删除");

	const tempMajor = await db.major.create({
		data: {
			code: "md-temp-major",
			name: "删除测试临时专业",
			collegeId: orgB.college.id,
		},
	});
	const majorUsage = await organizationUsage(
		adminSession,
		"major",
		tempMajor.id,
	);
	expect(majorUsage.canDelete).toBe(true);
	await deleteOrganization(adminSession, {
		kind: "major",
		id: tempMajor.id,
		revision: majorUsage.revision,
		reason: "临时专业不再使用",
		confirmName: tempMajor.name,
	});
	expect(await db.major.count({ where: { id: tempMajor.id } })).toBe(0);

	const classMajor = await db.major.create({
		data: {
			code: "md-class-major",
			name: "删除测试班级专业",
			collegeId: orgB.college.id,
		},
	});
	const tempClass = await db.schoolClass.create({
		data: {
			code: "md-temp-class",
			name: "删除测试临时班级",
			majorId: classMajor.id,
		},
	});
	const classUsage = await organizationUsage(
		adminSession,
		"class",
		tempClass.id,
	);
	expect(classUsage.canDelete).toBe(true);
	await deleteOrganization(adminSession, {
		kind: "class",
		id: tempClass.id,
		revision: classUsage.revision,
		reason: "临时班级合并",
		confirmName: tempClass.name,
	});
	expect(await db.schoolClass.count({ where: { id: tempClass.id } })).toBe(0);
	await db.major.delete({ where: { id: classMajor.id } });

	await student("class-blocker", orgA, "班级阻断测试学生");
	const blockedClass = await organizationUsage(
		adminSession,
		"class",
		orgA.schoolClass.id,
	);
	expect(blockedClass.blockers.map((item) => item.key)).toContain("students");
	await expect(
		deleteOrganization(adminSession, {
			kind: "class",
			id: orgA.schoolClass.id,
			revision: blockedClass.revision,
			reason: "测试阻断",
			confirmName: orgA.schoolClass.name,
		}),
	).rejects.toThrow("不能删除");
});

test("教职账号导入严格匹配学院，同名同角色需确认，学生学号不可复用", async () => {
	const base = {
		login: "md-import-counselor",
		name: "导入测试辅导员",
		collegeCode: orgA.college.code.toLowerCase(),
		college: orgA.college.name,
	};
	const blockedPreview = await previewAccountImport(adminSession, {
		targetRole: "COUNSELOR",
		rows: [{ ...base, college: orgB.college.name }],
		note: "学院编码名称不一致",
	});
	expect(blockedPreview.rows[0].state).toBe("ERROR");
	expect(blockedPreview.rows[0].message).toContain("唯一的已启用学院");
	await expect(
		commitAccountImport(adminSession, blockedPreview.id),
	).rejects.toThrow("错误行");

	const preview = await previewAccountImport(adminSession, {
		targetRole: "COUNSELOR",
		rows: [base],
		note: "导入辅导员批次",
	});
	expect(preview.rows[0].state).toBe("NEW");
	const committed = await commitAccountImport(adminSession, preview.id);
	expect(committed.created).toBe(1);
	const counselor = await db.user.findUniqueOrThrow({
		where: { login: base.login },
	});
	track(counselor);
	expect(counselor.role).toBe("COUNSELOR");
	expect(counselor.collegeId).toBe(orgA.college.id);

	const collegePreview = await previewAccountImport(adminSession, {
		targetRole: "COLLEGE",
		rows: [
			{
				login: "md-import-college",
				name: "导入测试学院管理员",
				collegeCode: orgA.college.code,
				college: orgA.college.name,
			},
		],
		note: "导入学院管理员批次",
	});
	expect(collegePreview.rows[0].state).toBe("NEW");
	const collegeCommitted = await commitAccountImport(
		adminSession,
		collegePreview.id,
	);
	expect(collegeCommitted.created).toBe(1);
	const importedCollege = await db.user.findUniqueOrThrow({
		where: { login: "md-import-college" },
	});
	track(importedCollege);
	expect(importedCollege.role).toBe("COLLEGE");
	expect(importedCollege.collegeId).toBe(orgA.college.id);

	const duplicatePreview = await previewAccountImport(adminSession, {
		targetRole: "COUNSELOR",
		rows: [
			{
				...base,
				login: "md-import-counselor-2",
				name: "导入测试辅导员",
			},
		],
		note: "同学院同名辅导员",
	});
	expect(duplicatePreview.rows[0].state).toBe("DUPLICATE");
	expect(duplicatePreview.rows[0].duplicateCandidates?.[0]?.login).toBe(
		base.login,
	);
	await expect(
		commitAccountImport(adminSession, duplicatePreview.id),
	).rejects.toThrow("未处理");
	const resolvedCommitted = await commitAccountImport(
		adminSession,
		duplicatePreview.id,
		{
			resolutions: [
				{
					line: duplicatePreview.rows[0].line,
					action: "KEEP_BOTH",
					reason: "学院人事名单核对确认两名辅导员同名但为不同人员",
				},
			],
		},
	);
	expect(resolvedCommitted.created).toBe(1);
	const secondCounselor = await db.user.findUniqueOrThrow({
		where: { login: "md-import-counselor-2" },
	});
	track(secondCounselor);

	const existingStudent = await student(
		"import-collision",
		orgA,
		"学号占用测试学生",
	);
	const collisionPreview = await previewAccountImport(adminSession, {
		targetRole: "COLLEGE",
		rows: [
			{
				login: existingStudent.login,
				name: "编号占用测试",
				collegeCode: orgA.college.code,
				college: orgA.college.name,
			},
		],
		note: "学生学号作为教职登录账号",
	});
	expect(collisionPreview.rows[0].state).toBe("ERROR");
	expect(collisionPreview.rows[0].message).toContain("其他身份");
});

test("账号删除严格检查业务记录，空账号同时清理档案、异动和会话", async () => {
	const target = await student("delete-clean", orgA, "可删除测试学生");
	const targetSession = await sessionFor(target.id);
	const usage = await accountUsage(adminSession, target.id);
	expect(usage.canDelete).toBe(true);
	expect(usage.notes.join("")).toContain("学生档案");
	await expect(
		deleteAccount(adminSession, target.id, {
			revision: usage.revision,
			reason: "重复导入",
			confirmLogin: "wrong-login",
		}),
	).rejects.toThrow("完整的登录账号");
	const removed = await deleteStudentAccount(adminSession, target.id, {
		revision: usage.revision,
		reason: "重复导入",
		confirmLogin: target.login,
	});
	expect(removed.deleted).toBe(true);
	expect(
		await db.user.count({ where: { id: target.id } }),
	).toBe(0);
	expect(
		await db.studentProfile.count({ where: { userId: target.id } }),
	).toBe(0);
	expect(
		await db.studentAffiliation.count({ where: { studentId: target.id } }),
	).toBe(0);
	expect(
		await db.authSession.count({ where: { id: targetSession } }),
	).toBe(0);
	expect(
		await db.auditEvent.count({
			where: { action: "ACCOUNT_DELETED", targetId: target.id },
		}),
	).toBe(1);

	const withBusiness = await student(
		"delete-blocked",
		orgA,
		"有成绩测试学生",
	);
	await db.gradeInput.create({
		data: {
			termId,
			studentId: withBusiness.id,
			nodeId: "grade",
			value: "88",
		},
	});
	const blockedUsage = await accountUsage(adminSession, withBusiness.id);
	expect(blockedUsage.canDelete).toBe(false);
	expect(blockedUsage.blockers.map((item) => item.key)).toContain("grades");
	await expect(
		deleteAccount(adminSession, withBusiness.id, {
			revision: blockedUsage.revision,
			reason: "测试业务阻断",
			confirmLogin: withBusiness.login,
		}),
	).rejects.toThrow("成绩录入");
	await expect(
		deleteStudentAccount(adminSession, withBusiness.id, {
			revision: blockedUsage.revision,
			reason: "测试业务阻断",
			confirmLogin: withBusiness.login,
		}),
	).rejects.toThrow("不能删除");
	expect(
		await db.user.count({ where: { id: withBusiness.id } }),
	).toBe(1);

	const counselor = await staff("delete-staff");
	await expect(
		deleteStudentAccount(adminSession, counselor.id, {
			revision: 0,
			reason: "不是学生",
			confirmLogin: counselor.login,
		}),
	).rejects.toThrow("不是学生账号");
	await db.schoolClass.update({
		where: { id: orgB.schoolClass.id },
		data: { counselorId: counselor.id },
	});
	const staffUsage = await accountUsage(adminSession, counselor.id);
	expect(staffUsage.blockers.map((item) => item.key)).toContain("classes");
	await expect(
		deleteAccount(adminSession, counselor.id, {
			revision: staffUsage.revision,
			reason: "测试班级阻断",
			confirmLogin: counselor.login,
		}),
	).rejects.toThrow("负责班级");
	await db.schoolClass.update({
		where: { id: orgB.schoolClass.id },
		data: { counselorId: orgB.counselor.id },
	});
	const cleanStaffUsage = await accountUsage(adminSession, counselor.id);
	expect(cleanStaffUsage.canDelete).toBe(true);
	await deleteAccount(adminSession, counselor.id, {
		revision: cleanStaffUsage.revision,
		reason: "建号错误",
		confirmLogin: counselor.login,
	});
	expect(await db.user.count({ where: { id: counselor.id } })).toBe(0);

	const selfUsage = await accountUsage(adminSession, adminId);
	expect(selfUsage.canDelete).toBe(false);
	expect(selfUsage.blockers.map((item) => item.key)).toContain("self");
	await expect(
		deleteAccount(adminSession, adminId, {
			revision: selfUsage.revision,
			reason: "测试自删",
			confirmLogin: "md-admin",
		}),
	).rejects.toThrow("当前登录账号");
});

test("学生转教职时，有业务记录阻断，无业务记录清理学生档案和异动", async () => {
	const withBusiness = await student(
		"role-blocked",
		orgA,
		"转身份受阻学生",
	);
	await db.gradeInput.create({
		data: {
			termId,
			studentId: withBusiness.id,
			nodeId: "grade",
			value: "91",
		},
	});
	await expect(
		updateAccount(adminSession, withBusiness.id, {
			revision: 0,
			reason: "误把学生当辅导员",
			disabled: false,
			account: {
				name: withBusiness.name,
				login: withBusiness.login,
				role: "COUNSELOR",
				collegeId: orgA.college.id,
			},
		}),
	).rejects.toThrow("业务记录");
	expect(
		(await db.user.findUniqueOrThrow({ where: { id: withBusiness.id } })).role,
	).toBe("STUDENT");

	const clean = await student("role-clean", orgA, "转身份清理学生");
	const cleanSession = await sessionFor(clean.id);
	const updated = await updateAccount(adminSession, clean.id, {
		revision: 0,
		reason: "岗位调整",
		disabled: false,
		account: {
			name: clean.name,
			login: clean.login,
			role: "COUNSELOR",
			collegeId: orgA.college.id,
		},
	});
	expect(updated.role).toBe("COUNSELOR");
	expect(updated.studentProfile).toBeNull();
	expect(
		await db.studentProfile.count({ where: { userId: clean.id } }),
	).toBe(0);
	expect(
		await db.studentAffiliation.count({ where: { studentId: clean.id } }),
	).toBe(0);
	expect(
		await db.authSession.count({
			where: { id: cleanSession, revokedAt: null },
		}),
	).toBe(0);
	const audit = await db.auditEvent.findFirstOrThrow({
		where: { targetId: clean.id, action: "ACCOUNT_UPDATED" },
	});
	expect(JSON.stringify(audit.details)).toContain("studentCleanup");
});

test("学号更正同步登录名、撤销会话并保持唯一性", async () => {
	const target = await student("number-target", orgA, "更正学号学生");
	const targetSession = await sessionFor(target.id);
	const corrected = await correctStudentNumber(adminSession, target.id, {
		revision: 0,
		studentNumber: "md-number-new",
		reason: "学籍名单核对后更正",
	});
	expect(corrected.login).toBe("md-number-new");
	expect(corrected.studentProfile?.studentNumber).toBe("md-number-new");
	expect(
		(await db.user.findUniqueOrThrow({ where: { id: target.id } })).login,
	).toBe("md-number-new");
	expect(
		await db.authSession.count({
			where: { id: targetSession, revokedAt: null },
		}),
	).toBe(0);
	expect(
		await db.auditEvent.count({
			where: { action: "STUDENT_NUMBER_CORRECTED", targetId: target.id },
		}),
	).toBe(1);
	await expect(
		correctStudentNumber(adminSession, target.id, {
			revision: 0,
			studentNumber: "md-number-again",
			reason: "过期修订",
		}),
	).rejects.toThrow("已变化");

	const other = await student("number-other", orgA, "学号占用学生");
	await expect(
		correctStudentNumber(adminSession, other.id, {
			revision: 0,
			studentNumber: "md-number-new",
			reason: "学号冲突测试",
		}),
	).rejects.toThrow("占用");
	const staffMember = await staff("number-staff-login");
	await expect(
		correctStudentNumber(adminSession, other.id, {
			revision: 0,
			studentNumber: staffMember.login,
			reason: "登录账号冲突测试",
		}),
	).rejects.toThrow("占用");
	await expect(
		correctStudentNumber(adminSession, other.id, {
			revision: 0,
			studentNumber: "bad number!",
			reason: "格式校验测试",
		}),
	).rejects.toThrow();
	expect(
		(await db.user.findUniqueOrThrow({ where: { id: other.id } })).login,
	).toBe(other.login);
});

test("导入历史按批次列出，整批撤销删除全部新建账号并保留审计", async () => {
	const rows = [
		{
			login: "md-revoke-a",
			name: "撤销测试学生甲",
			college: orgA.college.name,
			major: orgA.major.name,
			className: orgA.schoolClass.name,
		},
		{
			login: "md-revoke-b",
			name: "撤销测试学生乙",
			college: orgA.college.name,
			major: orgA.major.name,
			className: orgA.schoolClass.name,
		},
	];
	const preview = await previewAccountImport(adminSession, {
		rows,
		note: "可撤销导入批次",
	});
	expect(preview.rows.every((row) => row.state === "NEW")).toBe(true);
	const committed = await commitAccountImport(adminSession, preview.id);
	expect(committed.created).toBe(2);
	const users = await db.user.findMany({
		where: { login: { in: rows.map((row) => row.login) } },
	});
	users.forEach(track);
	expect(users).toHaveLength(2);
	const liveSession = await sessionFor(users[0].id);

	const history = await listAccountImports(adminSession, {
		q: preview.id,
		page: 1,
	});
	expect(history.total).toBe(1);
	expect(history.items[0]).toMatchObject({
		id: preview.id,
		targetRole: "STUDENT",
		status: "COMMITTED",
		created: 2,
		actor: { id: adminId },
	});
	const detail = await readAccountImport(adminSession, preview.id);
	expect(detail.rows.filter((row) => row.userId).map((row) => row.login).sort()).toEqual(
		["md-revoke-a", "md-revoke-b"],
	);
	expect(detail.revoke.canRevoke).toBe(true);
	await expect(
		revokeAccountImport(adminSession, preview.id, { reason: "短" }),
	).rejects.toThrow("撤销理由");
	const revoked = await revokeAccountImport(adminSession, preview.id, {
		reason: "名单整批导入错误",
	});
	expect(revoked.revoked).toBe(2);
	expect(revoked.replay).toBe(false);
	expect(
		await db.user.count({ where: { id: { in: users.map((user) => user.id) } } }),
	).toBe(0);
	expect(
		await db.studentProfile.count({
			where: { userId: { in: users.map((user) => user.id) } },
		}),
	).toBe(0);
	expect(
		await db.studentAffiliation.count({
			where: { studentId: { in: users.map((user) => user.id) } },
		}),
	).toBe(0);
	expect(await db.authSession.count({ where: { id: liveSession } })).toBe(0);
	const after = await db.accountImport.findUniqueOrThrow({
		where: { id: preview.id },
	});
	expect(after.status).toBe("REVOKED");
	expect(after.revokedAt).not.toBeNull();
	expect(after.revokedBy).toBe(adminId);
	expect(after.revokeReason).toBe("名单整批导入错误");
	expect(
		await db.auditEvent.count({
			where: { action: "ACCOUNT_IMPORT_REVOKED", targetId: preview.id },
		}),
	).toBe(1);
	const replay = await revokeAccountImport(adminSession, preview.id, {
		reason: "重复点击",
	});
	expect(replay.replay).toBe(true);
	expect(replay.revoked).toBe(0);
	const revokedDetail = await readAccountImport(adminSession, preview.id);
	expect(revokedDetail.revoke.canRevoke).toBe(false);
	expect(revokedDetail.revoke.reason).toContain("已整批撤销");
});

test("任一账号有业务记录或身份变更时整批不撤销，已删除账号按缺失跳过", async () => {
	const businessRows = [
		{
			login: "md-revoke-blocked-a",
			name: "撤销阻断学生甲",
			college: orgA.college.name,
			major: orgA.major.name,
			className: orgA.schoolClass.name,
		},
		{
			login: "md-revoke-blocked-b",
			name: "撤销阻断学生乙",
			college: orgA.college.name,
			major: orgA.major.name,
			className: orgA.schoolClass.name,
		},
	];
	const businessPreview = await previewAccountImport(adminSession, {
		rows: businessRows,
		note: "有业务记录不可撤销",
	});
	await commitAccountImport(adminSession, businessPreview.id);
	const businessUsers = await db.user.findMany({
		where: { login: { in: businessRows.map((row) => row.login) } },
	});
	businessUsers.forEach(track);
	await db.gradeInput.create({
		data: {
			termId,
			studentId: businessUsers[0].id,
			nodeId: "grade",
			value: "77",
		},
	});
	const blockedDetail = await readAccountImport(
		adminSession,
		businessPreview.id,
	);
	expect(blockedDetail.revoke.canRevoke).toBe(false);
	expect(
		blockedDetail.revoke.accounts
			.find((account) => account.login === businessUsers[0].login)
			?.blockers.map((item) => item.key),
	).toContain("grades");
	await expect(
		revokeAccountImport(adminSession, businessPreview.id, {
			reason: "尝试撤销有业务批次",
		}),
	).rejects.toThrow("成绩录入");
	expect(
		await db.user.count({
			where: { id: { in: businessUsers.map((user) => user.id) } },
		}),
	).toBe(2);

	const rolePreview = await previewAccountImport(adminSession, {
		rows: [
			{
				login: "md-revoke-role",
				name: "撤销身份变更学生",
				college: orgA.college.name,
				major: orgA.major.name,
				className: orgA.schoolClass.name,
			},
		],
		note: "身份已变更不可撤销",
	});
	await commitAccountImport(adminSession, rolePreview.id);
	const roleUser = await db.user.findUniqueOrThrow({
		where: { login: "md-revoke-role" },
	});
	track(roleUser);
	await db.user.update({
		where: { id: roleUser.id },
		data: { role: "COUNSELOR", collegeId: orgA.college.id },
	});
	const roleDetail = await readAccountImport(adminSession, rolePreview.id);
	expect(roleDetail.revoke.canRevoke).toBe(false);
	expect(roleDetail.revoke.accounts[0].blockers.map((item) => item.key)).toContain(
		"roleChanged",
	);
	await expect(
		revokeAccountImport(adminSession, rolePreview.id, {
			reason: "尝试撤销已变更身份批次",
		}),
	).rejects.toThrow("身份已变更");
	expect(
		await db.user.count({ where: { id: roleUser.id } }),
	).toBe(1);

	const missingRows = [
		{
			login: "md-revoke-missing-a",
			name: "撤销缺失学生甲",
			college: orgA.college.name,
			major: orgA.major.name,
			className: orgA.schoolClass.name,
		},
		{
			login: "md-revoke-missing-b",
			name: "撤销缺失学生乙",
			college: orgA.college.name,
			major: orgA.major.name,
			className: orgA.schoolClass.name,
		},
	];
	const missingPreview = await previewAccountImport(adminSession, {
		rows: missingRows,
		note: "部分账号已单独删除",
	});
	await commitAccountImport(adminSession, missingPreview.id);
	const missingUsers = await db.user.findMany({
		where: { login: { in: missingRows.map((row) => row.login) } },
	});
	missingUsers.forEach(track);
	await deleteAccount(adminSession, missingUsers[0].id, {
		revision: 0,
		reason: "单独删除错误账号",
		confirmLogin: missingUsers[0].login,
	});
	const missingDetail = await readAccountImport(
		adminSession,
		missingPreview.id,
	);
	expect(missingDetail.revoke.missing.map((item) => item.login)).toEqual([
		missingUsers[0].login,
	]);
	expect(missingDetail.revoke.canRevoke).toBe(true);
	const missingRevoked = await revokeAccountImport(
		adminSession,
		missingPreview.id,
		{ reason: "整批名单作废" },
	);
	expect(missingRevoked.revoked).toBe(1);
	expect(missingRevoked.missing).toHaveLength(1);
	expect(
		await db.user.count({ where: { id: missingUsers[1].id } }),
	).toBe(0);
});
