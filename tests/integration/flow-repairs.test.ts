import { afterAll, beforeAll, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db } from "@/server/db";
import { createTerm, saveScheme, activateTerm } from "@/server/terms";
import { nodeSchema } from "@/lib/scoring/types";
import {
	saveActivity,
	publishActivity,
	pageActivities,
	pageActivityFeed,
	getActivity,
} from "@/server/activities";
import {
	audienceAction,
	audienceFields,
	normalizeAudience,
	classKey,
} from "@/server/activity-policy";
import { saveActivityEvidence } from "@/server/activity-evidence";
import {
	previewParticipationImport,
	commitParticipationImport,
} from "@/server/participation-import";
import { pageActivityParticipants } from "@/server/activity-participants";
import {
	reviewParticipation,
	changeParticipation,
	listRecognitions,
} from "@/server/recognitions";
import { uploadEvidence } from "@/server/evidence";
import {
	getStudentResult,
	pageResultStudents,
} from "@/server/results";
import { submitClaim, changeClaim } from "@/server/claims";
import { correctScoring } from "@/server/corrections";
import {
	previewPublication,
	publishResults,
	confirmResult,
	reopenTerm,
	setPublicationCohort,
	extendChecking,
	previewSettlement,
} from "@/server/publications";
import { saveGrade, listGrades } from "@/server/grades";
import {
	previewGradeImport,
	commitGradeImport,
} from "@/server/grade-import";
import { saveDeduction } from "@/server/deductions";
import { inputHistory } from "@/server/input-history";

const url = new URL(process.env.DATABASE_URL!);
if (
	url.hostname !== "127.0.0.1" ||
	!/^\/campus_test_[a-f0-9]+$/.test(url.pathname)
)
	throw new Error("仅可在隔离运行器的临时数据库中测试");
const marker = `repair-${randomUUID().slice(0, 8)}`;
const users: Record<string, { id: string; login: string; session: string }> =
	{};
const terms: string[] = [];
let termId = "";
let activityId = "";
let sourceId = "";
let evidenceId = "";
let studentEvidenceId = "";
let activityEvidenceId = "";
let attachmentRoot: string | undefined;
let orgCollegeId = "";
let orgMajorId = "";
let orgClassId = "";
const profile = { college: "修复学院", major: "修复专业", className: "一班" };
const png = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=",
	"base64",
);
const scope = () => ({
	scope: "CLASS",
	colleges: [],
	classes: [profile],
});
const activityData = (name: string) => ({
	name,
	organizer: "活动组织",
	content: "活动内容与安排",
	startsAt: new Date(Date.now() - 3_600_000).toISOString(),
	endsAt: new Date(Date.now() + 86_400_000).toISOString(),
	nodeId: "activity",
	points: "10",
	audience: scope(),
});
const rowFor = (key: string) => ({
	login: users[key].login,
	name: users[key].login.replace(`${marker}-`, ""),
	college: users[key].login === `${marker}-wrongCollege` ? "另一学院" : profile.college,
	major: users[key].login === `${marker}-wrongClass` ? "另一专业" : profile.major,
	className: profile.className,
});
const seedActivity = async (
	ownerId: string,
	targetTermId: string,
	overrides: Partial<ReturnType<typeof activityData>> & {
		confirmed?: boolean;
		publishedAt?: Date | null;
	} = {},
) => {
	const data = { ...activityData("历史既有活动"), ...overrides };
	return db.activity.create({
		data: {
			termId: targetTermId,
			ownerId,
			collegeId: orgCollegeId,
			name: data.name,
			organizer: data.organizer,
			content: data.content,
			startsAt: new Date(data.startsAt),
			endsAt: new Date(data.endsAt),
			nodeId: data.nodeId,
			points: data.points,
			confirmed: data.confirmed ?? false,
			publishedAt: data.publishedAt ?? null,
			...audienceFields(normalizeAudience(data.audience)),
		},
	});
};
const scheme = () => ({
	nodes: [
		nodeSchema.parse({
			id: "total",
			parentId: null,
			name: "总分",
			kind: "SUM",
			order: 0,
		}),
		nodeSchema.parse({
			id: "grade",
			parentId: "total",
			name: "成绩",
			kind: "GRADE",
			required: false,
			order: 0,
		}),
		nodeSchema.parse({
			id: "activity",
			parentId: "total",
			name: "活动",
			kind: "ACTIVITY",
			order: 1,
		}),
	],
	deductions: [{ id: "discipline", name: "纪律扣分", nodeId: "total", coefficient: "1" }],
});
async function newTerm(name: string) {
	const term = await createTerm(users.admin.session, {
		name,
		template: false,
	});
	terms.push(term.id);
	await saveScheme(users.admin.session, term.id, {
		revision: 0,
		scheme: scheme(),
	});
	await activateTerm(users.admin.session, term.id, { revision: 1 });
	return term.id;
}
async function publish(id: string, requireConfirmation = false) {
	const preview = await previewPublication(users.admin.session, id);
	return publishResults(users.admin.session, id, {
		revision: preview.termRevision,
		inputRevision: preview.inputRevision,
		token: preview.token,
		checkingEndsAt: new Date(Date.now() + 60_000).toISOString(),
		requireConfirmation,
		requestId: randomUUID(),
	});
}

