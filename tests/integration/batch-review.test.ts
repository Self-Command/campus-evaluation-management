import { afterAll, beforeAll, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { db } from "@/server/db";
import { organizationFixture } from "./organization-fixture";
import { uploadEvidence } from "@/server/evidence";
import { createTerm, saveScheme, activateTerm } from "@/server/terms";
import { nodeSchema } from "@/lib/scoring/types";
import { getStudentResult } from "@/server/results";
import {
	parseBatchBody,
	runBatch,
	type BatchItem,
	type BatchResponse,
} from "@/server/batch-review";
import type { BatchContext } from "@/server/batch-context";
import type { AuditAction } from "@/server/audit-actions";
import { reviewParticipation } from "@/server/recognitions";
import { submitClaim, changeClaim, jsonValue } from "@/server/claims";
import { submitGradeChange, changeGradeChange } from "@/server/grade-changes";
import {
	submitDeductionChange,
	changeDeductionChange,
} from "@/server/deduction-changes";
import { changeAppeal } from "@/server/appeals";

const address = new URL(process.env.DATABASE_URL!);
if (
	address.hostname !== "127.0.0.1" ||
	!/^\/campus_test_[a-f0-9]{12}$/.test(address.pathname)
)
	throw new Error("必须由隔离运行器执行");
const marker = `batch-${randomUUID().slice(0, 8)}`;
const png = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=",
	"base64",
);
const users: Record<string, { id: string; session: string }> = {};
const collegeIds: string[] = [];
const classIds: string[] = [];
let termId = "";
let directory = "";
let organizationA: Awaited<ReturnType<typeof organizationFixture>>;
let organizationB: Awaited<ReturnType<typeof organizationFixture>>;
let activityId = "";
let activityEvidenceId = "";
let sharedEvidenceId = "";
let evidenceA = "";
let evidenceB = "";

async function identity(
	label: string,
	role: "ADMIN" | "COLLEGE" | "STUDENT",
	options: {
		collegeId?: string;
		classId?: string;
		organization?: Awaited<ReturnType<typeof organizationFixture>>;
	} = {},
) {
	const user = await db.user.create({
		data: {
			login: `${marker}-${label}`,
			name: label,
			role,
			collegeId: options.collegeId,
			passwordHash: "fixture-only",
			mustChangePassword: false,
			...(role === "STUDENT" && options.organization
				? {
						studentProfile: {
							create: {
								studentNumber: `${marker}-${label}`,
								college: options.organization.college.name,
								major: options.organization.major.name,
								className: options.organization.schoolClass.name,
								classId: options.classId,
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
	};
	return users[label];
}

async function runDomainBatch({
	sessionId,
	action,
	reason,
	items,
	actionSchema,
	reasonRequired,
	auditAction,
	execute,
}: {
	sessionId: string;
	action: string;
	reason?: string;
	items: BatchItem[];
	actionSchema: z.ZodTypeAny;
	reasonRequired: readonly string[];
	auditAction: AuditAction;
	execute: (
		request: { action: string; reason?: string; batchId: string },
		item: BatchItem,
		context: BatchContext,
	) => Promise<{ revision: number; status?: string }>;
}) {
	const data = parseBatchBody(
		{
			termId,
			batchId: randomUUID(),
			action,
			...(reason === undefined ? {} : { reason }),
			items,
		},
		actionSchema,
		reasonRequired,
	) as {
		action: string;
		reason?: string;
		batchId: string;
		items: BatchItem[];
	};
	const response = await runBatch({
		sessionId,
		termId,
		action: data.action,
		batchId: data.batchId,
		items: data.items,
		auditAction,
		execute: (item, context) => execute(data, item, context),
	});
	return { batchId: data.batchId, response };
}

function itemResult(response: BatchResponse, id: string) {
	return response.results.find((item) => item.id === id)!;
}

async function historyBatchId(id: string, type: "recognition" | "claim" | "grade" | "deduction") {
	const row =
		type === "recognition"
			? await db.recognitionSource.findUniqueOrThrow({ where: { id } })
			: type === "claim"
				? await db.personalClaim.findUniqueOrThrow({ where: { id } })
				: type === "grade"
					? await db.gradeChange.findUniqueOrThrow({ where: { id } })
					: await db.deductionChange.findUniqueOrThrow({ where: { id } });
	const history = Array.isArray(row.history) ? row.history : [];
	const last = history[history.length - 1] as {
		batchId?: string;
		batchIndex?: number;
	} | undefined;
	return last;
}

beforeAll(async () => {
	directory = await mkdtemp(join(tmpdir(), "campus-batch-review-"));
	process.env.EVIDENCE_DIR = directory;
	organizationA = await organizationFixture(`${marker}-a`, {
		college: "经济学院",
		major: "经济学",
		className: "经济一班",
	});
	organizationB = await organizationFixture(`${marker}-b`, {
		college: "法学院",
		major: "法学",
		className: "法学一班",
	});
	collegeIds.push(organizationA.college.id, organizationB.college.id);
	classIds.push(organizationA.schoolClass.id, organizationB.schoolClass.id);
	for (const [label, organization] of [
		["counselor-a", organizationA],
		["counselor-b", organizationB],
	] as const)
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
		};
	await identity("admin", "ADMIN");
	await identity("college-a", "COLLEGE", {
		collegeId: organizationA.college.id,
	});
	await identity("college-b", "COLLEGE", {
		collegeId: organizationB.college.id,
	});
	await identity("student-a1", "STUDENT", {
		classId: organizationA.schoolClass.id,
		organization: organizationA,
	});
	await identity("student-a2", "STUDENT", {
		classId: organizationA.schoolClass.id,
		organization: organizationA,
	});
	await identity("student-b1", "STUDENT", {
		classId: organizationB.schoolClass.id,
		organization: organizationB,
	});
	termId = (
		await createTerm(users.admin.session, {
			name: `${marker}-周期`,
			template: false,
		})
	).id;
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
					required: true,
					maximum: "100",
					order: 0,
				}),
				nodeSchema.parse({
					id: "activity",
					parentId: "total",
					name: "个人成果",
					kind: "ACTIVITY",
					order: 1,
				}),
			],
			deductions: [
				{ id: "discipline", name: "纪律扣分", nodeId: "total", coefficient: "1" },
			],
		},
	});
	await activateTerm(users.admin.session, termId, { revision: 1 });
	sharedEvidenceId = (
		await uploadEvidence(users.admin.session, "活动签到名单.png", png)
	).id;
	evidenceA = (
		await uploadEvidence(users["student-a1"].session, "本人成果.png", png)
	).id;
	evidenceB = (
		await uploadEvidence(users["student-b1"].session, "本人成果.png", png)
	).id;
	const activity = await db.activity.create({
		data: {
			termId,
			ownerId: users.admin.id,
			collegeId: organizationA.college.id,
			name: `${marker}-批量审核活动`,
			organizer: "经济学院",
			content: "用于验证活动参与批量审核",
			startsAt: new Date(),
			endsAt: new Date(),
			nodeId: "activity",
			points: "5",
			publishedAt: new Date(),
			rosterCommittedAt: new Date(),
		},
	});
	activityId = activity.id;
	activityEvidenceId = (
		await db.activityEvidence.create({
			data: {
				activityId,
				evidenceId: sharedEvidenceId,
				version: 1,
				uploadedBy: users.admin.id,
				note: "活动签到表与现场照片",
			},
		})
	).id;
});

