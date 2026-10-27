import { afterAll, beforeAll, expect, test } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { db } from "@/server/db";
import { organizationFixture } from "./organization-fixture";
import { createTerm, saveScheme, activateTerm } from "@/server/terms";
import {
	saveActivity,
	publishActivity,
	endActivity,
	reassignActivity,
	pageActivities,
	pageActivityFeed,
	getActivity,
} from "@/server/activities";
import { audienceAction } from "@/server/activity-policy";
import { saveActivityEvidence } from "@/server/activity-evidence";
import { uploadEvidence, downloadEvidence } from "@/server/evidence";
import {
	previewParticipationImport,
	commitParticipationImport,
} from "@/server/participation-import";
import { pageActivityParticipants } from "@/server/activity-participants";
import {
	reviewParticipation,
	changeParticipation,
	pageRecognitions,
} from "@/server/recognitions";
import { getStudentResult } from "@/server/results";
import {
	attachmentDownloadHeaders,
	attachmentEtagMatches,
	describeActivityAttachment,
	downloadActivityAttachment,
	uploadActivityAttachment,
} from "@/server/activity-attachments";
import { nodeSchema } from "@/lib/scoring/types";

const address = new URL(process.env.DATABASE_URL!);
if (
	address.hostname !== "127.0.0.1" ||
	!/^\/campus_test_[a-f0-9]+$/.test(address.pathname)
)
	throw new Error("必须由隔离运行器执行");
const marker = `activity-${randomUUID().slice(0, 8)}`;
const png = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=",
	"base64",
);
type Identity = {
	id: string;
	session: string;
	login: string;
	name: string;
	profile: { college: string; major: string; className: string };
};
const users: Record<string, Identity> = {};
const collegeIds: string[] = [];
const classIds: string[] = [];
let termId = "";
let activityId = "";
let activityEvidenceId = "";
let directory = "";
let orgA: Awaited<ReturnType<typeof organizationFixture>>;
let orgB: Awaited<ReturnType<typeof organizationFixture>>;

async function identity(
	label: string,
	role: "ADMIN" | "PUBLISHER" | "COLLEGE" | "COUNSELOR" | "STUDENT",
	options: {
		collegeId?: string;
		organization?: Awaited<ReturnType<typeof organizationFixture>>;
		classId?: string | null;
	} = {},
) {
	const login = `${marker}-${label}`;
	const profile = options.organization
		? {
				college: options.organization.college.name,
				major: options.organization.major.name,
				className: options.organization.schoolClass.name,
			}
		: { college: "未归属学院", major: "未归属专业", className: "未归属班级" };
	const user = await db.user.create({
		data: {
			login,
			name: label,
			role,
			collegeId: options.collegeId,
			passwordHash: "fixture-only",
			mustChangePassword: false,
			...(role === "STUDENT" && options.organization
				? {
						studentProfile: {
							create: {
								studentNumber: login,
								...profile,
								classId: options.classId ?? null,
							},
						},
					}
				: {}),
		},
	});
	users[label] = {
		id: user.id,
		session: (
			await db.authSession.create({
				data: {
					userId: user.id,
					version: 0,
					expiresAt: new Date(Date.now() + 600_000),
				},
			})
		).id,
		login,
		name: label,
		profile,
	};
	return users[label];
}

const rowFor = (user: Identity) => ({
	login: user.login,
	name: user.name,
	college: user.profile.college,
	major: user.profile.major,
	className: user.profile.className,
});

const audience = () => ({
	scope: "CLASS",
	colleges: [],
	classes: [
		{
			college: orgA.college.name,
			major: orgA.major.name,
			className: orgA.schoolClass.name,
		},
		{
			college: orgB.college.name,
			major: orgB.major.name,
			className: orgB.schoolClass.name,
		},
	],
});

const activityInput = () => ({
	name: `${marker}-联合活动`,
	organizer: "经济学院团委",
	content: "跨学院联合实践活动",
	startsAt: new Date(Date.now() - 3_600_000).toISOString(),
	endsAt: new Date(Date.now() + 86_400_000).toISOString(),
	nodeId: "activity",
	points: "10",
	audience: audience(),
});

async function currentRevision() {
	return (await db.activity.findUniqueOrThrow({ where: { id: activityId } }))
		.revision;
}

beforeAll(async () => {
	directory = await mkdtemp(join(tmpdir(), "campus-activity-"));
	process.env.EVIDENCE_DIR = directory;
	process.env.ACTIVITY_ATTACHMENT_DIR = join(directory, "attachments");
	orgA = await organizationFixture(`${marker}-a`, {
		college: "经济学院",
		major: "经济学",
		className: "经济一班",
	});
	orgB = await organizationFixture(`${marker}-b`, {
		college: "法学院",
		major: "法学",
		className: "法学一班",
	});
	collegeIds.push(orgA.college.id, orgB.college.id);
	classIds.push(orgA.schoolClass.id, orgB.schoolClass.id);
	for (const [label, organization] of [
		["counselor-a", orgA],
		["counselor-b", orgB],
	] as const) {
		users[label] = {
			id: organization.counselor.id,
			session: (
				await db.authSession.create({
					data: {
						userId: organization.counselor.id,
						version: 0,
						expiresAt: new Date(Date.now() + 600_000),
					},
				})
			).id,
			login: organization.counselor.login,
			name: organization.counselor.name,
			profile: {
				college: organization.college.name,
				major: organization.major.name,
				className: organization.schoolClass.name,
			},
		};
	}
	await identity("admin", "ADMIN");
	await identity("publisher", "PUBLISHER");
	await identity("college-a", "COLLEGE", { collegeId: orgA.college.id });
	await identity("college-b", "COLLEGE", { collegeId: orgB.college.id });
	await identity("student-a", "STUDENT", {
		organization: orgA,
		classId: orgA.schoolClass.id,
	});
	await identity("student-b", "STUDENT", {
		organization: orgB,
		classId: orgB.schoolClass.id,
	});
	await identity("student-c", "STUDENT", {
		organization: orgA,
		classId: orgA.schoolClass.id,
	});
	await identity("student-d", "STUDENT", {
		organization: orgA,
		classId: orgA.schoolClass.id,
	});
	await identity("unbound", "STUDENT", { organization: orgA });
	await identity("outsider", "STUDENT", {
		organization: orgA,
		classId: orgA.schoolClass.id,
	});
	await db.studentProfile.update({
		where: { userId: users.outsider.id },
		data: { className: "范围外班级", classId: null },
	});
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
});

