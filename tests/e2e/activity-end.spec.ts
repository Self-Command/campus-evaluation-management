import "dotenv/config";
import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { hash } from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client";
import { login } from "./login";

const db = new PrismaClient({
	adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
const prefix = `e2e-end-${randomBytes(4).toString("hex")}`;
const password = `Pw!${randomBytes(6).toString("hex")}`;
const activityName = `${prefix} 手动结束活动`;
const ids = {
	college: "",
	major: "",
	schoolClass: "",
	collegeUser: "",
	student: "",
	activity: "",
	term: "",
};

test.beforeAll(async () => {
	const term = await db.term.findFirst({
		where: { phase: "ACTIVE", disposition: "NORMAL" },
		orderBy: { createdAt: "desc" },
	});
	if (!term) return;
	const scheme = term.scheme as { nodes?: { id: string; kind: string }[] };
	const node = scheme.nodes?.find((item) => item.kind === "ACTIVITY");
	if (!node) return;
	ids.term = term.id;
	const college = await db.college.create({
		data: { code: prefix, name: `${prefix} 测试学院` },
	});
	ids.college = college.id;
	const major = await db.major.create({
		data: { code: "M", name: `${prefix} 测试专业`, collegeId: college.id },
	});
	ids.major = major.id;
	const schoolClass = await db.schoolClass.create({
		data: { code: "C", name: `${prefix} 测试班级`, majorId: major.id },
	});
	ids.schoolClass = schoolClass.id;
	const collegeUser = await db.user.create({
		data: {
			login: `${prefix}-college`,
			name: "结束活动学院管理员",
			role: "COLLEGE",
			collegeId: college.id,
			passwordHash: await hash(password, 10),
			mustChangePassword: false,
		},
	});
	ids.collegeUser = collegeUser.id;
	const student = await db.user.create({
		data: {
			login: `${prefix}-student`,
			name: "结束活动学生",
			role: "STUDENT",
			passwordHash: await hash(password, 10),
			mustChangePassword: false,
			studentProfile: {
				create: {
					studentNumber: `${prefix}-student`,
					college: college.name,
					major: major.name,
					className: schoolClass.name,
					classId: schoolClass.id,
				},
			},
		},
	});
	ids.student = student.id;
	const activity = await db.activity.create({
		data: {
			termId: term.id,
			ownerId: collegeUser.id,
			collegeId: college.id,
			name: activityName,
			organizer: college.name,
			content: "用于验证学院手动结束与重新开放活动。",
			startsAt: new Date(Date.now() - 172_800_000),
			endsAt: new Date(Date.now() + 172_800_000),
			nodeId: node.id,
			points: "4",
			confirmed: true,
			publishedAt: new Date(Date.now() - 172_800_000),
			publishRevision: 1,
			audienceScope: "CLASS",
			audienceColleges: [],
			audienceClasses: [
				JSON.stringify([college.name, major.name, schoolClass.name]),
			],
		},
	});
	ids.activity = activity.id;
	const participation = await db.participation.create({
		data: {
			activityId: activity.id,
			studentId: student.id,
			registeredAt: new Date(),
			registeredBy: collegeUser.id,
		},
	});
	await db.recognitionSource.create({
		data: {
			participationId: participation.id,
			submitterId: collegeUser.id,
			status: "APPROVED",
			note: "学院统一登记",
		},
	});
});

test.afterAll(async () => {
	if (ids.activity) {
		await db.recognitionSource.deleteMany({
			where: { participation: { activityId: ids.activity } },
		});
		await db.participation.deleteMany({ where: { activityId: ids.activity } });
		await db.auditEvent.deleteMany({ where: { targetId: ids.activity } });
		await db.activity.deleteMany({ where: { id: ids.activity } });
	}
	const userIds = [ids.collegeUser, ids.student].filter(Boolean);
	if (userIds.length) {
		await db.authSession.deleteMany({ where: { userId: { in: userIds } } });
		await db.auditEvent.deleteMany({ where: { actorId: { in: userIds } } });
		await db.user.deleteMany({ where: { id: { in: userIds } } });
	}
	if (ids.schoolClass)
		await db.schoolClass.deleteMany({ where: { id: ids.schoolClass } });
	if (ids.major) await db.major.deleteMany({ where: { id: ids.major } });
	if (ids.college) await db.college.deleteMany({ where: { id: ids.college } });
	await db.$disconnect();
});

test("学院结束活动后学生最新活动隐藏，参与记录保留，重新开放后恢复", async ({
	browser,
}) => {
	test.skip(!ids.activity, "当前没有可用的进行中测评周期");
	test.setTimeout(180_000);
	const studentContext = await browser.newContext();
	const collegeContext = await browser.newContext();
	const studentPage = await studentContext.newPage();
	const collegePage = await collegeContext.newPage();
	await studentPage.setViewportSize({ width: 1440, height: 900 });
	await collegePage.setViewportSize({ width: 1440, height: 900 });
	await login(studentPage, `${prefix}-student`, password);
	await login(
		collegePage,
		`${prefix}-college`,
		password,
	);

	await studentPage.goto("/my-activities", { waitUntil: "networkidle" });
	await expect(
		studentPage.getByRole("link", { name: activityName }),
	).toBeVisible();

	await collegePage.goto(
		`/activities/${ids.activity}?termId=${ids.term}`,
		{ waitUntil: "networkidle" },
	);
	await collegePage
		.getByRole("button", { name: "结束活动", exact: true })
		.click();
	await expect(
		collegePage.getByRole("heading", { name: "结束活动" }),
	).toBeVisible();
	await collegePage
		.getByRole("button", { name: "确认结束活动", exact: true })
		.click();
	await expect(
		collegePage.getByRole("button", { name: "重新开放活动", exact: true }),
	).toBeVisible();
	await expect(collegePage.getByText("实际结束")).toBeVisible();
	await collegePage.screenshot({
		path: "test-results/activity-ended-1440.png",
		fullPage: true,
	});

	await studentPage.reload({ waitUntil: "networkidle" });
	await expect(
		studentPage.getByRole("link", { name: activityName }),
	).toHaveCount(0);
	await studentPage.goto("/my-activities?view=joined", {
		waitUntil: "networkidle",
	});
	await expect(
		studentPage.getByRole("link", { name: activityName }),
	).toBeVisible();
	await studentPage.getByRole("link", { name: "查看活动" }).click();
	await expect(
		studentPage.getByRole("heading", { name: activityName }),
	).toBeVisible();
	await expect(studentPage.getByText("已结束").first()).toBeVisible();

	await collegePage.reload({ waitUntil: "networkidle" });
	await collegePage
		.getByRole("button", { name: "重新开放活动", exact: true })
		.click();
	await expect(
		collegePage.getByRole("heading", { name: "重新开放活动" }),
	).toBeVisible();
	await collegePage
		.getByRole("button", { name: "确认重新开放", exact: true })
		.click();
	await expect(
		collegePage.getByRole("button", { name: "结束活动", exact: true }),
	).toBeVisible();

	await studentPage.goto("/my-activities", { waitUntil: "networkidle" });
	await expect(
		studentPage.getByRole("link", { name: activityName }),
	).toBeVisible();
	await studentPage.setViewportSize({ width: 390, height: 844 });
	await studentPage.reload({ waitUntil: "networkidle" });
	const overflow = await studentPage.evaluate(
		() => document.documentElement.scrollWidth - window.innerWidth,
	);
	expect(overflow).toBeLessThanOrEqual(1);
	await studentPage.screenshot({
		path: "test-results/activity-reopened-390.png",
		fullPage: true,
	});
	await studentContext.close();
	await collegeContext.close();
});