beforeAll(async () => {
	attachmentRoot = await mkdtemp(join(tmpdir(), "campus-repairs-"));
	process.env.EVIDENCE_DIR = attachmentRoot;
	for (const [key, role] of [
		["admin", "ADMIN"],
		["publisher", "PUBLISHER"],
		["outsider", "PUBLISHER"],
		["student", "STUDENT"],
		["other", "STUDENT"],
		["wrongClass", "STUDENT"],
		["wrongCollege", "STUDENT"],
		["notSelected", "STUDENT"],
		["counselor", "COUNSELOR"],
		["college", "COLLEGE"],
	] as const) {
		const login = `${marker}-${key}`;
		const studentProfile = {
			...profile,
			...(key === "wrongClass" ? { major: "另一专业" } : {}),
			...(key === "wrongCollege" ? { college: "另一学院" } : {}),
			...(key === "notSelected" ? { className: "未选班级" } : {}),
		};
		const user = await db.user.create({
			data: {
				login,
				name: key,
				role,
				passwordHash: "unused",
				mustChangePassword: false,
				...(role === "STUDENT"
					? {
							studentProfile: {
								create: { studentNumber: login, ...studentProfile },
							},
						}
					: {}),
			},
		});
		users[key] = {
			id: user.id,
			login,
			session: (
				await db.authSession.create({
					data: {
						userId: user.id,
						version: 0,
						expiresAt: new Date(Date.now() + 3_600_000),
					},
				})
			).id,
		};
	}
	orgCollegeId = (
		await db.college.create({
			data: { code: `${marker}-college`, name: profile.college },
		})
	).id;
	await db.user.update({
		where: { id: users.counselor.id },
		data: { collegeId: orgCollegeId },
	});
	await db.user.update({
		where: { id: users.college.id },
		data: { collegeId: orgCollegeId },
	});
	orgMajorId = (
		await db.major.create({
			data: {
				code: `${marker}-major`,
				name: profile.major,
				collegeId: orgCollegeId,
			},
		})
	).id;
	orgClassId = (
		await db.schoolClass.create({
			data: {
				code: `${marker}-class`,
				name: profile.className,
				majorId: orgMajorId,
				counselorId: users.counselor.id,
			},
		})
	).id;
	for (const key of ["student", "other"]) {
		await db.studentProfile.update({
			where: { userId: users[key].id },
			data: { classId: orgClassId },
		});
	}
	termId = await newTerm("活动和治理缺口回归");
	evidenceId = (
		await uploadEvidence(users.publisher.session, "名单证明.png", png)
	).id;
	studentEvidenceId = (
		await uploadEvidence(users.student.session, "本人证明.png", png)
	).id;
});

afterAll(async () => {
	const ids = Object.values(users).map((user) => user.id);
	if (orgClassId)
		await db.schoolClass.updateMany({
			where: { id: orgClassId },
			data: { counselorId: null },
		});
	await db.appealEvidence.deleteMany({
		where: { appeal: { termId: { in: terms } } },
	});
	await db.resultAppeal.deleteMany({
		where: { termId: { in: terms } },
	});
	await db.resultConfirmation.deleteMany({
		where: { result: { publication: { termId: { in: terms } } } },
	});
	await db.publicationExtension.deleteMany({
		where: { publication: { termId: { in: terms } } },
	});
	await db.publishedResult.deleteMany({
		where: { publication: { termId: { in: terms } } },
	});
	await db.settlementSnapshot.deleteMany({
		where: { termId: { in: terms } },
	});
	await db.termReopen.deleteMany({ where: { termId: { in: terms } } });
	await db.resultPublication.deleteMany({
		where: { termId: { in: terms } },
	});
	await db.claimEvidence.deleteMany({
		where: { claim: { termId: { in: terms } } },
	});
	await db.personalClaim.deleteMany({
		where: { termId: { in: terms } },
	});
	await db.recognitionProject.deleteMany({
		where: { termId: { in: terms } },
	});
	await db.recognitionSource.deleteMany({
		where: { participation: { activity: { termId: { in: terms } } } },
	});
	await db.participationImport.deleteMany({
		where: { termId: { in: terms } },
	});
	await db.participation.deleteMany({
		where: { activity: { termId: { in: terms } } },
	});
	await db.activityEvidence.deleteMany({
		where: { activity: { termId: { in: terms } } },
	});
	await db.activity.deleteMany({ where: { termId: { in: terms } } });
	await db.gradeImport.deleteMany({ where: { termId: { in: terms } } });
	await db.gradeInput.deleteMany({ where: { termId: { in: terms } } });
	await db.deductionInput.deleteMany({ where: { termId: { in: terms } } });
	await db.term.deleteMany({ where: { id: { in: terms } } });
	await db.evidence.deleteMany({ where: { ownerId: { in: ids } } });
	await db.auditEvent.deleteMany({ where: { actorId: { in: ids } } });
	await db.user.deleteMany({ where: { id: { in: ids } } });
	if (orgClassId)
		await db.schoolClass.deleteMany({ where: { id: orgClassId } });
	if (orgMajorId)
		await db.major.deleteMany({ where: { id: orgMajorId } });
	if (orgCollegeId)
		await db.college.deleteMany({ where: { id: orgCollegeId } });
	if (
		attachmentRoot &&
		attachmentRoot.startsWith(join(tmpdir(), "campus-repairs-"))
	)
		await rm(attachmentRoot, { recursive: true, force: true });
	delete process.env.EVIDENCE_DIR;
	await db.$disconnect();
});