afterAll(async () => {
	if (termId) {
		await db.participationImport.deleteMany({ where: { termId } });
		await db.recognitionSource.deleteMany({
			where: { participation: { activity: { termId } } },
		});
		await db.participation.deleteMany({
			where: { activity: { termId } },
		});
		await db.activityEvidence.deleteMany({
			where: { activity: { termId } },
		});
		await db.activityAttachment.deleteMany({
			where: { uploaderId: { in: Object.values(users).map((user) => user.id) } },
		});
		await db.activity.deleteMany({ where: { termId } });
		await db.term.deleteMany({ where: { id: termId } });
	}
	const ids = Object.values(users).map((user) => user.id);
	await db.evidence.deleteMany({ where: { ownerId: { in: ids } } });
	await db.auditEvent.deleteMany({ where: { actorId: { in: ids } } });
	await db.schoolClass.updateMany({
		where: { id: { in: classIds } },
		data: { counselorId: null },
	});
	await db.user.deleteMany({ where: { id: { in: ids } } });
	await db.schoolClass.deleteMany({ where: { id: { in: classIds } } });
	await db.major.deleteMany({ where: { collegeId: { in: collegeIds } } });
	await db.college.deleteMany({ where: { id: { in: collegeIds } } });
	if (directory && directory.startsWith(join(tmpdir(), "campus-activity-")))
		await rm(directory, { recursive: true, force: true });
	delete process.env.EVIDENCE_DIR;
	delete process.env.ACTIVITY_ATTACHMENT_DIR;
	await db.$disconnect();
});

test("主办学院维护活动与共享证明，发布即确认分值，班级范围按并集匹配", async () => {
	await expect(
		saveActivity(users["counselor-a"].session, termId, {
			activity: activityInput(),
		}),
	).rejects.toThrow("权限");
	const saved = await saveActivity(users["college-a"].session, termId, {
		activity: activityInput(),
	});
	activityId = saved.id;
	expect(saved.college?.id).toBe(orgA.college.id);
	expect(saved.canManage).toBe(true);
	await expect(
		saveActivity(users["college-b"].session, termId, {
			id: activityId,
			revision: saved.revision,
			activity: activityInput(),
		}),
	).rejects.toThrow("主办学院");
	const initialEvidence = await uploadEvidence(
		users["college-a"].session,
		"活动签到与合影.png",
		png,
	);
	await expect(
		saveActivityEvidence(users["college-b"].session, termId, {
			activityId,
			revision: 1,
			evidenceId: initialEvidence.id,
			note: "越权上传活动证明",
		}),
	).rejects.toThrow("主办学院");
	const evidence = await saveActivityEvidence(
		users["college-a"].session,
		termId,
		{
			activityId,
			revision: saved.revision,
			evidenceId: initialEvidence.id,
			note: "活动签到表和现场合影",
		},
	);
	activityEvidenceId = evidence.id;
	expect(evidence.version).toBe(1);
	expect(evidence.active).toBe(true);

	const preview = (await audienceAction(users["college-a"].session, {
		action: "preview",
		termId,
		audience: audience(),
	})) as {
		count: number;
		collegeCount: number;
		majorCount: number;
		classCount: number;
		errors: string[];
		token?: string;
	};
	expect(preview.count).toBe(5);
	expect(preview.collegeCount).toBe(2);
	expect(preview.majorCount).toBe(2);
	expect(preview.classCount).toBe(2);
	expect(preview.errors).toEqual([]);
	expect(preview).not.toHaveProperty("students");
	expect(preview).not.toHaveProperty("token");
	const published = await publishActivity(users["college-a"].session, termId, {
		id: activityId,
		revision: await currentRevision(),
		action: "publish",
	});
	expect(published.publishedAt).not.toBeNull();
	expect(published.confirmed).toBe(true);
	expect(published.publishRevision).toBe(1);
	expect(published.contentText).toBe("跨学院联合实践活动");
	for (const label of [
		"student-a",
		"student-b",
		"student-c",
		"student-d",
		"unbound",
	]) {
		expect(
			(await pageActivityFeed(users[label].session, termId)).total,
		).toBe(1);
	}
	expect(
		(await pageActivityFeed(users.outsider.session, termId)).total,
	).toBe(0);
	expect(
		(await pageActivities(users["student-a"].session, termId)).total,
	).toBe(0);
	const renamed = await saveActivity(users["college-a"].session, termId, {
		id: activityId,
		revision: published.revision,
		activity: { ...activityInput(), name: `${marker}-联合活动（改）` },
	});
	expect(renamed.publishedAt).not.toBeNull();
	expect(renamed.publishRevision).toBe(1);

	const scoring = await saveActivity(users["college-a"].session, termId, {
		activity: {
			...activityInput(),
			name: `${marker}-分值变更活动`,
			points: "8",
		},
	});
	await publishActivity(users["college-a"].session, termId, {
		id: scoring.id,
		revision: scoring.revision,
		action: "publish",
	});
	const withdrawn = await saveActivity(users["college-a"].session, termId, {
		id: scoring.id,
		revision: scoring.revision + 1,
		activity: {
			...activityInput(),
			name: `${marker}-分值变更活动`,
			points: "9",
		},
	});
	expect(withdrawn.publishedAt).toBeNull();
	expect(withdrawn.confirmed).toBe(true);
	expect(withdrawn.publishRevision).toBe(2);
	const audit = await db.auditEvent.findFirstOrThrow({
		where: { targetId: scoring.id, action: "ACTIVITY_UPDATED" },
		orderBy: { createdAt: "desc" },
	});
	expect(audit.details).toMatchObject({
		scoringChanged: true,
		publicationWithdrawn: true,
		beforePoints: "8",
		afterPoints: "9",
	});
	expect(
		(await pageActivityFeed(users["student-a"].session, termId)).total,
	).toBe(1);
	await publishActivity(users["college-a"].session, termId, {
		id: scoring.id,
		revision: withdrawn.revision,
		action: "publish",
	});

	const future = await saveActivity(users["college-a"].session, termId, {
		activity: {
			...activityInput(),
			name: `${marker}-未开始活动`,
			startsAt: new Date(Date.now() + 3_600_000).toISOString(),
			endsAt: new Date(Date.now() + 7_200_000).toISOString(),
		},
	});
	await publishActivity(users["college-a"].session, termId, {
		id: future.id,
		revision: future.revision,
		action: "publish",
	});
	const ended = await saveActivity(users["college-a"].session, termId, {
		activity: {
			...activityInput(),
			name: `${marker}-已结束活动`,
			startsAt: new Date(Date.now() - 7_200_000).toISOString(),
			endsAt: new Date(Date.now() - 3_600_000).toISOString(),
		},
	});
	await publishActivity(users["college-a"].session, termId, {
		id: ended.id,
		revision: ended.revision,
		action: "publish",
	});
	expect(
		(await pageActivityFeed(users["student-a"].session, termId)).total,
	).toBe(2);
	await expect(
		getActivity(users["student-a"].session, future.id),
	).resolves.toMatchObject({ id: future.id });

	const hostView = await getActivity(users["college-a"].session, activityId);
	expect(hostView.canManage).toBe(true);
	expect(hostView.evidence).toHaveLength(1);
	const otherView = await getActivity(users["college-b"].session, activityId);
	expect(otherView.canManage).toBe(false);
	expect(otherView.canReview).toBe(true);
});

