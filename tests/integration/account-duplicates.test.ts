import { afterAll, beforeAll, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { getCurrentSession } from "@/server/auth";
import {
	disableDuplicateAccount,
	listDuplicateGroups,
} from "@/server/account-duplicates";
import { createAccount } from "@/server/accounts";
import { organizationFixture } from "./organization-fixture";

if (!new URL(process.env.DATABASE_URL!).pathname.startsWith("/campus_test_"))
	throw new Error("必须使用临时测试数据库");

const marker = `dup-${randomUUID().slice(0, 8)}`;
let org: Awaited<ReturnType<typeof organizationFixture>>;
let adminId = "";
let adminSession = "";
let counselorSession = "";
let olderId = "";
let newerId = "";
let thirdId = "";
let newerSession = "";
let termId = "";
const studentIds: string[] = [];

async function student(name: string, login: string) {
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
					college: org.college.name,
					major: org.major.name,
					className: org.schoolClass.name,
					classId: org.schoolClass.id,
				},
			},
		},
	});
	studentIds.push(user.id);
	return user;
}

beforeAll(async () => {
	await db.duplicateIdentityException.deleteMany();
	org = await organizationFixture(`${marker}-org`, {
		college: `${marker}学院`,
		major: `${marker}专业`,
		className: `${marker}班级`,
	});
	const admin = await db.user.create({
		data: {
			login: `${marker}-admin`,
			name: "重复账号管理员",
			role: "ADMIN",
			passwordHash: "fixture-only",
			mustChangePassword: false,
		},
	});
	adminId = admin.id;
	adminSession = (
		await db.authSession.create({
			data: {
				userId: admin.id,
				version: 0,
				expiresAt: new Date(Date.now() + 600_000),
			},
		})
	).id;
	counselorSession = (
		await db.authSession.create({
			data: {
				userId: org.counselor.id,
				version: 0,
				expiresAt: new Date(Date.now() + 600_000),
			},
		})
	).id;
	const older = await student("同名处置学生", "91000001");
	olderId = older.id;
	const term = await db.term.create({
		data: {
			name: `${marker}-周期`,
			scheme: { nodes: [], deductions: [] },
		},
	});
	termId = term.id;
	await db.personalClaim.create({
		data: {
			termId: term.id,
			studentId: older.id,
			title: "历史申报",
			occurredOn: "2026-09-01",
			note: "用于校验停用账号前的业务记录保护",
		},
	});
	const newer = await student("同名处置学生", "91000002");
	newerId = newer.id;
	await db.studentAffiliation.create({
		data: {
			studentId: newer.id,
			classId: org.schoolClass.id,
			identity: {
				college: org.college.name,
				major: org.major.name,
				className: org.schoolClass.name,
			},
			actorId: admin.id,
			reason: "账号导入建立班级归属",
		},
	});
	newerSession = (
		await db.authSession.create({
			data: {
				userId: newer.id,
				version: 0,
				expiresAt: new Date(Date.now() + 600_000),
			},
		})
	).id;
	const third = await student("同名处置学生", "91000003");
	thirdId = third.id;
});

afterAll(async () => {
	const ids = [adminId, org.counselor.id, ...studentIds].filter(Boolean);
	await db.duplicateIdentityException.deleteMany();
	await db.personalClaim.deleteMany({ where: { termId } });
	await db.term.deleteMany({ where: { id: termId } });
	await db.studentAffiliation.deleteMany({ where: { studentId: { in: ids } } });
	await db.classCounselorAssignment.deleteMany({
		where: {
			OR: [
				{ classId: org.schoolClass.id },
				{ counselorId: org.counselor.id },
			],
		},
	});
	await db.auditEvent.deleteMany({ where: { actorId: { in: ids } } });
	await db.schoolClass.update({
		where: { id: org.schoolClass.id },
		data: { counselorId: null },
	});
	await db.user.deleteMany({ where: { id: { in: ids } } });
	await db.schoolClass.delete({ where: { id: org.schoolClass.id } });
	await db.major.delete({ where: { id: org.major.id } });
	await db.college.delete({ where: { id: org.college.id } });
	await db.$disconnect();
});