test("FL01-04：草稿不可见，班级范围按并集匹配，发布时重新校验范围", async () => {
	await expect(
		saveActivity(users.publisher.session, termId, {
			activity: activityData("新建活动应被阻断"),
		}),
	).rejects.toThrow("新活动");
	activityId = (
		await seedActivity(users.publisher.id, termId, {
			name: "活动分值测试",
		})
	).id;
	expect((await pageActivityFeed(users.student.session, termId)).total).toBe(0);
	const invalidScope = {
		scope: "CLASS",
		colleges: [],
		classes: [{ ...profile, className: "不存在班级" }],
	};
	const invalid = await audienceAction(users.publisher.session, {
		action: "preview",
		termId,
		audience: invalidScope,
	});
	expect(invalid).toMatchObject({
		errors: expect.arrayContaining([expect.any(String)]),
	});
	const preview = await audienceAction(users.publisher.session, {
		action: "preview",
		termId,
		audience: scope(),
	});
	expect(preview).toMatchObject({
		count: 2,
		collegeCount: 1,
		majorCount: 1,
		classCount: 1,
		errors: [],
	});
	expect(preview).not.toHaveProperty("students");
	expect(preview).not.toHaveProperty("token");
	await db.studentProfile.updateMany({
		where: { userId: { in: [users.student.id, users.other.id] } },
		data: { className: "转班" },
	});
	await expect(
		publishActivity(users.publisher.session, termId, {
			id: activityId,
			revision: 0,
			action: "publish",
		}),
	).rejects.toThrow("所选班级已无有效学生");
	await db.studentProfile.updateMany({
		where: { userId: { in: [users.student.id, users.other.id] } },
		data: { className: profile.className },
	});
	const valid = await audienceAction(users.publisher.session, {
		action: "preview",
		termId,
		audience: scope(),
	});
	expect(valid).toMatchObject({ count: 2, errors: [] });
	await publishActivity(users.publisher.session, termId, {
		id: activityId,
		revision: 0,
		action: "publish",
	});
	expect(
		(await db.activity.findUniqueOrThrow({ where: { id: activityId } }))
			.confirmed,
	).toBe(true);
	expect((await pageActivityFeed(users.student.session, termId)).total).toBe(1);
	for (const key of ["wrongClass", "wrongCollege", "notSelected"])
		expect((await pageActivityFeed(users[key].session, termId)).total).toBe(0);
	expect((await pageActivities(users.student.session, termId)).total).toBe(0);
	const legacy = await db.activity.create({
		data: {
			termId,
			ownerId: users.publisher.id,
			name: "历史来源未发布",
			organizer: "组织",
			content: "内容",
			startsAt: new Date(),
			endsAt: new Date(),
			nodeId: "activity",
			points: "1",
			confirmed: true,
		},
	});
	await db.participation.create({
		data: {
			activityId: legacy.id,
			studentId: users.student.id,
			sources: {
				create: {
					submitterId: users.publisher.id,
					note: "历史来源",
					status: "REJECTED",
				},
			},
		},
	});
	expect((await pageActivities(users.student.session, termId)).total).toBe(0);
	await expect(
		getActivity(users.student.session, legacy.id),
	).rejects.toThrow("无权");
	const changed = await saveActivity(users.publisher.session, termId, {
		id: activityId,
		revision: 1,
		activity: {
			...activityData("活动分值测试"),
			audience: {
				scope: "CLASS",
				colleges: [],
				classes: [{ ...profile, className: "未选班级" }],
			},
		},
	});
	expect(changed.publishedAt).toBeNull();
	expect(changed.publishRevision).toBe(2);
	expect((await pageActivityFeed(users.student.session, termId)).total).toBe(0);
	await saveActivity(users.publisher.session, termId, {
		id: activityId,
		revision: 2,
		activity: activityData("活动分值测试"),
	});
	const republish = await audienceAction(users.publisher.session, {
		action: "preview",
		termId,
		audience: scope(),
	});
	expect(republish).toMatchObject({ errors: [] });
	await publishActivity(users.publisher.session, termId, {
		id: activityId,
		revision: 3,
		action: "publish",
	});
});