test("范围方式三选一并集匹配，切换方式清理未使用名单，空范围不可发布", async () => {
	const preview = (input: unknown) =>
		audienceAction(users["college-a"].session, {
			action: "preview" as const,
			termId,
			audience: input,
		}) as Promise<{
			count: number;
			collegeCount: number;
			majorCount: number;
			classCount: number;
			errors: string[];
		}>;
	const allScope = { scope: "ALL", colleges: [], classes: [] };
	const collegeScope = {
		scope: "COLLEGE",
		colleges: [orgA.college.name],
		classes: [],
	};
	const classScope = {
		scope: "CLASS",
		colleges: [],
		classes: [
			{
				college: orgA.college.name,
				major: orgA.major.name,
				className: orgA.schoolClass.name,
			},
		],
	};
	const allPreview = await preview(allScope);
	expect(allPreview).toMatchObject({ errors: [] });
	const eligibleStudents = await db.user.count({
		where: {
			role: "STUDENT",
			disabled: false,
			studentProfile: { isNot: null },
		},
	});
	expect(allPreview.count).toBe(eligibleStudents);
	// 全校聚合覆盖整库，其他用例会留下学生，只校验至少覆盖本夹具的学院/专业/班级。
	expect(allPreview.collegeCount).toBeGreaterThanOrEqual(2);
	expect(allPreview.majorCount).toBeGreaterThanOrEqual(2);
	expect(allPreview.classCount).toBeGreaterThanOrEqual(3);
	expect(await preview(collegeScope)).toMatchObject({
		count: 5,
		collegeCount: 1,
		majorCount: 1,
		classCount: 2,
		errors: [],
	});
	expect(await preview(classScope)).toMatchObject({
		count: 4,
		collegeCount: 1,
		majorCount: 1,
		classCount: 1,
		errors: [],
	});

	const allActivity = await saveActivity(users["college-a"].session, termId, {
		activity: {
			...activityInput(),
			name: `${marker}-全校范围活动`,
			audience: allScope,
		},
	});
	await publishActivity(users["college-a"].session, termId, {
		id: allActivity.id,
		revision: allActivity.revision,
		action: "publish",
	});
	for (const label of [
		"student-a",
		"student-b",
		"student-c",
		"unbound",
		"outsider",
	]) {
		expect(
			(
				await pageActivityFeed(
					users[label].session,
					termId,
					"全校范围活动",
				)
			).total,
		).toBe(1);
	}
	expect(
		(
			await pageActivities(
				users["college-b"].session,
				termId,
				"全校范围活动",
			)
		).total,
	).toBe(1);
	await expect(
		getActivity(users["counselor-b"].session, allActivity.id),
	).resolves.toMatchObject({ id: allActivity.id });

	const collegeActivity = await saveActivity(
		users["college-a"].session,
		termId,
		{
			activity: {
				...activityInput(),
				name: `${marker}-学院范围活动`,
				audience: collegeScope,
			},
		},
	);
	expect(collegeActivity.audience).toEqual(collegeScope);
	await publishActivity(users["college-a"].session, termId, {
		id: collegeActivity.id,
		revision: collegeActivity.revision,
		action: "publish",
	});
	for (const label of ["student-a", "student-c", "unbound", "outsider"]) {
		expect(
			(
				await pageActivityFeed(
					users[label].session,
					termId,
					"学院范围活动",
				)
			).total,
		).toBe(1);
	}
	expect(
		(
			await pageActivityFeed(
				users["student-b"].session,
				termId,
				"学院范围活动",
			)
		).total,
	).toBe(0);
	expect(
		(
			await pageActivities(
				users["college-a"].session,
				termId,
				"学院范围活动",
			)
		).total,
	).toBe(1);
	expect(
		(
			await pageActivities(
				users["college-b"].session,
				termId,
				"学院范围活动",
			)
		).total,
	).toBe(0);
	expect(
		(
			await pageActivities(
				users["counselor-a"].session,
				termId,
				"学院范围活动",
			)
		).total,
	).toBe(1);
	expect(
		(
			await pageActivities(
				users["counselor-b"].session,
				termId,
				"学院范围活动",
			)
		).total,
	).toBe(0);
	await expect(
		getActivity(users["college-b"].session, collegeActivity.id),
	).rejects.toThrow("无权");

	const classActivity = await saveActivity(
		users["college-a"].session,
		termId,
		{
			activity: {
				...activityInput(),
				name: `${marker}-班级范围活动`,
				audience: {
					...classScope,
					colleges: [orgA.college.name],
				},
			},
		},
	);
	expect(classActivity.audience).toEqual(classScope);
	const publishedClass = await publishActivity(
		users["college-a"].session,
		termId,
		{
			id: classActivity.id,
			revision: classActivity.revision,
			action: "publish",
		},
	);
	for (const label of ["student-a", "student-c", "unbound"]) {
		expect(
			(
				await pageActivityFeed(
					users[label].session,
					termId,
					"班级范围活动",
				)
			).total,
		).toBe(1);
	}
	for (const label of ["student-b", "outsider"]) {
		expect(
			(
				await pageActivityFeed(
					users[label].session,
					termId,
					"班级范围活动",
				)
			).total,
		).toBe(0);
	}
	expect(
		(
			await pageActivities(
				users["college-b"].session,
				termId,
				"班级范围活动",
			)
		).total,
	).toBe(0);
	expect(
		(
			await pageActivities(
				users["college-a"].session,
				termId,
				"班级范围活动",
			)
		).total,
	).toBe(1);
	expect(
		(
			await pageActivities(
				users["counselor-b"].session,
				termId,
				"班级范围活动",
			)
		).total,
	).toBe(0);
	expect(
		(
			await pageActivities(
				users["counselor-a"].session,
				termId,
				"班级范围活动",
			)
		).total,
	).toBe(1);
	await expect(
		getActivity(users["college-b"].session, classActivity.id),
	).rejects.toThrow("无权");
	await expect(
		getActivity(users["counselor-a"].session, classActivity.id),
	).resolves.toMatchObject({ id: classActivity.id });

	const draft = await saveActivity(users["college-a"].session, termId, {
		activity: {
			...activityInput(),
			name: `${marker}-范围切换草稿`,
			audience: collegeScope,
		},
	});
	const switchedClass = await saveActivity(
		users["college-a"].session,
		termId,
		{
			id: draft.id,
			revision: draft.revision,
			activity: {
				...activityInput(),
				name: `${marker}-范围切换草稿`,
				audience: {
					scope: "CLASS",
					colleges: [],
					classes: [
						{
							college: orgA.college.name,
							major: orgA.major.name,
							className: orgA.schoolClass.name,
						},
					],
				},
			},
		},
	);
	expect(switchedClass.audience).toMatchObject({
		scope: "CLASS",
		colleges: [],
	});
	expect(switchedClass.audience?.classes).toHaveLength(1);
	const switchedAll = await saveActivity(
		users["college-a"].session,
		termId,
		{
			id: draft.id,
			revision: switchedClass.revision,
			activity: {
				...activityInput(),
				name: `${marker}-范围切换草稿`,
				audience: allScope,
			},
		},
	);
	expect(switchedAll.audience).toEqual(allScope);

	const emptyCollege = await saveActivity(
		users["college-a"].session,
		termId,
		{
			activity: {
				...activityInput(),
				name: `${marker}-空学院范围`,
				audience: { scope: "COLLEGE", colleges: [], classes: [] },
			},
		},
	);
	await expect(
		publishActivity(users["college-a"].session, termId, {
			id: emptyCollege.id,
			revision: emptyCollege.revision,
			action: "publish",
		}),
	).rejects.toThrow("请至少选择一个学院");
	const emptyClass = await saveActivity(
		users["college-a"].session,
		termId,
		{
			activity: {
				...activityInput(),
				name: `${marker}-空班级范围`,
				audience: { scope: "CLASS", colleges: [], classes: [] },
			},
		},
	);
	await expect(
		publishActivity(users["college-a"].session, termId, {
			id: emptyClass.id,
			revision: emptyClass.revision,
			action: "publish",
		}),
	).rejects.toThrow("请至少选择一个班级");
	expect(
		(
			await preview({
				scope: "CLASS",
				colleges: [],
				classes: [],
			})
		).errors,
	).toContain("请至少选择一个班级");

	const withdrawn = await saveActivity(users["college-a"].session, termId, {
		id: classActivity.id,
		revision: publishedClass.revision,
		activity: {
			...activityInput(),
			name: `${marker}-班级范围活动`,
			audience: allScope,
		},
	});
	expect(withdrawn.publishedAt).toBeNull();
	expect(withdrawn.audience).toEqual(allScope);
	expect(
		(
			await pageActivityFeed(
				users["student-a"].session,
				termId,
				"班级范围活动",
			)
		).total,
	).toBe(0);
});