test("重复账号列表按同班同名汇总，优先保留有历史记录的较早账号", async () => {
	const result = await listDuplicateGroups(adminSession);
	const group = result.groups.find(
		(item) => item.className === org.schoolClass.name,
	);
	expect(group).toBeTruthy();
	expect(group!.accounts).toHaveLength(3);
	expect(group!.status).toBe("OPEN");
	const recommended = group!.accounts.find((account) => account.recommended);
	expect(recommended?.id).toBe(olderId);
	expect(recommended?.businessTotal).toBe(1);
	expect(
		group!.accounts.find((account) => account.id === newerId)?.canDisable,
	).toBe(true);
});

test("非管理员不能查看或处置重复账号", async () => {
	await expect(listDuplicateGroups(counselorSession)).rejects.toThrow(
		"没有管理权限",
	);
	await expect(
		disableDuplicateAccount(counselorSession, {
			studentId: newerId,
			keepId: olderId,
			reason: "辅导员尝试处置重复账号但没有管理员权限",
		}),
	).rejects.toThrow("没有管理权限");
});

test("停用无业务记录账号会撤销会话并写入永久审计和确认依据", async () => {
	await expect(
		disableDuplicateAccount(adminSession, {
			studentId: newerId,
			keepId: olderId,
			reason: "短",
		}),
	).rejects.toThrow("10个字");
	const result = await disableDuplicateAccount(adminSession, {
		studentId: newerId,
		keepId: olderId,
		reason: "辅导员核对学籍名单，确认保留较早建立且承担全部记录的账号",
	});
	expect(result.status).toBe("DISABLED");
	const archived = await db.user.findUniqueOrThrow({ where: { id: newerId } });
	expect(archived.disabled).toBe(true);
	expect(archived.mergedIntoId).toBe(olderId);
	expect(await getCurrentSession(newerSession)).toBeNull();
	expect(
		await db.auditEvent.count({
			where: {
				actorId: adminId,
				action: "ACCOUNT_DUPLICATE_DISABLED",
				targetId: newerId,
			},
		}),
	).toBe(1);
	expect(await db.duplicateIdentityException.count()).toBe(1);
	const resultAfter = await listDuplicateGroups(adminSession);
	const group = resultAfter.groups.find(
		(item) => item.className === org.schoolClass.name,
	);
	expect(group).toBeTruthy();
	expect(
		group!.accounts.find((account) => account.id === newerId)?.disabled,
	).toBe(true);
	expect(group!.status).toBe("OPEN");
});

test("仍有关联业务或历史记录的账号不能被直接停用", async () => {
	await expect(
		disableDuplicateAccount(adminSession, {
			studentId: olderId,
			keepId: thirdId,
			reason: "尝试停用有历史记录的账号，应该被业务记录保护拦截",
		}),
	).rejects.toThrow("1 条业务或历史记录");
	const stillActive = await db.user.findUniqueOrThrow({
		where: { id: olderId },
	});
	expect(stillActive.disabled).toBe(false);
	expect(stillActive.mergedIntoId).toBeNull();
});

test("已确认保留的双账号不再提供重复停用操作", async () => {
	const confirmedA = await createAccount(adminSession, {
		name: "已确认同名学生",
		login: "92000001",
		role: "STUDENT",
		classId: org.schoolClass.id,
	});
	const confirmedB = await createAccount(adminSession, {
		name: "已确认同名学生",
		login: "92000002",
		role: "STUDENT",
		classId: org.schoolClass.id,
		duplicateReason: "学籍名单核对确认两名学生同名但学号不同",
	});
	studentIds.push(confirmedA.user.id, confirmedB.user.id);
	const result = await listDuplicateGroups(adminSession);
	const group = result.groups.find(
		(item) => item.name === "已确认同名学生",
	);
	expect(group).toBeTruthy();
	expect(group!.status).toBe("CONFIRMED");
	expect(group!.accounts.every((account) => !account.canDisable)).toBe(true);
	await expect(
		disableDuplicateAccount(adminSession, {
			studentId: confirmedA.user.id,
			keepId: confirmedB.user.id,
			reason: "已确认保留的账号不应再通过重复账号入口停用",
		}),
	).rejects.toThrow("已确认保留");
});