test("FL05-07：完整名单导入、活动分值、归属学院两级审核与范围失效", async () => {
	const activity = await db.activity.findUniqueOrThrow({
		where: { id: activityId },
	});
	const shared = await saveActivityEvidence(users.publisher.session, termId, {
		activityId,
		revision: activity.revision,
		evidenceId,
		note: "活动签到表与现场照片",
	});
	activityEvidenceId = shared.id;
	const input = {
		activityId,
		kind: "INITIAL" as const,
		note: "正式参与名单",
		rows: [rowFor("student")],
	};
	await expect(
		previewParticipationImport(users.outsider.session, termId, input),
	).rejects.toThrow("主办学院");
	await expect(
		previewParticipationImport(users.student.session, termId, input),
	).rejects.toThrow("权限");
	const preview = await previewParticipationImport(
		users.publisher.session,
		termId,
		input,
	);
	expect(preview.rows[0].state).toBe("NEW");
	await commitParticipationImport(users.publisher.session, termId, preview.id);
	expect((await pageActivities(users.student.session, termId)).total).toBe(1);
	expect(
		(await getStudentResult(users.student.session, termId)).participations,
	).toHaveLength(0);
	const fact = await db.participation.findUniqueOrThrow({
		where: {
			activityId_studentId: {
				activityId,
				studentId: users.student.id,
			},
		},
		include: { sources: true },
	});
	sourceId = fact.sources[0].id;
	await expect(
		reviewParticipation(users.admin.session, termId, {
			id: sourceId,
			revision: 0,
			action: "counselorApprove",
		}),
	).rejects.toThrow("辅导员初审权限");
	const counseled = await reviewParticipation(users.counselor.session, termId, {
		id: sourceId,
		revision: 0,
		action: "counselorApprove",
	});
	await reviewParticipation(users.college.session, termId, {
		id: sourceId,
		revision: counseled.revision,
		action: "collegeApprove",
	});
	const result = await getStudentResult(users.student.session, termId);
	expect(result.participations[0].points).toBe("10");
	expect(result.participations[0].activityEvidence).toEqual([
		{ id: evidenceId, name: "名单证明.png" },
	]);
	expect(result.result.total).toBe("10.00");
	const roster = await pageActivityParticipants(
		users.publisher.session,
		termId,
		activityId,
	);
	expect(roster.items).toHaveLength(1);
	expect(roster.items[0].name).toBe("student");
	await db.studentProfile.update({
		where: { userId: users.student.id },
		data: { className: "转班后" },
	});
	expect((await pageActivityFeed(users.student.session, termId)).total).toBe(0);
	expect((await pageActivities(users.student.session, termId)).total).toBe(1);
	expect(
		(await getActivity(users.student.session, activityId)).canSubmit,
	).toBe(false);
	await db.studentProfile.update({
		where: { userId: users.student.id },
		data: { className: profile.className },
	});
});

test("FL08-09：退回由主办学院补充后重提，学生不能自行提交参与，个人申报仍可放弃重提", async () => {
	const current = await db.participation.findUniqueOrThrow({
		where: {
			activityId_studentId: {
				activityId,
				studentId: users.student.id,
			},
		},
		include: { sources: true },
	});
	const activityRow = await db.activity.findUniqueOrThrow({
		where: { id: activityId },
	});
	const refreshedFile = await uploadEvidence(
		users.publisher.session,
		"复核签到材料.png",
		png,
	);
	const refreshed = await saveActivityEvidence(
		users.publisher.session,
		termId,
		{
			activityId,
			revision: activityRow.revision,
			evidenceId: refreshedFile.id,
			note: "复核当天签到记录",
			reason: "补充签退材料",
		},
	);
	activityEvidenceId = refreshed.id;
	const pending = await db.recognitionSource.findFirstOrThrow({
		where: {
			participationId: current.id,
			status: "PENDING_COUNSELOR",
		},
	});
	sourceId = pending.id;
	await expect(
		reviewParticipation(users.counselor.session, termId, {
			id: sourceId,
			revision: pending.revision,
			action: "counselorReturn",
		}),
	).rejects.toThrow("退回理由");
	const returned = await reviewParticipation(
		users.counselor.session,
		termId,
		{
			id: sourceId,
			revision: pending.revision,
			action: "counselorReturn",
			reason: "请补充当天签退记录",
		},
	);
	expect(returned.status).toBe("RETURNED");
	await expect(
		changeParticipation(users.student.session, termId, {
			id: sourceId,
			revision: returned.revision,
			action: "resubmit",
			note: "学生自行重提",
		}),
	).rejects.toThrow("权限");
	await expect(
		changeParticipation(users.outsider.session, termId, {
			id: sourceId,
			revision: returned.revision,
			action: "resubmit",
			note: "其他发布者重提",
		}),
	).rejects.toThrow("主办学院");
	await expect(
		changeParticipation(users.publisher.session, termId, {
			id: sourceId,
			revision: returned.revision,
			action: "resubmit",
		}),
	).rejects.toThrow("补充说明");
	const resubmitted = await changeParticipation(
		users.publisher.session,
		termId,
		{
			id: sourceId,
			revision: returned.revision,
			action: "resubmit",
			note: "已补充签退记录并核对名单",
		},
	);
	expect(resubmitted.status).toBe("PENDING_COUNSELOR");
	const counseled = await reviewParticipation(
		users.counselor.session,
		termId,
		{
			id: sourceId,
			revision: resubmitted.revision,
			action: "counselorApprove",
		},
	);
	await reviewParticipation(users.college.session, termId, {
		id: sourceId,
		revision: counseled.revision,
		action: "collegeApprove",
	});

	const claim = await submitClaim(users.student.session, termId, {
		title: "需补充的申报",
		occurredOn: "2026-10-20",
		note: "提交成果事实",
		evidenceIds: [studentEvidenceId],
	});
	await expect(
		changeClaim(users.counselor.session, termId, claim.id, {
			revision: 0,
			action: "return",
		}),
	).rejects.toThrow("请填写退回修改理由");
	await changeClaim(users.counselor.session, termId, claim.id, {
		revision: 0,
		action: "return",
		reason: "需要补充材料",
	});
	await changeClaim(users.student.session, termId, claim.id, {
		revision: 1,
		action: "abandon",
	});
	expect(
		(
			await db.personalClaim.findUniqueOrThrow({ where: { id: claim.id } })
		).status,
	).toBe("ABANDONED");
	const second = await submitClaim(users.student.session, termId, {
		title: "归属变化申报",
		occurredOn: "2026-10-20",
		note: "再次提交成果",
		evidenceIds: [studentEvidenceId],
	});
	await changeClaim(users.counselor.session, termId, second.id, {
		revision: 0,
		action: "return",
		reason: "补充原始证明",
	});
	await db.studentProfile.update({
		where: { userId: users.student.id },
		data: { classId: null },
	});
	await expect(
		changeClaim(users.student.session, termId, second.id, {
			revision: 1,
			action: "resubmit",
			title: "归属变化申报",
			occurredOn: "2026-10-20",
			note: "重新提交材料",
			evidenceIds: [studentEvidenceId],
		}),
	).rejects.toThrow("归属或责任辅导员已变化");
	await db.studentProfile.update({
		where: { userId: users.student.id },
		data: { classId: orgClassId },
	});
	await changeClaim(users.student.session, termId, second.id, {
		revision: 1,
		action: "resubmit",
		title: "归属变化申报",
		occurredOn: "2026-10-20",
		note: "重新提交材料",
		evidenceIds: [studentEvidenceId],
	});
});