test("发布者可提前结束并重新开放活动，结束只影响学生最新活动", async () => {
	const name = `${marker}-提前结束活动`;
	const created = await saveActivity(users["college-a"].session, termId, {
		activity: { ...activityInput(), name },
	});
	const published = await publishActivity(users["college-a"].session, termId, {
		id: created.id,
		revision: created.revision,
		action: "publish",
	});
	const feed = async () =>
		pageActivityFeed(users["student-a"].session, termId, "提前结束");
	expect((await feed()).total).toBe(1);
	await expect(
		endActivity(users["student-a"].session, termId, {
			id: created.id,
			revision: published.revision,
			action: "end",
		}),
	).rejects.toThrow("权限");
	await expect(
		endActivity(users["college-b"].session, termId, {
			id: created.id,
			revision: published.revision,
			action: "end",
		}),
	).rejects.toThrow("主办学院");
	const ended = await endActivity(users["college-a"].session, termId, {
		id: created.id,
		revision: published.revision,
		action: "end",
	});
	expect(ended.endedAt).not.toBeNull();
	expect((await feed()).total).toBe(0);
	await expect(
		getActivity(users["student-a"].session, created.id),
	).resolves.toMatchObject({ id: created.id });
	await expect(
		publishActivity(users["college-a"].session, termId, {
			id: created.id,
			revision: ended.revision,
			action: "publish",
		}),
	).rejects.toThrow("重新开放");
	await expect(
		endActivity(users["college-a"].session, termId, {
			id: created.id,
			revision: ended.revision,
			action: "end",
		}),
	).rejects.toThrow("已结束");
	const audit = await db.auditEvent.findFirstOrThrow({
		where: { targetId: created.id, action: "ACTIVITY_ENDED" },
	});
	expect(audit.details).toMatchObject({ termId });
	const reopened = await endActivity(users["college-a"].session, termId, {
		id: created.id,
		revision: ended.revision,
		action: "reopen",
	});
	expect(reopened.endedAt).toBeNull();
	expect((await feed()).total).toBe(1);
});

