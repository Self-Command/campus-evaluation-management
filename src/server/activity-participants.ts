import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { AccountError } from "@/server/accounts";
import { termTransaction } from "@/server/terms";
import {
	assertActivityManager,
	canManageActivity,
} from "@/server/activity-policy";
import { scopedStudentWhere } from "@/server/access-scope";
import { appendHistory, historyEntry, jsonValue } from "@/server/claims";
import { decimalSchema } from "@/lib/scoring/types";
import { Rational } from "@/lib/scoring/rational";

export const registrationData = (
	student: {
		id: string;
		login: string;
		name: string;
		studentProfile: { college: string; major: string; className: string } | null;
	},
	actorId: string,
	batchId?: string,
	score?: string,
) => {
	return {
		registeredAt: new Date(),
		registeredBy: actorId,
		registrationSnapshot: jsonValue({
			studentId: student.id,
			login: student.login,
			name: student.name,
			college: student.studentProfile?.college ?? "",
			major: student.studentProfile?.major ?? "",
			className: student.studentProfile?.className ?? "",
		}),
		importBatchId: batchId ?? null,
		...(score === undefined ? {} : { score }),
	};
};

export async function registerFact(
	tx: Prisma.TransactionClient,
	activityId: string,
	student: Parameters<typeof registrationData>[0],
	actorId: string,
	batchId?: string,
	options: { score?: string } = {},
) {
	const old = await tx.participation.findUnique({
		where: { activityId_studentId: { activityId, studentId: student.id } },
	});
	const registration = registrationData(
		student,
		actorId,
		batchId,
		options.score,
	);
	if (old?.registeredAt && !old.removedAt) return old;
	const entry = historyEntry(
		actorId,
		old?.removedAt ? "PARTICIPATION_RESTORED" : batchId ? "IMPORTED" : "REGISTERED",
		{
			batchId: batchId ?? null,
			student: registration.registrationSnapshot,
			reason: old?.removalReason ?? null,
		},
	);
	return tx.participation.upsert({
		where: { activityId_studentId: { activityId, studentId: student.id } },
		create: {
			activityId,
			studentId: student.id,
			...registration,
			history: jsonValue([entry]),
		},
		update: {
			...registration,
			removedAt: null,
			removedBy: null,
			removalReason: null,
			revision: { increment: 1 },
			history: appendHistory(old?.history ?? [], entry),
		},
	});
}

const statusFilterSchema = z
	.enum([
		"PENDING",
		"PENDING_COUNSELOR",
		"PENDING_COLLEGE",
		"RETURNED",
		"APPROVED",
		"SUPERSEDED",
		"WITHDRAWN",
		"REVOKED",
		"REJECTED",
	])
	.optional();
const removedFilterSchema = z.enum(["active", "removed", "all"]).default("active");
const sourceSelect = {
	id: true,
	status: true,
	origin: true,
	reviewReason: true,
	reviewerId: true,
	reviewedAt: true,
	counselorId: true,
	counseledAt: true,
	collegeReviewerId: true,
	collegeReviewedAt: true,
	returnedByRole: true,
	activityEvidenceId: true,
	note: true,
	revision: true,
	history: true,
	createdAt: true,
	evidence: {
		select: {
			evidence: { select: { id: true, name: true, mime: true, size: true } },
		},
	},
} as const;