test("FL10：更正预览不写库，token 绑定输入，活动与项目更正事务写入", async () => {
	const term = await db.term.findUniqueOrThrow({ where: { id: termId } });
	const data = {
		kind: "activity",
		id: activityId,
		nodeId: "activity",
		points: "12",
	};
	const preview = await correctScoring(users.admin.session, termId, {
		...data,
		action: "preview",
	});
	expect(
		(
			await db.activity.findUniqueOrThrow({ where: { id: activityId } })
		).points.toFixed(),
	).toBe("10");
	await expect(
		correctScoring(users.admin.session, termId, {
			...data,
			points: "13",
			action: "commit",
			revision: term.revision,
			token: "token" in preview ? preview.token : "",
			reason: "依据学校更正通知",
		}),
	).rejects.toThrow("预检");
	await correctScoring(users.admin.session, termId, {
		...data,
		action: "commit",
		revision: term.revision,
		token: "token" in preview ? preview.token : "",
		reason: "依据学校更正通知",
	});
	expect(
		(
			await db.activity.findUniqueOrThrow({ where: { id: activityId } })
		).points.toFixed(),
	).toBe("12");
	const invalidScheme = {
		...scheme(),
		nodes: scheme().nodes.filter((node) => node.id !== "activity"),
	};
	const blocked = await correctScoring(users.admin.session, termId, {
		kind: "scheme",
		action: "preview",
		scheme: invalidScheme,
	});
	expect("errors" in blocked && blocked.errors.length).toBeGreaterThan(0);
	const project = await db.recognitionProject.create({
		data: {
			termId,
			name: "更正项目",
			description: "依据固定成果",
			nodeId: "activity",
			points: "2",
		},
	});
	const change = {
		kind: "project",
		id: project.id,
		nodeId: "activity",
		points: "4",
	};
	const p = await correctScoring(users.admin.session, termId, {
		...change,
		action: "preview",
	});
	await correctScoring(users.admin.session, termId, {
		...change,
		action: "commit",
		revision: p.revision,
		token: "token" in p ? p.token : "",
		reason: "项目标准更正",
	});
	expect(
		(
			await db.recognitionProject.findUniqueOrThrow({
				where: { id: project.id },
			})
		).points.toFixed(),
	).toBe("4");
	const nextScheme = scheme();
	nextScheme.nodes[1].name = "学业成绩";
	const s = await correctScoring(users.admin.session, termId, {
		kind: "scheme",
		action: "preview",
		scheme: nextScheme,
	});
	await correctScoring(users.admin.session, termId, {
		kind: "scheme",
		action: "commit",
		scheme: nextScheme,
		revision: s.revision,
		token: "token" in s ? s.token : "",
		reason: "制度名称更正",
	});
	expect(
		(
			await db.term.findUniqueOrThrow({ where: { id: termId } })
		).inputRevision,
	).toBeGreaterThan(term.inputRevision);
});

