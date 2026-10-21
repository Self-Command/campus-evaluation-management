import { afterAll, beforeAll, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db } from "@/server/db";
import { organizationFixture } from "./organization-fixture";
import { createTerm, saveScheme, activateTerm } from "@/server/terms";
import {
	saveActivity,
	confirmActivity,
	publishActivity,
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
import {
	pageActivityParticipants,
	saveActivityScore,
} from "@/server/activity-participants";
import {
	reviewParticipation,
	changeParticipation,
	pageRecognitions,
} from "@/server/recognitions";
import { getStudentResult } from "@/server/results";
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

const rowFor = (user: Identity, score?: string) => ({
	login: user.login,
	name: user.name,
	college: user.profile.college,
	major: user.profile.major,
	className: user.profile.className,
	...(score === undefined ? {} : { score }),
});

const audience = () => ({
	colleges: [orgA.college.name, orgB.college.name],
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
	studentIds: [
		users["student-a"].id,
		users["student-b"].id,
		users["student-c"].id,
		users.unbound.id,
	],
});

const activityInput = () => ({
	name: `${marker}-联合活动`,
	organizer: "经济学院团委",
	content: "跨学院联合实践活动",
	requirements: "完成签到与服务",
	startsAt: "2026-10-01T08:00:00.000Z",
	endsAt: "2026-10-02T08:00:00.000Z",
	nodeId: "activity",
	points: "10",
	scoreMode: "INDIVIDUAL" as const,
	audience: audience(),
});

async function currentRevision() {
	return (await db.activity.findUniqueOrThrow({ where: { id: activityId } }))
		.revision;
}

beforeAll(async () => {
	directory = await mkdtemp(join(tmpdir(), "campus-activity-"));
	process.env.EVIDENCE_DIR = directory;
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
	await identity("unbound", "STUDENT", { organization: orgA });
	await identity("outsider", "STUDENT", {
		organization: orgA,
		classId: orgA.schoolClass.id,
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
	await db.$disconnect();
});

test("主办学院维护活动与共享证明，管理员确认分值，范围按学院/班级/学生三组 AND", async () => {
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
	await expect(
		confirmActivity(users["college-a"].session, termId, {
			id: activityId,
			revision: 0,
		}),
	).rejects.toThrow("权限");
	expect(
		(
			await confirmActivity(users.admin.session, termId, {
				id: activityId,
				revision: 0,
			})
		).confirmed,
	).toBe(true);
	await expect(
		saveActivity(users["college-a"].session, termId, {
			id: activityId,
			revision: 1,
			activity: { ...activityInput(), points: "12" },
		}),
	).rejects.toThrow("统一更正");

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
			revision: 1,
			evidenceId: initialEvidence.id,
			note: "活动签到表和现场合影",
		},
	);
	activityEvidenceId = evidence.id;
	expect(evidence.version).toBe(1);
	expect(evidence.active).toBe(true);

	const preview = await audienceAction(users["college-a"].session, {
		action: "preview",
		termId,
		audience: audience(),
	});
	await publishActivity(users["college-a"].session, termId, {
		id: activityId,
		revision: 2,
		action: "publish",
		token: "token" in preview ? preview.token : "",
	});
	for (const label of ["student-a", "student-b", "student-c", "unbound"]) {
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
	const hostView = await getActivity(users["college-a"].session, activityId);
	expect(hostView.canManage).toBe(true);
	expect(hostView.evidence).toHaveLength(1);
	const otherView = await getActivity(users["college-b"].session, activityId);
	expect(otherView.canManage).toBe(false);
	expect(otherView.canReview).toBe(true);
});

test("无归属历史活动只能由管理员移交主办学院，发布者不能自行认领", async () => {
	const legacy = await db.activity.create({
		data: {
			termId,
			ownerId: users.publisher.id,
			name: `${marker}-无归属历史活动`,
			organizer: "历史主办方",
			content: "历史活动内容",
			requirements: "历史参与要求",
			startsAt: new Date("2026-10-01T08:00:00.000Z"),
			endsAt: new Date("2026-10-02T08:00:00.000Z"),
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
				rowFor(users["student-a"], "8"),
				rowFor(users["student-a"], "8"),
				{ ...rowFor(users["student-b"], "9"), name: "姓名不符" },
				rowFor(users.unbound, "7"),
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
				rowFor(users["student-a"], "8"),
				rowFor(users["student-b"], "9"),
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
			rows: [rowFor(users["student-b"], "9")],
		}),
	).rejects.toThrow("主办学院");
	await expect(
		previewParticipationImport(users["student-a"].session, termId, {
			activityId,
			kind: "INITIAL",
			note: "学生尝试导入",
			rows: [rowFor(users["student-a"], "8")],
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
			rows: [rowFor(users["student-a"], "8")],
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
	).toBe("8.00");

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

test("补录更正经理由预览、只增改不删除，已通过来源替代后重新两级审核", async () => {
	await expect(
		previewParticipationImport(users["college-a"].session, termId, {
			activityId,
			kind: "CORRECTION",
			note: "补录漏报学生",
			rows: [rowFor(users["student-c"], "7")],
		}),
	).rejects.toThrow("理由");
	const stale = await previewParticipationImport(
		users["college-a"].session,
		termId,
		{
			activityId,
			kind: "CORRECTION",
			note: "补录漏报学生并更正错分",
			reason: "签到表复核发现漏报与分数录入错误",
			rows: [
				rowFor(users["student-a"], "8"),
				rowFor(users["student-b"], "6"),
				rowFor(users["student-c"], "7"),
			],
		},
	);
	expect(stale.rows.map((row) => row.state)).toEqual([
		"UNCHANGED",
		"UPDATE",
		"NEW",
	]);
	await db.participation.update({
		where: {
			activityId_studentId: {
				activityId,
				studentId: users["student-b"].id,
			},
		},
		data: { score: "1" },
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
			note: "补录漏报学生并更正错分",
			reason: "签到表复核发现漏报与分数录入错误",
			rows: [
				rowFor(users["student-a"], "8"),
				rowFor(users["student-b"], "6"),
				rowFor(users["student-c"], "7"),
			],
		},
	);
	expect(corrected.rows.map((row) => row.state)).toEqual([
		"UNCHANGED",
		"UPDATE",
		"NEW",
	]);
	const result = await commitParticipationImport(
		users["college-a"].session,
		termId,
		corrected.id,
	);
	expect(result.updated).toBe(1);
	expect(result.submitted).toBe(1);
	expect(await db.participation.count({ where: { activityId } })).toBe(3);
	const sourceB = await db.recognitionSource.findFirstOrThrow({
		where: {
			participation: { activityId, studentId: users["student-b"].id },
		},
		orderBy: { createdAt: "desc" },
	});
	expect(sourceB.status).toBe("PENDING_COUNSELOR");
	expect(sourceB.origin).toBe("CORRECTION");
	const oldB = await db.recognitionSource.findFirstOrThrow({
		where: {
			participation: { activityId, studentId: users["student-b"].id },
			status: "SUPERSEDED",
		},
	});
	expect(oldB.id).not.toBe(sourceB.id);
	expect(
		(await getStudentResult(users["student-b"].session, termId))
			.participations,
	).toHaveLength(0);

	const sourceC = await db.recognitionSource.findFirstOrThrow({
		where: {
			participation: { activityId, studentId: users["student-c"].id },
		},
	});
	for (const [counselor, college, source] of [
		["counselor-b", "college-b", sourceB],
		["counselor-a", "college-a", sourceC],
	] as const) {
		const first = await reviewParticipation(users[counselor].session, termId, {
			id: source.id,
			revision: source.revision,
			action: "counselorApprove",
		});
		await reviewParticipation(users[college].session, termId, {
			id: source.id,
			revision: first.revision,
			action: "collegeApprove",
		});
	}
	expect(
		(await getStudentResult(users["student-b"].session, termId)).result.total,
	).toBe("6.00");
	expect(
		(await getStudentResult(users["student-c"].session, termId)).result.total,
	).toBe("7.00");
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

test("原始分只能在确认的逐人分活动内维护，修订防覆盖且锁定后拒绝审核", async () => {
	const studentC = await db.participation.findUniqueOrThrow({
		where: {
			activityId_studentId: {
				activityId,
				studentId: users["student-c"].id,
			},
		},
	});
	const studentB = await db.participation.findUniqueOrThrow({
		where: {
			activityId_studentId: {
				activityId,
				studentId: users["student-b"].id,
			},
		},
	});
	const pendingB = await db.recognitionSource.findFirstOrThrow({
		where: {
			participation: { activityId, studentId: users["student-b"].id },
			status: "PENDING_COUNSELOR",
		},
	});
	const counselorB = await reviewParticipation(
		users["counselor-b"].session,
		termId,
		{
			id: pendingB.id,
			revision: pendingB.revision,
			action: "counselorApprove",
		},
	);
	expect(counselorB.status).toBe("PENDING_COLLEGE");
	const reopenedB = await saveActivityScore(users["college-b"].session, termId, {
		participationId: studentB.id,
		revision: (
			await db.participation.findUniqueOrThrow({
				where: { id: studentB.id },
				select: { revision: true },
			})
		).revision,
		value: "5",
		reason: "签到表复核更正活动原始分",
	});
	expect(reopenedB.score).toBe("5");
	const resetB = await db.recognitionSource.findUniqueOrThrow({
		where: { id: pendingB.id },
	});
	expect(resetB.status).toBe("PENDING_COUNSELOR");
	expect(resetB.counselorId).toBeNull();
	await expect(
		reviewParticipation(users["college-b"].session, termId, {
			id: pendingB.id,
			revision: counselorB.revision,
			action: "collegeApprove",
		}),
	).rejects.toThrow("已变化");
	await expect(
		saveActivityScore(users["college-b"].session, termId, {
			participationId: studentC.id,
			revision: studentC.revision,
			value: "11",
			reason: "超出活动上限",
		}),
	).rejects.toThrow("上限");
	await expect(
		saveActivityScore(users["college-b"].session, termId, {
			participationId: studentC.id,
			revision: studentC.revision + 1,
			value: "5",
			reason: "旧页面录分",
		}),
	).rejects.toThrow("已变化");
	const sourceC = await db.recognitionSource.findFirstOrThrow({
		where: {
			participation: { activityId, studentId: users["student-c"].id },
			status: "PENDING_COUNSELOR",
		},
	});
	await expect(
		reviewParticipation(users["counselor-a"].session, termId, {
			id: sourceC.id,
			revision: sourceC.revision + 1,
			action: "counselorApprove",
		}),
	).rejects.toThrow("已变化");
	await db.term.update({ where: { id: termId }, data: { phase: "LOCKED" } });
	await expect(
		reviewParticipation(users["counselor-a"].session, termId, {
			id: sourceC.id,
			revision: sourceC.revision,
			action: "counselorApprove",
		}),
	).rejects.toThrow("阶段");
});