afterAll(async () => {
	if (termId) {
		await db.resultAppeal.deleteMany({ where: { termId } });
		await db.publishedResult.deleteMany({
			where: { publication: { termId } },
		});
		await db.resultPublication.deleteMany({ where: { termId } });
		await db.claimEvidence.deleteMany({ where: { claim: { termId } } });
		await db.personalClaim.deleteMany({ where: { termId } });
		await db.evidenceReference.deleteMany({
			where: { source: { participation: { activity: { termId } } } },
		});
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
		await db.gradeChange.deleteMany({ where: { termId } });
		await db.deductionChange.deleteMany({ where: { termId } });
		await db.gradeInput.deleteMany({ where: { termId } });
		await db.deductionInput.deleteMany({ where: { termId } });
		await db.gradeImport.deleteMany({ where: { termId } });
		await db.term.deleteMany({ where: { id: termId } });
	}
	const ids = Object.values(users).map((user) => user.id);
	await db.auditEvent.deleteMany({ where: { actorId: { in: ids } } });
	await db.evidence.deleteMany({ where: { ownerId: { in: ids } } });
	await db.schoolClass.updateMany({
		where: { id: { in: classIds } },
		data: { counselorId: null },
	});
	await db.user.deleteMany({ where: { id: { in: ids } } });
	await db.schoolClass.deleteMany({ where: { id: { in: classIds } } });
	await db.major.deleteMany({ where: { collegeId: { in: collegeIds } } });
	await db.college.deleteMany({ where: { id: { in: collegeIds } } });
	if (directory && directory.startsWith(join(tmpdir(), "campus-batch-review-")))
		await rm(directory, { recursive: true, force: true });
	delete process.env.EVIDENCE_DIR;
	await db.$disconnect();
});