test("FL10补充：已通过固定分与规则更正实际改变新分数，旧发布依据不变", async () => {
	const correctionTerm = await newTerm("真实计分更正回归");
	const activity = await seedActivity(users.publisher.id, correctionTerm, {
		name: "固定分更正",
		points: "3",
		confirmed: true,
		publishedAt: new Date(),
	});
	await db.participation.create({
		data: {
			activityId: activity.id,
			studentId: users.student.id,
			registeredAt: new Date(),
			registeredBy: users.publisher.id,
			sources: {
				create: {
					submitterId: users.publisher.id,
					status: "APPROVED",
					note: "固定分参与证明",
				},
			},
		},
	});
	expect(
		(await getStudentResult(users.student.session, correctionTerm)).result
			.total,
	).toBe("3.00");
	const data = {
		kind: "activity",
		id: activity.id,
		nodeId: "activity",
		points: "5",
	};
	const preview = await correctScoring(users.admin.session, correctionTerm, {
		...data,
		action: "preview",
	});
	expect(
		preview.changes.find((item) => item.studentId === users.student.id),
	).toMatchObject({ before: "3.00", after: "5.00" });
	await correctScoring(users.admin.session, correctionTerm, {
		...data,
		action: "commit",
		revision: preview.revision,
		token: "token" in preview ? preview.token : "",
		reason: "确认分值录错，按校方标准更正",
	});
	const originalPublication = await publish(correctionTerm);
	const original = await db.publishedResult.findUniqueOrThrow({
		where: {
			publicationId_studentId: {
				publicationId: originalPublication.id,
				studentId: users.student.id,
			},
		},
	});
	const term = await db.term.findUniqueOrThrow({
		where: { id: correctionTerm },
	});
	await reopenTerm(users.admin.session, correctionTerm, {
		revision: term.revision,
		reason: "依据正式文件更正模块比例",
	});
	const next = scheme();
	next.nodes[0].kind = "WEIGHTED";
	next.nodes[1].weight = "0.5";
	next.nodes[2].weight = "0.5";
	const rulePreview = await correctScoring(
		users.admin.session,
		correctionTerm,
		{ kind: "scheme", action: "preview", scheme: next },
	);
	expect(
		rulePreview.changes.find((item) => item.studentId === users.student.id),
	).toMatchObject({ before: "5.00", after: "2.50" });
	await correctScoring(users.admin.session, correctionTerm, {
		kind: "scheme",
		action: "commit",
		scheme: next,
		revision: rulePreview.revision,
		token: "token" in rulePreview ? rulePreview.token : "",
		reason: "按正式评分比例更正",
	});
	const nextPublication = await publish(correctionTerm);
	expect(
		(await getStudentResult(users.student.session, correctionTerm)).result
			.total,
	).toBe("2.50");
	expect(
		(
			await db.publishedResult.findUniqueOrThrow({ where: { id: original.id } })
		).payload,
	).toEqual(original.payload);
	expect(nextPublication.id).not.toBe(originalPublication.id);
});

test("FL11：活动参与与历史关联申报互斥，两种审核顺序均拒绝重复计分", async () => {
	const claim = await db.personalClaim.create({
		data: {
			termId,
			studentId: users.student.id,
			title: "活动成果",
			occurredOn: "2026-10-20",
			note: "同活动成果",
			activityId,
			status: "PENDING_COLLEGE",
			score: "3",
			scoreNodeId: "activity",
			scorerId: users.counselor.id,
		},
	});
	await expect(
		changeClaim(users.college.session, termId, claim.id, {
			action: "approve",
			revision: 0,
			reason: "审核同意",
		}),
	).rejects.toThrow("同活动");
	const fact = await db.participation.findUniqueOrThrow({
		where: {
			activityId_studentId: {
				activityId,
				studentId: users.student.id,
			},
		},
		include: { sources: true },
	});
	const approved = fact.sources.find((source) => source.status === "APPROVED")!;
	await changeParticipation(users.publisher.session, termId, {
		id: approved.id,
		revision: approved.revision,
		action: "remove",
		reason: "确认由个人申报渠道认定",
	});
	await changeClaim(users.college.session, termId, claim.id, {
		action: "approve",
		revision: 0,
		reason: "使用申报渠道认定",
	});
	const otherClaim = await db.personalClaim.create({
		data: {
			termId,
			studentId: users.other.id,
			title: "另一活动成果",
			occurredOn: "2026-10-20",
			note: "另一学生已通过申报",
			activityId,
			status: "APPROVED",
			score: "4",
			scoreNodeId: "activity",
			scorerId: users.counselor.id,
		},
	});
	expect(otherClaim.status).toBe("APPROVED");
	const otherParticipation = await db.participation.create({
		data: {
			activityId,
			studentId: users.other.id,
			registeredAt: new Date(),
			registeredBy: users.publisher.id,
		},
	});
	const otherSource = await db.recognitionSource.create({
		data: {
			participationId: otherParticipation.id,
			submitterId: users.publisher.id,
			status: "PENDING_COUNSELOR",
			activityEvidenceId,
			note: "重新核验",
		},
	});
	const counseled = await reviewParticipation(
		users.counselor.session,
		termId,
		{
			id: otherSource.id,
			revision: otherSource.revision,
			action: "counselorApprove",
		},
	);
	await expect(
		reviewParticipation(users.college.session, termId, {
			id: otherSource.id,
			revision: counseled.revision,
			action: "collegeApprove",
			reason: "审核同意",
		}),
	).rejects.toThrow("同活动");
	expect(
		(await getStudentResult(users.student.session, termId)).result.total,
	).toBe("3.00");
});