export async function pageActivityParticipants(
	sessionId: string,
	termId: string,
	activityId: string,
	page = 1,
	query = "",
	options: { status?: string; removed?: string } = {},
) {
	const safePage = z.number().int().min(1).max(100000).parse(page);
	const status = statusFilterSchema.parse(options.status || undefined);
	const removed = removedFilterSchema.parse(options.removed || undefined);
	return termTransaction(
		sessionId,
		termId,
		["ADMIN", "COLLEGE", "COUNSELOR", "PUBLISHER"],
		["CONFIGURATION", "ACTIVE", "CHECKING", "LOCKED"],
		async (tx, _term, actorId) => {
			const activity = await tx.activity.findUnique({
				where: { id: activityId },
				include: { college: { select: { id: true, name: true, code: true } } },
			});
			const actor = await tx.user.findUniqueOrThrow({
				where: { id: actorId },
				include: { studentProfile: true, college: true },
			});
			if (!activity || activity.termId !== termId)
				throw new AccountError("活动不存在或无权查看", 404);
			const canManage = canManageActivity(activity, actor);
			let visible = actor.role === "ADMIN" || canManage;
			if (
				!visible &&
				(actor.role === "COUNSELOR" || actor.role === "COLLEGE")
			) {
				visible =
					(await tx.participation.count({
						where: {
							activityId,
							registeredAt: { not: null },
							student: scopedStudentWhere(actor),
						},
					})) > 0;
			}
			if (!visible)
				throw new AccountError("活动不存在或无权查看", 404);
			const studentIds = query
				? (
						await tx.user.findMany({
							where: {
								OR: [
									{
										login: {
											contains: query.slice(0, 80),
											mode: "insensitive",
										},
									},
									{
										name: {
											contains: query.slice(0, 80),
											mode: "insensitive",
										},
									},
								],
								...(canManage || actor.role === "ADMIN"
									? {}
									: scopedStudentWhere(actor)),
							},
							select: { id: true },
						})
					).map((student) => student.id)
				: null;
			const statusWhere: Prisma.RecognitionSourceWhereInput | undefined = status
				? status === "PENDING"
					? { status: { in: ["PENDING_COUNSELOR", "PENDING_COLLEGE"] } }
					: { status }
				: undefined;
			const where: Prisma.ParticipationWhereInput = {
				activityId,
				registeredAt: { not: null },
				...(removed === "active"
					? { removedAt: null }
					: removed === "removed"
						? { removedAt: { not: null } }
						: {}),
				...(statusWhere ? { sources: { some: statusWhere } } : {}),
				...(query
					? {
							OR: [
								{ studentId: { in: studentIds ?? [] } },
								{
									registrationSnapshot: {
										path: ["login"],
										string_contains: query.slice(0, 80),
									},
								},
								{
									registrationSnapshot: {
										path: ["name"],
										string_contains: query.slice(0, 80),
									},
								},
							],
						}
					: {}),
				...(actor.role === "COUNSELOR" || actor.role === "COLLEGE"
					? canManage
						? {}
						: { student: scopedStudentWhere(actor) }
					: {}),
			};
			const [items, total] = await Promise.all([
				tx.participation.findMany({
					where,
					include: {
						student: {
							select: {
								id: true,
								name: true,
								login: true,
								studentProfile: {
									select: { college: true, major: true, className: true },
								},
							},
						},
						sources: { select: sourceSelect, orderBy: { createdAt: "desc" } },
					},
					take: 20,
					skip: (safePage - 1) * 20,
					orderBy: [{ registeredAt: "desc" }, { id: "desc" }],
				}),
				tx.participation.count({ where }),
			]);
			const staffIds = [
				...new Set(
					items.flatMap((item) =>
						item.sources.flatMap((source) => [
							source.reviewerId,
							source.counselorId,
							source.collegeReviewerId,
						]),
					),
				),
			].filter((id): id is string => !!id);
			const staff = staffIds.length
				? await tx.user.findMany({
						where: { id: { in: staffIds } },
						select: { id: true, name: true },
					})
				: [];
			const staffName = new Map(staff.map((user) => [user.id, user.name]));
			return {
				items: items.map((item) => ({
					...item,
					name: item.student.name,
					login: item.student.login,
					college: item.student.studentProfile?.college ?? "",
					major: item.student.studentProfile?.major ?? "",
					className: item.student.studentProfile?.className ?? "",
					score: item.score?.toFixed() ?? null,
					sources: item.sources.map((source) => ({
						...source,
						reviewerName: source.reviewerId
							? (staffName.get(source.reviewerId) ?? null)
							: null,
						counselorName: source.counselorId
							? (staffName.get(source.counselorId) ?? null)
							: null,
						collegeReviewerName: source.collegeReviewerId
							? (staffName.get(source.collegeReviewerId) ?? null)
							: null,
					})),
				})),
				total,
				page: safePage,
				canManage,
				hostCollege: activity.college,
				rosterCommitted: !!activity.rosterCommittedAt,
				rosterRevision: activity.rosterRevision,
			};
		},
		"read",
	);
}