test("BATCH-01：批量请求契约限制条数、去重、动作与必填理由", () => {
	const actionSchema = z.enum(["counselorApprove", "counselorReturn"]);
	const valid = {
		termId,
		batchId: randomUUID(),
		action: "counselorApprove",
		items: [{ id: "source-a", revision: 0 }],
	};
	expect(() =>
		parseBatchBody(
			{
				...valid,
				items: Array.from({ length: 101 }, (_, index) => ({
					id: `source-${index}`,
					revision: 0,
				})),
			},
			actionSchema,
			["counselorReturn"],
		),
	).toThrow();
	expect(() =>
		parseBatchBody(
			{
				...valid,
				items: [
					{ id: "source-a", revision: 0 },
					{ id: "source-a", revision: 1 },
				],
			},
			actionSchema,
			["counselorReturn"],
		),
	).toThrow("批量记录不能重复");
	expect(() =>
		parseBatchBody(
			{ ...valid, action: "counselorReturn" },
			actionSchema,
			["counselorReturn"],
		),
	).toThrow("请填写操作理由");
	expect(() =>
		parseBatchBody(
			{ ...valid, action: "collegeApprove" },
			actionSchema,
			["counselorReturn"],
		),
	).toThrow();
	expect(() =>
		parseBatchBody({ ...valid, reason: "短" }, actionSchema, []),
	).toThrow();
	expect(() =>
		parseBatchBody({ ...valid, forged: true }, actionSchema, []),
	).toThrow();
	const parsed = parseBatchBody(
		{ ...valid, reason: "  统一退回补充材料  " },
		actionSchema,
		[],
	);
	expect(parsed.reason).toBe("统一退回补充材料");
});

test("BATCH-02：活动参与批量初审/终审部分成功，跨范围逐条失败并写入批次审计", async () => {
	const source = async (studentId: string) => {
		const participation = await db.participation.create({
			data: {
				activityId,
				studentId,
				registeredAt: new Date(),
				sources: {
					create: {
						submitterId: users.admin.id,
						activityEvidenceId,
						note: "批量审核测试名单",
						status: "PENDING_COUNSELOR",
					},
				},
			},
			include: { sources: true },
		});
		return participation.sources[0];
	};
	const a1 = await source(users["student-a1"].id);
	const a2 = await source(users["student-a2"].id);
	const b1 = await source(users["student-b1"].id);
	const first = await runDomainBatch({
		sessionId: users["counselor-a"].session,
		action: "counselorApprove",
		items: [
			{ id: a1.id, revision: 0 },
			{ id: a2.id, revision: 9 },
			{ id: b1.id, revision: 0 },
		],
		actionSchema: z.enum([
			"counselorApprove",
			"counselorReturn",
			"collegeApprove",
			"collegeReturn",
			"revoke",
		]),
		reasonRequired: ["counselorReturn", "collegeReturn", "revoke"],
		auditAction: "PARTICIPATION_BATCH_REVIEWED",
		execute: async (request, item, context) => {
			const saved = await reviewParticipation(
				users["counselor-a"].session,
				termId,
				{
					id: item.id,
					revision: item.revision,
					action: request.action,
					reason: request.reason,
				},
				context,
			);
			return { revision: saved.revision, status: saved.status };
		},
	});
	expect(first.response.succeeded).toBe(1);
	expect(first.response.failed).toBe(2);
	expect(first.response.notExecuted).toBe(0);
	expect(itemResult(first.response, a1.id).status).toBe("PENDING_COLLEGE");
	expect(itemResult(first.response, a2.id).statusCode).toBe(409);
	expect(itemResult(first.response, a2.id).message).toContain("已变化");
	expect(itemResult(first.response, b1.id).statusCode).toBe(404);
	expect(
		(await db.recognitionSource.findUniqueOrThrow({ where: { id: a1.id } }))
			.status,
	).toBe("PENDING_COLLEGE");
	expect(
		(await db.recognitionSource.findUniqueOrThrow({ where: { id: a2.id } }))
			.status,
	).toBe("PENDING_COUNSELOR");
	expect(
		(await db.recognitionSource.findUniqueOrThrow({ where: { id: b1.id } }))
			.status,
	).toBe("PENDING_COUNSELOR");
	const a1History = await historyBatchId(a1.id, "recognition");
	expect(a1History?.batchId).toBe(first.batchId);
	expect(a1History?.batchIndex).toBe(1);
	const audit = await db.auditEvent.findFirst({
		where: {
			action: "PARTICIPATION_BATCH_REVIEWED",
			targetId: first.batchId,
		},
	});
	expect(audit?.result).toBe("PARTIAL");
	expect(audit?.details).toMatchObject({
		requested: 3,
		succeeded: 1,
		failed: 2,
		notExecuted: 0,
	});
	const second = await runDomainBatch({
		sessionId: users["counselor-a"].session,
		action: "counselorApprove",
		items: [{ id: a2.id, revision: 0 }],
		actionSchema: z.enum([
			"counselorApprove",
			"counselorReturn",
			"collegeApprove",
			"collegeReturn",
			"revoke",
		]),
		reasonRequired: ["counselorReturn", "collegeReturn", "revoke"],
		auditAction: "PARTICIPATION_BATCH_REVIEWED",
		execute: async (request, item, context) => {
			const saved = await reviewParticipation(
				users["counselor-a"].session,
				termId,
				{
					id: item.id,
					revision: item.revision,
					action: request.action,
					reason: request.reason,
				},
				context,
			);
			return { revision: saved.revision, status: saved.status };
		},
	});
	expect(second.response.succeeded).toBe(1);
	const final = await runDomainBatch({
		sessionId: users["college-a"].session,
		action: "collegeApprove",
		items: [
			{ id: a1.id, revision: 1 },
			{ id: a2.id, revision: 1 },
			{ id: b1.id, revision: 0 },
		],
		actionSchema: z.enum([
			"counselorApprove",
			"counselorReturn",
			"collegeApprove",
			"collegeReturn",
			"revoke",
		]),
		reasonRequired: ["counselorReturn", "collegeReturn", "revoke"],
		auditAction: "PARTICIPATION_BATCH_REVIEWED",
		execute: async (request, item, context) => {
			const saved = await reviewParticipation(
				users["college-a"].session,
				termId,
				{
					id: item.id,
					revision: item.revision,
					action: request.action,
					reason: request.reason,
				},
				context,
			);
			return { revision: saved.revision, status: saved.status };
		},
	});
	expect(final.response.succeeded).toBe(2);
	expect(final.response.failed).toBe(1);
	expect(itemResult(final.response, b1.id).statusCode).toBe(404);
	expect(
		(await db.recognitionSource.findUniqueOrThrow({ where: { id: a1.id } }))
			.status,
	).toBe("APPROVED");
	expect(
		(await db.recognitionSource.findUniqueOrThrow({ where: { id: a2.id } }))
			.status,
	).toBe("APPROVED");
	expect(
		await db.recognitionSource.count({
			where: { participation: { activityId }, status: "APPROVED" },
		}),
	).toBe(2);
	expect(
		(await db.recognitionSource.findUniqueOrThrow({ where: { id: b1.id } }))
			.status,
	).toBe("PENDING_COUNSELOR");
});