test("FL12-14：发布预检绑定身份名录，截止后可理由延期，确认不丢失，重开默认保留原名单", async () => {
	const governanceTerm = await newTerm("名录与延期验证");
	const stale = await previewPublication(users.admin.session, governanceTerm);
	await db.studentProfile.update({
		where: { userId: users.other.id },
		data: { className: "转班" },
	});
	await expect(
		publishResults(users.admin.session, governanceTerm, {
			revision: stale.termRevision,
			inputRevision: stale.inputRevision,
			token: stale.token,
			checkingEndsAt: new Date(Date.now() + 60_000).toISOString(),
			requireConfirmation: true,
			requestId: randomUUID(),
		}),
	).rejects.toThrow("预检");
	const publication = await publish(governanceTerm, true);
	const frozen = await getStudentResult(
		users.student.session,
		governanceTerm,
	);
	if (!("resultHash" in frozen)) throw new Error("缺少发布版本");
	const confirmation = await confirmResult(
		users.student.session,
		governanceTerm,
		publication.id,
		frozen.resultHash,
	);
	await db.resultPublication.update({
		where: { id: publication.id },
		data: { checkingEndsAt: new Date(Date.now() - 1000) },
	});
	const otherResult = await getStudentResult(
		users.other.session,
		governanceTerm,
	);
	if (!("resultHash" in otherResult)) throw new Error("缺少发布版本");
	await expect(
		confirmResult(
			users.other.session,
			governanceTerm,
			publication.id,
			otherResult.resultHash,
		),
	).rejects.toThrow("结束");
	let term = await db.term.findUniqueOrThrow({
		where: { id: governanceTerm },
	});
	const original = await db.resultPublication.findUniqueOrThrow({
		where: { id: publication.id },
	});
	await extendChecking(users.admin.session, governanceTerm, {
		revision: term.revision,
		publicationId: publication.id,
		checkingEndsAt: new Date(Date.now() + 60_000).toISOString(),
		reason: "为尚未核对学生延长核对期限",
	});
	expect(
		(
			await db.resultPublication.findUniqueOrThrow({
				where: { id: publication.id },
			})
		).checkingEndsAt,
	).toEqual(original.checkingEndsAt);
	expect(
		(
			await confirmResult(
				users.student.session,
				governanceTerm,
				publication.id,
				frozen.resultHash,
			)
		).id,
	).toBe(confirmation.id);
	await confirmResult(
		users.other.session,
		governanceTerm,
		publication.id,
		otherResult.resultHash,
	);
	expect(
		(await previewSettlement(users.admin.session, governanceTerm)).blockers.map(
			(item) => item.type,
		),
	).not.toContain("STALE");
	term = await db.term.findUniqueOrThrow({ where: { id: governanceTerm } });
	await reopenTerm(users.admin.session, governanceTerm, {
		revision: term.revision,
		reason: "修正已发布结果的原始输入",
	});
	await db.user.update({
		where: { id: users.other.id },
		data: { disabled: true },
	});
	const lateLogin = `${marker}-late`;
	const late = await db.user.create({
		data: {
			login: lateLogin,
			name: "新加入学生",
			role: "STUDENT",
			passwordHash: "unused",
			mustChangePassword: false,
			studentProfile: {
				create: { studentNumber: lateLogin, ...profile },
			},
		},
	});
	users.late = { id: late.id, login: lateLogin, session: "" };
	const previous = await previewPublication(
		users.admin.session,
		governanceTerm,
	);
	expect(previous.cohortPolicy).toBe("PREVIOUS");
	expect(previous.studentCount).toBe(publication.studentCount);
	expect(previous.cohortChanges.added.map((item) => item.studentId)).toContain(
		late.id,
	);
	expect(
		previous.cohortChanges.removed.map((item) => item.studentId),
	).toContain(users.other.id);
	expect(
		(
			await pageResultStudents(users.admin.session, governanceTerm, {
				q: users.other.login,
			})
		).total,
	).toBe(1);
	await saveGrade(users.admin.session, governanceTerm, {
		studentLogin: users.other.login,
		nodeId: "grade",
		value: "40",
		revision: null,
		reason: "原名录停用账号按原始成绩更正",
	});
	expect(
		(
			await listGrades(
				users.admin.session,
				governanceTerm,
				users.other.login,
			)
		).inputs[0].value,
	).toBe("40");
	const next = await publish(governanceTerm);
	expect(
		(
			await db.publishedResult.findUniqueOrThrow({
				where: {
					publicationId_studentId: {
						publicationId: next.id,
						studentId: users.other.id,
					},
				},
			})
		).total.toFixed(2),
	).toBe("40.00");
	term = await db.term.findUniqueOrThrow({ where: { id: governanceTerm } });
	await reopenTerm(users.admin.session, governanceTerm, {
		revision: term.revision,
		reason: "经批准调整参评范围",
	});
	term = await db.term.findUniqueOrThrow({ where: { id: governanceTerm } });
	await setPublicationCohort(users.admin.session, governanceTerm, {
		revision: term.revision,
		policy: "CURRENT",
		reason: "本轮采用当前有效学生名录",
	});
	const current = await previewPublication(users.admin.session, governanceTerm);
	expect(current.cohortPolicy).toBe("CURRENT");
	await publish(governanceTerm);
	const selected = await db.term.findUniqueOrThrow({
		where: { id: governanceTerm },
	});
	expect(
		await db.publishedResult.count({
			where: {
				publicationId: selected.publishedResultSetId!,
				studentId: late.id,
			},
		}),
	).toBe(1);
	expect(
		await db.publishedResult.count({
			where: {
				publicationId: selected.publishedResultSetId!,
				studentId: users.other.id,
			},
		}),
	).toBe(0);
	await db.user.update({
		where: { id: users.other.id },
		data: { disabled: false },
	});
});