export async function saveActivityScore(
	sessionId: string,
	termId: string,
	input: unknown,
) {
	const data = z
		.object({
			participationId: z.string().min(1).max(100),
			revision: z.number().int().nonnegative(),
			value: decimalSchema,
			reason: z.string().trim().min(2).max(1000),
		})
		.strict()
		.parse(input);
	return termTransaction(
		sessionId,
		termId,
		["ADMIN", "COLLEGE", "PUBLISHER"],
		["ACTIVE"],
		async (tx, _term, actorId) => {
			const fact = await tx.participation.findUnique({
				where: { id: data.participationId },
				include: { activity: true, sources: true },
			});
			if (
				!fact ||
				fact.activity.termId !== termId ||
				!fact.registeredAt ||
				fact.removedAt
			)
				throw new AccountError("后台参与登记不存在", 404);
			const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId } });
			assertActivityManager(fact.activity, actor);
			if (!fact.activity.confirmed || fact.activity.scoreMode !== "INDIVIDUAL")
				throw new AccountError("该活动未确认或采用固定分，无需逐人录分", 409);
			if (fact.revision !== data.revision)
				throw new AccountError("参与或审核记录已变化，请刷新", 409);
			const value = Rational.from(data.value);
			if (
				value.compare(Rational.from("0")) < 0 ||
				value.compare(Rational.from(fact.activity.points.toFixed())) > 0
			)
				throw new AccountError("个人分数须在0与活动分值上限之间");
			if (fact.score && fact.score.equals(data.value))
				return { ...fact, score: fact.score.toFixed() };
			const entry = historyEntry(actorId, "SCORE_CHANGED", {
				before: fact.score?.toFixed() ?? null,
				after: data.value,
				reason: data.reason,
			});
			const saved = await tx.participation.update({
				where: { id: fact.id },
				data: {
					score: data.value,
					revision: { increment: 1 },
					history: appendHistory(fact.history, entry),
				},
			});
			const approved = fact.sources.filter(
				(source) => source.status === "APPROVED",
			);
			const pendingCollege = fact.sources.filter(
				(source) => source.status === "PENDING_COLLEGE",
			);
			const evidence =
				approved.length || pendingCollege.length
					? await tx.activityEvidence.findFirst({
							where: { activityId: fact.activityId, active: true },
							orderBy: [{ version: "desc" }, { id: "desc" }],
						})
					: null;
			if ((approved.length || pendingCollege.length) && !evidence)
				throw new AccountError(
					"请先在活动详情上传当前有效的活动证明，再更正原始分",
					409,
				);
			for (const source of pendingCollege) {
				await tx.recognitionSource.update({
					where: { id: source.id },
					data: {
						status: "PENDING_COUNSELOR",
						activityEvidenceId: evidence!.id,
						reviewReason: null,
						reviewerId: null,
						reviewedAt: null,
						returnedByRole: null,
						counselorId: null,
						counseledAt: null,
						collegeReviewerId: null,
						collegeReviewedAt: null,
						revision: { increment: 1 },
						history: appendHistory(
							source.history,
							historyEntry(actorId, "SCORE_REOPENED", {
								before: "PENDING_COLLEGE",
								after: "PENDING_COUNSELOR",
								reason: data.reason,
								beforeScore: fact.score?.toFixed() ?? null,
								afterScore: data.value,
							}),
						),
					},
				});
			}
			if (approved.length) {
				for (const source of approved) {
					await tx.recognitionSource.update({
						where: { id: source.id },
						data: {
							status: "SUPERSEDED",
							revision: { increment: 1 },
							history: appendHistory(
								source.history,
								historyEntry(actorId, "SCORE_SUPERSEDED", {
									reason: data.reason,
									before: "APPROVED",
									after: "SUPERSEDED",
									beforeScore: fact.score?.toFixed() ?? null,
									afterScore: data.value,
								}),
							),
						},
					});
					await tx.recognitionSource.create({
						data: {
							participationId: fact.id,
							submitterId: actorId,
							origin: "SCORE_CORRECTION",
							status: "PENDING_COUNSELOR",
							activityEvidenceId: evidence!.id,
							note: `活动原始分更正为 ${data.value} 分，需重新核验。`,
							history: jsonValue([
								historyEntry(actorId, "SCORE_REOPENED", {
									reason: data.reason,
									beforeScore: fact.score?.toFixed() ?? null,
									afterScore: data.value,
								}),
							]),
						},
					});
				}
				await tx.term.update({
					where: { id: termId },
					data: { inputRevision: { increment: 1 } },
				});
			}
			await tx.auditEvent.create({
				data: {
					actorId,
					action: "ACTIVITY_SCORE_SAVED",
					targetId: fact.id,
					details: {
						termId,
						activityId: fact.activityId,
						before: fact.score?.toFixed() ?? null,
						after: data.value,
						reason: data.reason,
						reopened: approved.length,
						scoreReopened: pendingCollege.length,
					},
				},
			});
			return { ...saved, score: saved.score?.toFixed() ?? null };
		},
	);
}