test("BATCH-03：成果申报批量退回、终审与撤销部分成功，跨班级逐条失败", async () => {
	const evidenceB2 = (
		await uploadEvidence(users["student-a2"].session, "本人成果.png", png)
	).id;
	const submission = (
		student: { session: string },
		title: string,
		evidenceId: string,
	) =>
		submitClaim(student.session, termId, {
			title,
			occurredOn: "2026-10-01",
			note: `${title}的成果说明与本人贡献`,
			evidenceIds: [evidenceId],
		});
	const c1 = await submission(users["student-a1"], "批量申报一", evidenceA);
	const c2 = await submission(users["student-a1"], "批量申报二", evidenceA);
	const c3 = await submission(users["student-a2"], "批量申报三", evidenceB2);
	const c4 = await submission(users["student-b1"], "跨班申报", evidenceB);
	const claimsSchema = z.enum(["approve", "return", "rescore", "revoke"]);
	const returned = await runDomainBatch({
		sessionId: users["counselor-a"].session,
		action: "return",
		reason: "请补充成果时间与本人分工",
		items: [
			{ id: c2.id, revision: 0 },
			{ id: c4.id, revision: 0 },
		],
		actionSchema: claimsSchema,
		reasonRequired: ["return", "rescore", "revoke"],
		auditAction: "CLAIM_BATCH_CHANGED",
		execute: async (request, item, context) => {
			const saved = await changeClaim(
				users["counselor-a"].session,
				termId,
				item.id,
				{
					revision: item.revision,
					action: request.action,
					reason: request.reason,
				},
				context,
			);
			return { revision: saved.revision, status: saved.status };
		},
	});
	expect(returned.response.succeeded).toBe(1);
	expect(itemResult(returned.response, c4.id).statusCode).toBe(403);
	expect(
		(await db.personalClaim.findUniqueOrThrow({ where: { id: c2.id } }))
			.status,
	).toBe("RETURNED");
	expect((await historyBatchId(c2.id, "claim"))?.batchId).toBe(
		returned.batchId,
	);
	await changeClaim(users["counselor-a"].session, termId, c1.id, {
		revision: 0,
		action: "submitScore",
		nodeId: "activity",
		score: "3",
	});
	await changeClaim(users["counselor-a"].session, termId, c3.id, {
		revision: 0,
		action: "submitScore",
		nodeId: "activity",
		score: "4",
	});
	const approved = await runDomainBatch({
		sessionId: users["college-a"].session,
		action: "approve",
		items: [
			{ id: c1.id, revision: 1 },
			{ id: c3.id, revision: 0 },
			{ id: c2.id, revision: 1 },
		],
		actionSchema: claimsSchema,
		reasonRequired: ["return", "rescore", "revoke"],
		auditAction: "CLAIM_BATCH_CHANGED",
		execute: async (request, item, context) => {
			const saved = await changeClaim(
				users["college-a"].session,
				termId,
				item.id,
				{
					revision: item.revision,
					action: request.action,
					reason: request.reason,
				},
				context,
			);
			return { revision: saved.revision, status: saved.status };
		},
	});
	expect(approved.response.succeeded).toBe(1);
	expect(approved.response.failed).toBe(2);
	expect(itemResult(approved.response, c3.id).statusCode).toBe(409);
	expect(itemResult(approved.response, c2.id).message).toContain("仅待学院");
	expect(
		(await db.personalClaim.findUniqueOrThrow({ where: { id: c1.id } }))
			.status,
	).toBe("APPROVED");
	const retry = await runDomainBatch({
		sessionId: users["college-a"].session,
		action: "approve",
		items: [{ id: c3.id, revision: 1 }],
		actionSchema: claimsSchema,
		reasonRequired: ["return", "rescore", "revoke"],
		auditAction: "CLAIM_BATCH_CHANGED",
		execute: async (request, item, context) => {
			const saved = await changeClaim(
				users["college-a"].session,
				termId,
				item.id,
				{
					revision: item.revision,
					action: request.action,
					reason: request.reason,
				},
				context,
			);
			return { revision: saved.revision, status: saved.status };
		},
	});
	expect(retry.response.succeeded).toBe(1);
	expect(
		(await getStudentResult(users["student-a1"].session, termId)).claims,
	).toHaveLength(1);
	const revoked = await runDomainBatch({
		sessionId: users.admin.session,
		action: "revoke",
		reason: "批量撤销重复成果",
		items: [
			{ id: c1.id, revision: 2 },
			{ id: c3.id, revision: 2 },
		],
		actionSchema: claimsSchema,
		reasonRequired: ["return", "rescore", "revoke"],
		auditAction: "CLAIM_BATCH_CHANGED",
		execute: async (request, item, context) => {
			const saved = await changeClaim(
				users.admin.session,
				termId,
				item.id,
				{
					revision: item.revision,
					action: request.action,
					reason: request.reason,
				},
				context,
			);
			return { revision: saved.revision, status: saved.status };
		},
	});
	expect(revoked.response.succeeded).toBe(2);
	expect(
		(await db.personalClaim.findUniqueOrThrow({ where: { id: c1.id } }))
			.status,
	).toBe("REVOKED");
	expect(
		(await db.personalClaim.findUniqueOrThrow({ where: { id: c3.id } }))
			.status,
	).toBe("REVOKED");
	expect((await historyBatchId(c3.id, "claim"))?.batchId).toBe(
		revoked.batchId,
	);
	expect(
		await db.auditEvent.count({
			where: { action: "CLAIM_BATCH_CHANGED", targetId: revoked.batchId },
		}),
	).toBe(1);
});