test("FL15-16：成绩与扣分提供真实修改历史及隔离权限，发布阻断分类计数", async () => {
	const grade = await saveGrade(users.admin.session, termId, {
		studentLogin: users.student.login,
		nodeId: "grade",
		value: "20",
		revision: null,
		reason: "原始成绩单",
	});
	await saveGrade(users.admin.session, termId, {
		studentLogin: users.student.login,
		nodeId: "grade",
		value: "30",
		revision: 0,
		reason: "更正成绩单",
	});
	const history = await inputHistory(users.student.session, {
		termId,
		kind: "grade",
		id: grade.id,
	});
	expect(history.total).toBe(2);
	expect(history.items[0].reason).toBe("更正成绩单");
	const importPreview = await previewGradeImport(users.admin.session, termId, {
		nodeId: "grade",
		rows: [{
			login: users.student.login,
			name: "student",
			college: profile.college,
			major: profile.major,
			className: profile.className,
			value: "35",
		}],
		reason: "导入正式更正成绩",
	});
	await commitGradeImport(users.admin.session, termId, importPreview.id);
	const importedHistory = await inputHistory(users.student.session, {
		termId,
		kind: "grade",
		id: grade.id,
	});
	expect(importedHistory.total).toBe(3);
	expect(importedHistory.items[0]).toMatchObject({
		action: "GRADE_IMPORTED",
		before: "30",
		after: "35",
		reason: "导入正式更正成绩",
	});
	await expect(
		inputHistory(users.other.session, {
			termId,
			kind: "grade",
			id: grade.id,
		}),
	).rejects.toThrow();
	const deduction = await saveDeduction(users.admin.session, termId, {
		studentLogin: users.student.login,
		projectId: "discipline",
		amount: "2",
		revision: null,
		reason: "纪律决定",
	});
	await saveDeduction(users.admin.session, termId, {
		studentLogin: users.student.login,
		projectId: "discipline",
		amount: "2",
		revision: 0,
		revoked: true,
		reason: "撤销处理决定",
	});
	expect(
		(
			await inputHistory(users.admin.session, {
				termId,
				kind: "deduction",
				id: deduction.id,
			})
		).total,
	).toBe(2);
	const source = await db.recognitionSource.create({
		data: {
			participationId: (
				await db.participation.findUniqueOrThrow({
					where: {
						activityId_studentId: {
							activityId,
							studentId: users.other.id,
						},
					},
				})
			).id,
			submitterId: users.publisher.id,
			status: "RETURNED",
			note: "待补充记录测试",
			reviewReason: "待补充材料",
		},
	});
	const p = await previewPublication(users.admin.session, termId);
	expect(p.reviewBreakdown.recognitionsNeedsChanges).toBe(1);
	expect(p.canPublish).toBe(false);
	expect(
		(await previewSettlement(users.admin.session, termId)).reviewBreakdown
			.recognitionsNeedsChanges,
	).toBe(1);
	await db.recognitionSource.update({
		where: { id: source.id },
		data: { status: "WITHDRAWN" },
	});
});

test("FL17：超过200条活动和来源仍可完整分页且不泄露他人记录", async () => {
	const bulk = await newTerm("分页容量回归");
	await db.activity.createMany({
		data: Array.from({ length: 205 }, (_, index) => ({
			termId: bulk,
			ownerId: users.publisher.id,
			collegeId: orgCollegeId,
			name: `分页活动${index}`,
			organizer: "组织",
			content: "内容",
			startsAt: new Date(Date.now() - 1000),
			endsAt: new Date(Date.now() + 86_400_000),
			nodeId: "activity",
			points: "1",
			confirmed: true,
			publishedAt: new Date(),
			audienceScope: "CLASS",
			audienceColleges: [],
			audienceClasses: [classKey(profile)],
		})),
	});
	const activities = await db.activity.findMany({
		where: { termId: bulk },
		select: { id: true },
	});
	for (const item of activities)
		await db.participation.create({
			data: {
				activityId: item.id,
				studentId: users.student.id,
				registeredAt: new Date(),
				registeredBy: users.publisher.id,
				sources: {
					create: {
						submitterId: users.publisher.id,
						origin: "IMPORT",
						note: "名单来源",
					},
				},
			},
		});
	expect((await pageActivities(users.publisher.session, bulk)).total).toBe(205);
	expect(
		(await pageActivities(users.student.session, bulk, "", 11)).items,
	).toHaveLength(5);
	expect(
		(await pageActivityFeed(users.student.session, bulk, "", 11)).items,
	).toHaveLength(5);
	expect(
		(await listRecognitions(users.student.session, bulk, 11)).items,
	).toHaveLength(5);
	expect((await listRecognitions(users.other.session, bulk)).total).toBe(0);
});