test("活动附件按发布范围鉴权下载，重复绑定同一活动不重复计数", async () => {
	const pdf = Buffer.from("%PDF-1.4\n活动日程\n");
	const attachment = await uploadActivityAttachment(
		users["college-a"].session,
		"活动日程.pdf",
		pdf,
	);
	const saved = await saveActivity(users["college-a"].session, termId, {
		activity: { ...activityInput(), name: `${marker}-附件活动` },
		attachmentIds: [attachment.id],
	});
	expect(saved.attachments).toHaveLength(1);
	await publishActivity(users["college-a"].session, termId, {
		id: saved.id,
		revision: saved.revision,
		action: "publish",
	});
	const detail = await getActivity(users["college-a"].session, saved.id);
	expect(detail.attachments.map((row) => row.name)).toEqual(["活动日程.pdf"]);
	const downloaded = await downloadActivityAttachment(
		users["student-a"].session,
		attachment.id,
	);
	expect(downloaded.bytes.equals(pdf)).toBe(true);
	const described = await describeActivityAttachment(
		users["student-a"].session,
		attachment.id,
	);
	const headers = attachmentDownloadHeaders(described.file);
	expect(headers.ETag).toBe(`"${downloaded.file.sha256}"`);
	expect(headers["Cache-Control"]).toBe("private, max-age=300");
	expect(headers.Vary).toBe("Cookie");
	expect(headers["Content-Length"]).toBe(String(pdf.length));
	expect(attachmentEtagMatches(headers.ETag, headers.ETag)).toBe(true);
	expect(attachmentEtagMatches(`W/${headers.ETag}`, headers.ETag)).toBe(true);
	expect(attachmentEtagMatches(`"stale", ${headers.ETag}`, headers.ETag)).toBe(true);
	expect(attachmentEtagMatches('"stale"', headers.ETag)).toBe(false);
	expect(attachmentEtagMatches(null, headers.ETag)).toBe(false);
	await expect(
		describeActivityAttachment(users.outsider.session, attachment.id),
	).rejects.toThrow("无权");
	await expect(
		downloadActivityAttachment(users.outsider.session, attachment.id),
	).rejects.toThrow("无权");
	await expect(
		downloadActivityAttachment(users["student-a"].session, attachment.id),
	).resolves.toMatchObject({ file: { name: "活动日程.pdf" } });
	const rebound = await saveActivity(users["college-a"].session, termId, {
		id: saved.id,
		revision: detail.revision,
		activity: { ...activityInput(), name: `${marker}-附件活动` },
		attachmentIds: [attachment.id],
	});
	expect(rebound.attachments).toHaveLength(1);
});