test("BATCH-04：成绩与扣分批量审核、退回、放弃和阶段校验，部分成功不互相回滚", async () => {
	const grade = (studentId: string, value: string) => ({
		studentId,
		nodeId: "grade",
		value,
		reason: "核对原始成绩单后更正",
		requestId: randomUUID(),
	});
	const gradeSchema = z.enum(["approve", "return", "resubmit", "abandon"]);
	const g1 = await submitGradeChange(
		users["counselor-a"].session,
		termId,
		grade(users["student-a1"].id, "80"),
	);
	const g2 = await submitGradeChange(
		users["counselor-a"].session,
		termId,
		grade(users["student-a2"].id, "82"),
	);
	const gb = await submitGradeChange(
		users["counselor-b"].session,
		termId,
		grade(users["student-b1"].id, "90"),
	);
	const gradeExecute = async (
		sessionId: string,
		request: { action: string; reason?: string },
		item: BatchItem,
		context: BatchContext,
	) => {
		const saved = await changeGradeChange(
			sessionId,
			termId,
			item.id,
			{
				revision: item.revision,
				action: request.action,
				reason: request.reason,
			},
			context,
		);
		return { revision: saved.revision, status: saved.status };
	};
	const first = await runDomainBatch({
		sessionId: users["college-a"].session,
		action: "approve",
		items: [
			{ id: g1.id, revision: 0 },
			{ id: g2.id, revision: 9 },
			{ id: gb.id, revision: 0 },
		],
		actionSchema: gradeSchema,
		reasonRequired: ["return"],
		auditAction: "GRADE_BATCH_CHANGED",
		execute: (request, item, context) =>
			gradeExecute(users["college-a"].session, request, item, context),
	});
	expect(first.response.succeeded).toBe(1);
	expect(first.response.failed).toBe(2);
	expect(itemResult(first.response, g2.id).statusCode).toBe(409);
	expect(itemResult(first.response, gb.id).statusCode).toBe(403);
	expect(
		(await db.gradeInput.findUniqueOrThrow({
			where: {
				termId_studentId_nodeId: {
					termId,
					studentId: users["student-a1"].id,
					nodeId: "grade",
				},
			},
		})).value.toFixed(),
	).toBe("80");
	const second = await runDomainBatch({
		sessionId: users["college-a"].session,
		action: "approve",
		items: [
			{ id: g2.id, revision: 0 },
			{ id: gb.id, revision: 0 },
		],
		actionSchema: gradeSchema,
		reasonRequired: ["return"],
		auditAction: "GRADE_BATCH_CHANGED",
		execute: (request, item, context) =>
			gradeExecute(users["college-a"].session, request, item, context),
	});
	expect(second.response.succeeded).toBe(1);
	expect(second.response.failed).toBe(1);
	const returnedGrades = await runDomainBatch({
		sessionId: users["college-a"].session,
		action: "return",
		reason: "请附原始成绩单截图",
		items: [
			{ id: g1.id, revision: 1 },
			{ id: g2.id, revision: 1 },
		],
		actionSchema: gradeSchema,
		reasonRequired: ["return"],
		auditAction: "GRADE_BATCH_CHANGED",
		execute: (request, item, context) =>
			gradeExecute(users["college-a"].session, request, item, context),
	});
	expect(returnedGrades.response.succeeded).toBe(0);
	expect(returnedGrades.response.failed).toBe(2);
	expect(
		(await db.gradeChange.findUniqueOrThrow({ where: { id: g1.id } }))
			.status,
	).toBe("APPROVED");
	const g3 = await submitGradeChange(
		users["counselor-a"].session,
		termId,
		grade(users["student-a1"].id, "85"),
	);
	const g4 = await submitGradeChange(
		users["counselor-a"].session,
		termId,
		grade(users["student-a2"].id, "86"),
	);
	const returnedFresh = await runDomainBatch({
		sessionId: users["college-a"].session,
		action: "return",
		reason: "请附原始成绩单截图",
		items: [
			{ id: g3.id, revision: 0 },
			{ id: g4.id, revision: 0 },
		],
		actionSchema: gradeSchema,
		reasonRequired: ["return"],
		auditAction: "GRADE_BATCH_CHANGED",
		execute: (request, item, context) =>
			gradeExecute(users["college-a"].session, request, item, context),
	});
	expect(returnedFresh.response.succeeded).toBe(2);
	const abandoned = await runDomainBatch({
		sessionId: users["counselor-a"].session,
		action: "abandon",
		items: [
			{ id: g3.id, revision: 1 },
			{ id: g4.id, revision: 1 },
		],
		actionSchema: gradeSchema,
		reasonRequired: ["return"],
		auditAction: "GRADE_BATCH_CHANGED",
		execute: (request, item, context) =>
			gradeExecute(users["counselor-a"].session, request, item, context),
	});
	expect(abandoned.response.succeeded).toBe(2);
	expect((await historyBatchId(g3.id, "grade"))?.batchId).toBe(
		abandoned.batchId,
	);
	const g5 = await submitGradeChange(
		users["counselor-a"].session,
		termId,
		grade(users["student-a1"].id, "88"),
	);
	await db.term.update({ where: { id: termId }, data: { phase: "CHECKING" } });
	const blocked = await runDomainBatch({
		sessionId: users["college-a"].session,
		action: "approve",
		items: [{ id: g5.id, revision: 0 }],
		actionSchema: gradeSchema,
		reasonRequired: ["return"],
		auditAction: "GRADE_BATCH_CHANGED",
		execute: (request, item, context) =>
			gradeExecute(users["college-a"].session, request, item, context),
	});
	expect(blocked.response.failed).toBe(1);
	expect(itemResult(blocked.response, g5.id).message).toContain(
		"当前学期阶段不允许此操作",
	);
	await db.term.update({ where: { id: termId }, data: { phase: "ACTIVE" } });
	const abandonedBlocked = await runDomainBatch({
		sessionId: users["counselor-a"].session,
		action: "abandon",
		items: [{ id: g5.id, revision: 0 }],
		actionSchema: gradeSchema,
		reasonRequired: ["return"],
		auditAction: "GRADE_BATCH_CHANGED",
		execute: (request, item, context) =>
			gradeExecute(users["counselor-a"].session, request, item, context),
	});
	expect(abandonedBlocked.response.succeeded).toBe(1);
	const deductionSchema = z.enum(["approve", "return", "resubmit", "abandon"]);
	const deduction = (studentId: string, amount: string) => ({
		studentId,
		projectId: "discipline",
		action: "CREATE" as const,
		amount,
		reason: "批量扣分审核测试",
		requestId: randomUUID(),
	});
	const d1 = await submitDeductionChange(
		users["counselor-a"].session,
		termId,
		deduction(users["student-a1"].id, "3"),
	);
	const d2 = await submitDeductionChange(
		users["counselor-a"].session,
		termId,
		deduction(users["student-a1"].id, "2"),
	);
	const d3 = await submitDeductionChange(
		users["counselor-a"].session,
		termId,
		deduction(users["student-a2"].id, "1"),
	);
	const db1 = await submitDeductionChange(
		users["counselor-b"].session,
		termId,
		deduction(users["student-b1"].id, "1"),
	);
	const deductionExecute = async (
		sessionId: string,
		request: { action: string; reason?: string },
		item: BatchItem,
		context: BatchContext,
	) => {
		const saved = await changeDeductionChange(
			sessionId,
			termId,
			item.id,
			{
				revision: item.revision,
				action: request.action,
				reason: request.reason,
			},
			context,
		);
		return { revision: saved.revision, status: saved.status };
	};
	const deductions = await runDomainBatch({
		sessionId: users["college-a"].session,
		action: "approve",
		items: [
			{ id: d1.id, revision: 0 },
			{ id: d2.id, revision: 8 },
			{ id: d3.id, revision: 0 },
			{ id: db1.id, revision: 0 },
		],
		actionSchema: deductionSchema,
		reasonRequired: ["return"],
		auditAction: "DEDUCTION_BATCH_CHANGED",
		execute: (request, item, context) =>
			deductionExecute(users["college-a"].session, request, item, context),
	});
	expect(deductions.response.succeeded).toBe(2);
	expect(deductions.response.failed).toBe(2);
	expect(itemResult(deductions.response, d2.id).statusCode).toBe(409);
	expect(itemResult(deductions.response, db1.id).statusCode).toBe(403);
	const deductionRetry = await runDomainBatch({
		sessionId: users["college-a"].session,
		action: "approve",
		items: [{ id: d2.id, revision: 0 }],
		actionSchema: deductionSchema,
		reasonRequired: ["return"],
		auditAction: "DEDUCTION_BATCH_CHANGED",
		execute: (request, item, context) =>
			deductionExecute(users["college-a"].session, request, item, context),
	});
	expect(deductionRetry.response.succeeded).toBe(1);
	const d4 = await submitDeductionChange(
		users["counselor-a"].session,
		termId,
		deduction(users["student-a2"].id, "2"),
	);
	const deductionReturn = await runDomainBatch({
		sessionId: users["college-a"].session,
		action: "return",
		reason: "请补充违纪事实材料",
		items: [{ id: d4.id, revision: 0 }],
		actionSchema: deductionSchema,
		reasonRequired: ["return"],
		auditAction: "DEDUCTION_BATCH_CHANGED",
		execute: (request, item, context) =>
			deductionExecute(users["college-a"].session, request, item, context),
	});
	expect(deductionReturn.response.succeeded).toBe(1);
	const deductionAbandon = await runDomainBatch({
		sessionId: users["counselor-a"].session,
		action: "abandon",
		items: [{ id: d4.id, revision: 1 }],
		actionSchema: deductionSchema,
		reasonRequired: ["return"],
		auditAction: "DEDUCTION_BATCH_CHANGED",
		execute: (request, item, context) =>
			deductionExecute(users["counselor-a"].session, request, item, context),
	});
	expect(deductionAbandon.response.succeeded).toBe(1);
	expect((await historyBatchId(d4.id, "deduction"))?.batchId).toBe(
		deductionAbandon.batchId,
	);
	expect(
		(await getStudentResult(users["student-a1"].session, termId)).result.total,
	).toBe("75.00");
	expect(
		(await getStudentResult(users["student-a2"].session, termId)).result.total,
	).toBe("81.00");
});

test("BATCH-05：成绩异议批量开始处理仅限管理员，已处理/过期记录逐条失败并校验阶段", async () => {
	const term = await db.term.findUniqueOrThrow({ where: { id: termId } });
	const publication = await db.resultPublication.create({
		data: {
			termId,
			sequence: 1,
			actorId: users.admin.id,
			requestId: randomUUID(),
			requestHash: "a".repeat(64),
			scheme: jsonValue(term.scheme),
			termRevision: term.revision,
			inputRevision: term.inputRevision,
			studentCount: 3,
			checkingEndsAt: new Date(Date.now() + 86_400_000),
			requireConfirmation: false,
		},
	});
	await db.term.update({
		where: { id: termId },
		data: { phase: "CHECKING", publishedResultSetId: publication.id },
	});
	const resultHash = "b".repeat(64);
	for (const [studentId, total] of [
		[users["student-a1"].id, "80"],
		[users["student-a2"].id, "86"],
		[users["student-b1"].id, "90"],
	] as const) {
		const student = await db.user.findUniqueOrThrow({
			where: { id: studentId },
			include: { studentProfile: true },
		});
		await db.publishedResult.create({
			data: {
				publicationId: publication.id,
				studentId,
				login: student.login,
				name: student.name,
				college: student.studentProfile!.college,
				major: student.studentProfile!.major,
				className: student.studentProfile!.className,
				total,
				resultHash,
				payload: {},
			},
		});
	}
	const appeal = (studentId: string, status: "OPEN" | "PROCESSING") =>
		db.resultAppeal.create({
			data: {
				termId,
				publicationId: publication.id,
				studentId,
				resultHash,
				target: "学业成绩",
				reason: "成绩与原始成绩单不一致",
				status,
			},
		});
	const a1 = await appeal(users["student-a1"].id, "OPEN");
	const a2 = await appeal(users["student-a2"].id, "OPEN");
	const processing = await appeal(users["student-b1"].id, "PROCESSING");
	const stale = await appeal(users["student-a1"].id, "OPEN");
	const appealSchema = z.enum(["process"]);
	const appealExecute = async (
		sessionId: string,
		request: { action: string },
		item: BatchItem,
		context: BatchContext,
	) => {
		const saved = await changeAppeal(
			sessionId,
			termId,
			item.id,
			{ revision: item.revision, action: request.action },
			context,
		);
		return { revision: saved.revision, status: saved.status };
	};
	const processed = await runDomainBatch({
		sessionId: users.admin.session,
		action: "process",
		items: [
			{ id: a1.id, revision: 0 },
			{ id: a2.id, revision: 0 },
			{ id: processing.id, revision: 0 },
			{ id: stale.id, revision: 7 },
		],
		actionSchema: appealSchema,
		reasonRequired: [],
		auditAction: "APPEAL_BATCH_CHANGED",
		execute: (request, item, context) =>
			appealExecute(users.admin.session, request, item, context),
	});
	expect(processed.response.succeeded).toBe(2);
	expect(processed.response.failed).toBe(2);
	expect(itemResult(processed.response, processing.id).message).toContain(
		"异议已开始处理",
	);
	expect(itemResult(processed.response, stale.id).message).toContain(
		"异议已变化",
	);
	expect(
		(await db.resultAppeal.findUniqueOrThrow({ where: { id: a1.id } }))
			.status,
	).toBe("PROCESSING");
	expect(
		(await db.resultAppeal.findUniqueOrThrow({ where: { id: a1.id } }))
			.reviewerId,
	).toBe(users.admin.id);
	const audit = await db.auditEvent.findFirst({
		where: { action: "APPEAL_BATCH_CHANGED", targetId: processed.batchId },
	});
	expect(audit?.result).toBe("PARTIAL");
	const studentDenied = await runDomainBatch({
		sessionId: users["student-a1"].session,
		action: "process",
		items: [{ id: stale.id, revision: 0 }],
		actionSchema: appealSchema,
		reasonRequired: [],
		auditAction: "APPEAL_BATCH_CHANGED",
		execute: (request, item, context) =>
			appealExecute(users["student-a1"].session, request, item, context),
	});
	expect(studentDenied.response.failed).toBe(1);
	expect(itemResult(studentDenied.response, stale.id).statusCode).toBe(403);
	await db.term.update({
		where: { id: termId },
		data: { phase: "CONFIGURATION" },
	});
	const blocked = await runDomainBatch({
		sessionId: users.admin.session,
		action: "process",
		items: [{ id: stale.id, revision: 0 }],
		actionSchema: appealSchema,
		reasonRequired: [],
		auditAction: "APPEAL_BATCH_CHANGED",
		execute: (request, item, context) =>
			appealExecute(users.admin.session, request, item, context),
	});
	expect(blocked.response.failed).toBe(1);
	expect(itemResult(blocked.response, stale.id).message).toContain(
		"当前学期阶段不允许此操作",
	);
	await db.term.update({ where: { id: termId }, data: { phase: "CHECKING" } });
});