test("大图上传自动重编码为 WebP 并保留原始文件名", async () => {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="1400"><rect width="2400" height="1400" fill="#f5f6f8"/><rect x="0" y="0" width="2400" height="88" fill="#1f2b3d"/><rect x="48" y="140" width="560" height="360" rx="16" fill="#ffffff" stroke="#d8dee6"/><rect x="648" y="140" width="800" height="360" rx="16" fill="#ffffff" stroke="#d8dee6"/><rect x="48" y="540" width="1400" height="280" rx="16" fill="#ffffff" stroke="#d8dee6"/><circle cx="2100" cy="400" r="180" fill="#3b82f6" opacity="0.85"/></svg>`;
	const base = await sharp(Buffer.from(svg)).png().toBuffer();
	let seed = 20261027;
	const noise = Buffer.alloc(720 * 460 * 3);
	for (let i = 0; i < noise.length; i += 1) {
		seed = (seed * 1103515245 + 12345) % 2147483648;
		noise[i] = (seed >> 16) & 0xff;
	}
	const bigPng = await sharp(base)
		.composite([{ input: noise, raw: { width: 720, height: 460, channels: 3 }, left: 1500, top: 860 }])
		.png()
		.toBuffer();
	expect(bigPng.length).toBeGreaterThan(300 * 1024);

	const uploaded = await uploadActivityAttachment(
		users["college-a"].session,
		"活动照片.png",
		bigPng,
	);
	expect(uploaded.mime).toBe("image/webp");
	expect(uploaded.name).toBe("活动照片.png");
	expect(uploaded.size).toBeLessThan(bigPng.length);
	expect(uploaded.size).toBeGreaterThan(0);

	const downloaded = await downloadActivityAttachment(
		users["college-a"].session,
		uploaded.id,
	);
	expect(downloaded.bytes.equals(bigPng)).toBe(false);
	const meta = await sharp(downloaded.bytes).metadata();
	expect(meta.format).toBe("webp");
	expect(meta.width).toBeLessThanOrEqual(1920);
	expect(meta.height).toBeLessThanOrEqual(1920);
	expect(createHash("sha256").update(downloaded.bytes).digest("hex")).toBe(
		downloaded.file.sha256,
	);
});

test("小图上传不做重编码保持原样", async () => {
	const uploaded = await uploadActivityAttachment(
		users["college-a"].session,
		"占位.png",
		png,
	);
	expect(uploaded.mime).toBe("image/png");
	expect(uploaded.size).toBe(png.length);
	const downloaded = await downloadActivityAttachment(
		users["college-a"].session,
		uploaded.id,
	);
	expect(downloaded.bytes.equals(png)).toBe(true);
});

test("无归属历史活动只能由管理员移交主办学院，发布者不能自行认领", async () => {
	const legacy = await db.activity.create({
		data: {
			termId,
			ownerId: users.publisher.id,
			name: `${marker}-无归属历史活动`,
			organizer: "历史主办方",
			content: "历史活动内容",
			startsAt: new Date(Date.now() - 3_600_000),
			endsAt: new Date(Date.now() + 86_400_000),
			nodeId: "activity",
			points: "2",
		},
	});
	expect(
		(await getActivity(users.publisher.session, legacy.id)).canManage,
	).toBe(false);
	await expect(
		saveActivity(users.publisher.session, termId, {
			id: legacy.id,
			revision: 0,
			activity: {
				...activityInput(),
				collegeId: orgA.college.id,
			},
		}),
	).rejects.toThrow("主办学院");
	expect(
		(
			await db.activity.findUniqueOrThrow({ where: { id: legacy.id } })
		).collegeId,
	).toBeNull();
	await expect(
		reassignActivity(users.publisher.session, termId, {
			id: legacy.id,
			revision: 0,
			collegeId: orgA.college.id,
			reason: "发布者自行认领主办学院",
		}),
	).rejects.toThrow("权限");
	const assigned = await reassignActivity(users.admin.session, termId, {
		id: legacy.id,
		revision: 0,
		collegeId: orgA.college.id,
		reason: "学校核验历史活动主办单位",
	});
	expect(assigned.college?.id).toBe(orgA.college.id);
	const saved = await saveActivity(users.publisher.session, termId, {
		id: legacy.id,
		revision: assigned.revision,
		activity: activityInput(),
	});
	expect(saved.college?.id).toBe(orgA.college.id);
});

test("全字段名单整批校验、失败零写入、首份封存、并发与重试不重复", async () => {
	const invalid = await previewParticipationImport(
		users["college-a"].session,
		termId,
		{
			activityId,
			kind: "INITIAL",
			note: "首次正式名单",
			rows: [
				rowFor(users["student-a"]),
				rowFor(users["student-a"]),
				{ ...rowFor(users["student-b"]), name: "姓名不符" },
				rowFor(users.unbound),
			],
		},
	);
	expect(invalid.errors).toBeGreaterThanOrEqual(3);
	expect(invalid.rows.map((row) => row.message).join(" ")).toContain("重复");
	expect(invalid.rows.map((row) => row.message).join(" ")).toContain("姓名");
	expect(invalid.rows.map((row) => row.message).join(" ")).toContain("班级");
	await expect(
		commitParticipationImport(
			users["college-a"].session,
			termId,
			invalid.id,
		),
	).rejects.toThrow("名单存在错误");
	expect(await db.participation.count({ where: { activityId } })).toBe(0);

	const valid = await previewParticipationImport(
		users["college-a"].session,
		termId,
		{
			activityId,
			kind: "INITIAL",
			note: "签到表与活动日程核对",
			rows: [
				rowFor(users["student-a"]),
				rowFor(users["student-b"]),
			],
		},
	);
	expect(valid.errors).toBe(0);
	expect(valid.rows.map((row) => row.state)).toEqual(["NEW", "NEW"]);
	await expect(
		previewParticipationImport(users["college-b"].session, termId, {
			activityId,
			kind: "INITIAL",
			note: "外院尝试导入",
			rows: [rowFor(users["student-b"])],
		}),
	).rejects.toThrow("主办学院");
	await expect(
		previewParticipationImport(users["student-a"].session, termId, {
			activityId,
			kind: "INITIAL",
			note: "学生尝试导入",
			rows: [rowFor(users["student-a"])],
		}),
	).rejects.toThrow("权限");
	await expect(
		commitParticipationImport(
			users["college-b"].session,
			termId,
			valid.id,
		),
	).rejects.toThrow("他人");
	const commits = await Promise.all([
		commitParticipationImport(users["college-a"].session, termId, valid.id),
		commitParticipationImport(users["college-a"].session, termId, valid.id),
	]);
	expect(commits.filter((result) => !result.replay)).toHaveLength(1);
	expect(commits[0].submitted).toBe(2);
	expect(commits[0].rosterRevision).toBe(1);
	const facts = await db.participation.findMany({
		where: { activityId },
		include: { sources: true },
	});
	expect(facts).toHaveLength(2);
	expect(facts.flatMap((fact) => fact.sources)).toHaveLength(2);
	expect(
		facts.every((fact) =>
			fact.sources.every(
				(source) =>
					source.status === "PENDING_COUNSELOR" &&
					source.activityEvidenceId === activityEvidenceId,
			),
		),
	).toBe(true);
	expect(
		(await db.activity.findUniqueOrThrow({ where: { id: activityId } }))
			.rosterCommittedAt,
	).not.toBeNull();
	await expect(
		previewParticipationImport(users["college-a"].session, termId, {
			activityId,
			kind: "INITIAL",
			note: "第二份普通名单",
			rows: [rowFor(users["student-a"])],
		}),
	).rejects.toThrow("已封存");
});

test("辅导员按班级初核、归属学院终审；主办学院可看必要参与信息但不能终审外院", async () => {
	const sourceA = await db.recognitionSource.findFirstOrThrow({
		where: {
			participation: { activityId, studentId: users["student-a"].id },
		},
	});
	const sourceB = await db.recognitionSource.findFirstOrThrow({
		where: {
			participation: { activityId, studentId: users["student-b"].id },
		},
	});
	await expect(
		reviewParticipation(users["counselor-b"].session, termId, {
			id: sourceA.id,
			revision: sourceA.revision,
			action: "counselorApprove",
		}),
	).rejects.toThrow("无权");
	await expect(
		reviewParticipation(users["college-a"].session, termId, {
			id: sourceB.id,
			revision: sourceB.revision,
			action: "collegeApprove",
		}),
	).rejects.toThrow("无权");
	const counselorA = await reviewParticipation(
		users["counselor-a"].session,
		termId,
		{
			id: sourceA.id,
			revision: sourceA.revision,
			action: "counselorApprove",
		},
	);
	expect(counselorA.status).toBe("PENDING_COLLEGE");
	await expect(
		reviewParticipation(users["college-a"].session, termId, {
			id: sourceB.id,
			revision: sourceA.revision,
			action: "collegeApprove",
		}),
	).rejects.toThrow();
	const approvedA = await reviewParticipation(
		users["college-a"].session,
		termId,
		{
			id: sourceA.id,
			revision: counselorA.revision,
			action: "collegeApprove",
		},
	);
	expect(approvedA.status).toBe("APPROVED");
	const counselorB = await reviewParticipation(
		users["counselor-b"].session,
		termId,
		{
			id: sourceB.id,
			revision: sourceB.revision,
			action: "counselorApprove",
		},
	);
	const approvedB = await reviewParticipation(
		users["college-b"].session,
		termId,
		{
			id: sourceB.id,
			revision: counselorB.revision,
			action: "collegeApprove",
		},
	);
	expect(approvedB.status).toBe("APPROVED");
	expect(
		(await getStudentResult(users["student-a"].session, termId))
			.participations,
	).toHaveLength(1);
	expect(
		(await getStudentResult(users["student-a"].session, termId)).result.total,
	).toBe("10.00");

	const hostRoster = await pageActivityParticipants(
		users["college-a"].session,
		termId,
		activityId,
	);
	expect(hostRoster.total).toBe(2);
	expect(hostRoster.canManage).toBe(true);
	const otherRoster = await pageActivityParticipants(
		users["college-b"].session,
		termId,
		activityId,
	);
	expect(otherRoster.total).toBe(1);
	expect(otherRoster.items[0].name).toBe(users["student-b"].name);
	const counselorRoster = await pageActivityParticipants(
		users["counselor-a"].session,
		termId,
		activityId,
		1,
		"",
		{ status: "APPROVED" },
	);
	expect(counselorRoster.total).toBe(1);
	expect(counselorRoster.items[0].name).toBe(users["student-a"].name);
	const counselorReviews = await pageRecognitions(
		users["counselor-a"].session,
		termId,
	);
	expect(counselorReviews.total).toBe(1);
	const collegeReviews = await pageRecognitions(
		users["college-a"].session,
		termId,
		1,
		undefined,
		users["student-b"].name,
	);
	expect(collegeReviews.items[0]?.canReview).toBe(false);
});

test("补录更正经理由预览、只新增不删除，预览后学生变化会拒绝写入", async () => {
	await expect(
		previewParticipationImport(users["college-a"].session, termId, {
			activityId,
			kind: "CORRECTION",
			note: "补录漏报学生",
			rows: [rowFor(users["student-c"])],
		}),
	).rejects.toThrow("理由");
	const stale = await previewParticipationImport(
		users["college-a"].session,
		termId,
		{
			activityId,
			kind: "CORRECTION",
			note: "补录漏报学生",
			reason: "签到表复核发现漏报学生",
			rows: [
				rowFor(users["student-a"]),
				rowFor(users["student-b"]),
				rowFor(users["student-c"]),
			],
		},
	);
	expect(stale.rows.map((row) => row.state)).toEqual([
		"UNCHANGED",
		"UNCHANGED",
		"NEW",
	]);
	await db.user.update({
		where: { id: users["student-b"].id },
		data: { revision: { increment: 1 } },
	});
	await expect(
		commitParticipationImport(
			users["college-a"].session,
			termId,
			stale.id,
		),
	).rejects.toThrow("已变化");
	const corrected = await previewParticipationImport(
		users["college-a"].session,
		termId,
		{
			activityId,
			kind: "CORRECTION",
			note: "补录漏报学生",
			reason: "签到表复核发现漏报学生",
			rows: [
				rowFor(users["student-a"]),
				rowFor(users["student-b"]),
				rowFor(users["student-c"]),
			],
		},
	);
	expect(corrected.rows.map((row) => row.state)).toEqual([
		"UNCHANGED",
		"UNCHANGED",
		"NEW",
	]);
	const result = await commitParticipationImport(
		users["college-a"].session,
		termId,
		corrected.id,
	);
	expect(result.updated).toBe(0);
	expect(result.submitted).toBe(1);
	expect(await db.participation.count({ where: { activityId } })).toBe(3);
	const sourceB = await db.recognitionSource.findFirstOrThrow({
		where: {
			participation: { activityId, studentId: users["student-b"].id },
		},
	});
	expect(sourceB.status).toBe("APPROVED");
	expect(sourceB.origin).not.toBe("CORRECTION");
	expect(
		(await getStudentResult(users["student-b"].session, termId)).result.total,
	).toBe("10.00");

	const sourceC = await db.recognitionSource.findFirstOrThrow({
		where: {
			participation: { activityId, studentId: users["student-c"].id },
		},
	});
	expect(sourceC.status).toBe("PENDING_COUNSELOR");
	expect(sourceC.origin).toBe("CORRECTION");
	expect(
		(await getStudentResult(users["student-c"].session, termId))
			.participations,
	).toHaveLength(0);
	const first = await reviewParticipation(
		users["counselor-a"].session,
		termId,
		{
			id: sourceC.id,
			revision: sourceC.revision,
			action: "counselorApprove",
		},
	);
	await reviewParticipation(users["college-a"].session, termId, {
		id: sourceC.id,
		revision: first.revision,
		action: "collegeApprove",
	});
	expect(
		(await getStudentResult(users["student-c"].session, termId)).result.total,
	).toBe("10.00");
});

test("共享证明换版使已通过认定替代重审，管理员移交主办学院后才可移除参与", async () => {
	const replacementFile = await uploadEvidence(
		users["college-a"].session,
		"活动补充协议.png",
		png,
	);
	const replacement = await saveActivityEvidence(
		users["college-a"].session,
		termId,
		{
			activityId,
			revision: await currentRevision(),
			evidenceId: replacementFile.id,
			note: "补充活动主办方盖章名单",
			reason: "原证明缺少盖章页",
		},
	);
	expect(replacement.reopened).toBe(3);
	const versions = await db.activityEvidence.findMany({
		where: { activityId },
		orderBy: { version: "asc" },
	});
	expect(versions).toHaveLength(2);
	expect(versions.find((row) => row.active)?.id).toBe(replacement.id);
	expect(
		await db.recognitionSource.count({
			where: { participation: { activityId }, status: "PENDING_COUNSELOR" },
		}),
	).toBe(3);
	for (const label of ["student-a", "student-b", "student-c"]) {
		expect(
			(await getStudentResult(users[label].session, termId)).participations,
		).toHaveLength(0);
	}
	expect(
		(
			await downloadEvidence(
				users["student-a"].session,
				replacementFile.id,
			)
		).bytes.equals(png),
	).toBe(true);
	await expect(
		downloadEvidence(users.outsider.session, replacementFile.id),
	).rejects.toThrow("权限");

	const secondFile = await uploadEvidence(
		users["college-a"].session,
		"活动最终签到名单.png",
		png,
	);
	const secondReplacement = await saveActivityEvidence(
		users["college-a"].session,
		termId,
		{
			activityId,
			revision: await currentRevision(),
			evidenceId: secondFile.id,
			note: "补充最终签到名单",
			reason: "替换为最终版签到名单",
		},
	);
	expect(secondReplacement.reopened).toBe(0);
	const rebound = await db.recognitionSource.findMany({
		where: {
			participation: { activityId },
			status: "PENDING_COUNSELOR",
		},
	});
	expect(rebound).toHaveLength(3);
	expect(
		rebound.every(
			(source) => source.activityEvidenceId === secondReplacement.id,
		),
	).toBe(true);

	const beforeReassign = await db.activity.findUniqueOrThrow({
		where: { id: activityId },
	});
	await expect(
		reassignActivity(users["college-a"].session, termId, {
			id: activityId,
			revision: beforeReassign.revision,
			collegeId: orgB.college.id,
			reason: "学校调整活动主办单位",
		}),
	).rejects.toThrow("权限");
	await reassignActivity(users.admin.session, termId, {
		id: activityId,
		revision: beforeReassign.revision,
		collegeId: orgB.college.id,
		reason: "学校调整活动主办单位",
	});
	expect(
		(await getActivity(users["college-b"].session, activityId)).canManage,
	).toBe(true);
	expect(
		(await getActivity(users["college-a"].session, activityId)).canManage,
	).toBe(false);
	await expect(
		saveActivity(users["college-a"].session, termId, {
			id: activityId,
			revision: await currentRevision(),
			activity: activityInput(),
		}),
	).rejects.toThrow("主办学院");

	const pendingA = await db.recognitionSource.findFirstOrThrow({
		where: {
			participation: { activityId, studentId: users["student-a"].id },
			status: "PENDING_COUNSELOR",
		},
	});
	await expect(
		changeParticipation(users["college-a"].session, termId, {
			id: pendingA.id,
			revision: pendingA.revision,
			action: "remove",
			reason: "原主办学院尝试移除",
		}),
	).rejects.toThrow("主办学院");
	await expect(
		changeParticipation(users["college-b"].session, termId, {
			id: pendingA.id,
			revision: pendingA.revision,
			action: "remove",
		}),
	).rejects.toThrow("理由");
	await changeParticipation(users["college-b"].session, termId, {
		id: pendingA.id,
		revision: pendingA.revision,
		action: "remove",
		reason: "签到记录与本人核对后确认未实际参加",
	});
	expect(
		(
			await db.participation.findUniqueOrThrow({
				where: {
					activityId_studentId: {
						activityId,
						studentId: users["student-a"].id,
					},
				},
			})
		).removedAt,
	).not.toBeNull();
	expect(
		(
			await db.recognitionSource.findUniqueOrThrow({
				where: { id: pendingA.id },
			})
		).status,
	).toBe("WITHDRAWN");
	expect(
		(
			await pageActivityParticipants(
				users["college-b"].session,
				termId,
				activityId,
			)
		).total,
	).toBe(2);
	expect(
		(
			await pageActivityParticipants(
				users["college-b"].session,
				termId,
				activityId,
				1,
				"",
				{ removed: "removed" },
			)
		).total,
	).toBe(1);
});

test("参与学生只读当前有效活动证明，未登记或已移除学生无权查看", async () => {
	const active = await db.activityEvidence.findFirstOrThrow({
		where: { activityId, active: true },
	});
	const inactive = await db.activityEvidence.findMany({
		where: { activityId, active: false },
	});
	expect(inactive.length).toBeGreaterThan(0);

	const registered = await getActivity(users["student-b"].session, activityId);
	expect(registered.evidence?.map((row) => row.id)).toEqual([active.id]);
	expect(
		(
			await downloadEvidence(users["student-b"].session, active.evidenceId)
		).bytes.equals(png),
	).toBe(true);
	await expect(
		downloadEvidence(users["student-b"].session, inactive[0].evidenceId),
	).rejects.toThrow("权限");

	const unregistered = await getActivity(users["student-d"].session, activityId);
	expect(unregistered.evidence).toEqual([]);
	await expect(
		downloadEvidence(users["student-d"].session, active.evidenceId),
	).rejects.toThrow("权限");

	const removed = await getActivity(users["student-a"].session, activityId);
	expect(removed.evidence).toEqual([]);
	await expect(
		downloadEvidence(users["student-a"].session, active.evidenceId),
	).rejects.toThrow("权限");

	const manager = await getActivity(users["college-b"].session, activityId);
	expect(new Set(manager.evidence?.map((row) => row.id))).toEqual(
		new Set([active.id, ...inactive.map((row) => row.id)]),
	);
	expect(
		(
			await downloadEvidence(users["college-b"].session, inactive[0].evidenceId)
		).bytes.equals(png),
	).toBe(true);
});

test("周期锁定后拒绝继续审核参与记录", async () => {
	const pending = await db.recognitionSource.findFirstOrThrow({
		where: { participation: { activityId }, status: "PENDING_COUNSELOR" },
	});
	await db.term.update({ where: { id: termId }, data: { phase: "LOCKED" } });
	await expect(
		reviewParticipation(users["counselor-a"].session, termId, {
			id: pending.id,
			revision: pending.revision,
			action: "counselorApprove",
		}),
	).rejects.toThrow("阶段");
});
