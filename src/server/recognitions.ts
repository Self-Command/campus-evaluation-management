import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { AccountError } from "@/server/accounts";
import { termTransaction } from "@/server/terms";
import { appendHistory, historyEntry } from "@/server/claims";
import { canManageActivity } from "@/server/activity-policy";
import { scopedStudentWhere } from "@/server/access-scope";
import { decimalSchema } from "@/lib/scoring/types";
import { Rational } from "@/lib/scoring/rational";

export const recognitionStatusSchema = z.enum([
	"PENDING_COUNSELOR",
	"PENDING_COLLEGE",
	"RETURNED",
	"APPROVED",
	"SUPERSEDED",
	"WITHDRAWN",
	"REVOKED",
	"REJECTED",
]);
export const recognitionFilterSchema = z.enum([
	"PENDING",
	...recognitionStatusSchema.options,
]);
export const recognitionPendingStatuses = [
	"PENDING_COUNSELOR",
	"PENDING_COLLEGE",
] as const;
export const recognitionAttentionStatuses = ["RETURNED", "REJECTED"] as const;

const reviewSchema = z
	.object({
		id: z.string().min(1).max(100),
		revision: z.number().int().nonnegative(),
		action: z.enum([
			"counselorApprove",
			"counselorReturn",
			"collegeApprove",
			"collegeReturn",
			"revoke",
		]),
		reason: z.string().trim().min(2).max(1000).optional(),
	})
	.strict();

const recognitionStudentSelect = {
	id: true,
	name: true,
	login: true,
	role: true,
	disabled: true,
	studentProfile: {
		select: {
			college: true,
			major: true,
			className: true,
			schoolClass: {
				select: {
					id: true,
					name: true,
					enabled: true,
					counselorId: true,
					major: {
						select: {
							id: true,
							name: true,
							enabled: true,
							collegeId: true,
							college: { select: { id: true, name: true, enabled: true } },
						},
					},
				},
			},
		},
	},
} as const;

const recognitionActivitySelect = {
	id: true,
	name: true,
	ownerId: true,
	collegeId: true,
	termId: true,
	scoreMode: true,
	points: true,
	college: { select: { id: true, name: true } },
} as const;

const sourceInclude = {
	participation: {
		include: {
			activity: { select: recognitionActivitySelect },
			student: { select: recognitionStudentSelect },
		},
	},
	activityEvidence: {
		include: {
			evidence: {
				select: { id: true, name: true, mime: true, size: true },
			},
		},
	},
	evidence: {
		select: {
			evidence: { select: { id: true, name: true, mime: true, size: true } },
		},
	},
} as const;

type ReviewSource = Prisma.RecognitionSourceGetPayload<{
	include: typeof sourceInclude;
}>;

function studentClass(source: ReviewSource) {
	return source.participation.student.studentProfile?.schoolClass ?? null;
}

function assertReviewScope(
	actor: { id: string; role: string; collegeId: string | null },
	source: ReviewSource,
) {
	const schoolClass = studentClass(source);
	if (
		!schoolClass ||
		!schoolClass.enabled ||
		!schoolClass.major.enabled ||
		!schoolClass.major.college.enabled
	)
		throw new AccountError("认定记录不存在或无权查看", 404);
	if (actor.role === "COUNSELOR" && schoolClass.counselorId !== actor.id)
		throw new AccountError("认定记录不存在或无权查看", 404);
	if (
		actor.role === "COLLEGE" &&
		schoolClass.major.collegeId !== actor.collegeId
	)
		throw new AccountError("认定记录不存在或无权查看", 404);
}

async function assertMaterial(
	tx: Prisma.TransactionClient,
	source: ReviewSource,
) {
	if (source.participation.removedAt)
		throw new AccountError("该参与事实已移除，不能继续审核", 409);
	if (source.participation.activity.scoreMode === "INDIVIDUAL") {
		if (
			source.participation.score === null ||
			source.participation.score === undefined
		)
			throw new AccountError(
				"主办学院尚未录入该学生的活动原始分，不能通过初审",
				409,
			);
	}
	if (source.activityEvidenceId) {
		const active = await tx.activityEvidence.findFirst({
			where: {
				activityId: source.participation.activityId,
				active: true,
			},
			orderBy: [{ version: "desc" }, { id: "desc" }],
		});
		if (!active || active.id !== source.activityEvidenceId)
			throw new AccountError(
				"活动证明已更新或不再有效，请刷新后按当前版本重新核验",
				409,
			);
		return;
	}
	// Historical sources may carry their own material rather than a shared
	// activity version; they remain reviewable without inventing new evidence.
	if (!source.evidence.length)
		throw new AccountError("该参与记录缺少活动证明，不能通过审核", 409);
}

export async function reviewParticipation(
	sessionId: string,
	termId: string,
	input: unknown,
) {
	const data = reviewSchema.parse(input);
	const targetStatus = {
		counselorApprove: "PENDING_COLLEGE",
		counselorReturn: "RETURNED",
		collegeApprove: "APPROVED",
		collegeReturn: "RETURNED",
		revoke: "REVOKED",
	}[data.action] as
		| "PENDING_COLLEGE"
		| "RETURNED"
		| "APPROVED"
		| "REVOKED";
	return termTransaction(
		sessionId,
		termId,
		["ADMIN", "COUNSELOR", "COLLEGE"],
		["ACTIVE"],
		async (tx, term, actorId) => {
			const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId } });
			const source = await tx.recognitionSource.findUnique({
				where: { id: data.id },
				include: sourceInclude,
			});
			if (!source || source.participation.activity.termId !== term.id)
				throw new AccountError("认定记录不存在", 404);
			const alreadyCurrent =
				(data.action === "counselorApprove" &&
					source.status === "PENDING_COLLEGE" &&
					source.counselorId === actorId) ||
				(data.action === "counselorReturn" &&
					source.status === "RETURNED" &&
					source.returnedByRole === "COUNSELOR" &&
					source.reviewerId === actorId) ||
				(data.action === "collegeApprove" &&
					source.status === "APPROVED" &&
					source.collegeReviewerId === actorId) ||
				(data.action === "collegeReturn" &&
					source.status === "RETURNED" &&
					source.returnedByRole === "COLLEGE" &&
					source.reviewerId === actorId) ||
				(data.action === "revoke" &&
					source.status === "REVOKED" &&
					source.reviewerId === actorId);
			if (alreadyCurrent) return source;
			if (source.revision !== data.revision)
				throw new AccountError("认定记录已变化，请刷新", 409);
			const fields: Prisma.RecognitionSourceUpdateInput = {};
			let next: typeof targetStatus = targetStatus;
			if (data.action === "counselorApprove") {
				if (actor.role !== "COUNSELOR")
					throw new AccountError("没有辅导员初审权限", 403);
				assertReviewScope(actor, source);
				if (source.status !== "PENDING_COUNSELOR")
					throw new AccountError("仅待辅导员初核的记录可通过初审", 409);
				await assertMaterial(tx, source);
				fields.counselorId = actorId;
				fields.counseledAt = new Date();
				fields.reviewerId = actorId;
				fields.reviewedAt = new Date();
				fields.reviewReason = data.reason ?? null;
				fields.returnedByRole = null;
				fields.collegeReviewerId = null;
				fields.collegeReviewedAt = null;
				next = "PENDING_COLLEGE";
			} else if (data.action === "counselorReturn") {
				if (actor.role !== "COUNSELOR")
					throw new AccountError("没有辅导员初审权限", 403);
				assertReviewScope(actor, source);
				if (source.status !== "PENDING_COUNSELOR")
					throw new AccountError("仅待辅导员初核的记录可退回", 409);
				if (!data.reason) throw new AccountError("请填写退回理由");
				fields.reviewerId = actorId;
				fields.reviewedAt = new Date();
				fields.reviewReason = data.reason;
				fields.returnedByRole = "COUNSELOR";
				next = "RETURNED";
			} else if (data.action === "collegeApprove") {
				if (actor.role !== "COLLEGE")
					throw new AccountError("没有学院终审权限", 403);
				assertReviewScope(actor, source);
				if (source.status !== "PENDING_COLLEGE")
					throw new AccountError("仅待学院终审的记录可通过", 409);
				await assertMaterial(tx, source);
				if (
					await tx.recognitionSource.count({
						where: {
							participationId: source.participationId,
							status: "APPROVED",
							id: { not: source.id },
						},
					})
				)
					throw new AccountError(
						"同一参与事实已有有效认定，请先核对并撤销重复来源",
						409,
					);
				if (
					await tx.personalClaim.count({
						where: {
							studentId: source.participation.studentId,
							activityId: source.participation.activityId,
							status: "APPROVED",
							termId,
						},
					})
				)
					throw new AccountError(
						"该学生同活动已有个人申报通过，请先核对并撤销重复来源",
						409,
					);
				fields.collegeReviewerId = actorId;
				fields.collegeReviewedAt = new Date();
				fields.reviewerId = actorId;
				fields.reviewedAt = new Date();
				fields.reviewReason = data.reason ?? null;
				fields.returnedByRole = null;
				next = "APPROVED";
			} else if (data.action === "collegeReturn") {
				if (actor.role !== "COLLEGE")
					throw new AccountError("没有学院终审权限", 403);
				assertReviewScope(actor, source);
				if (source.status !== "PENDING_COLLEGE")
					throw new AccountError("仅待学院终审的记录可退回", 409);
				if (!data.reason) throw new AccountError("请填写退回理由");
				fields.reviewerId = actorId;
				fields.reviewedAt = new Date();
				fields.reviewReason = data.reason;
				fields.returnedByRole = "COLLEGE";
				next = "RETURNED";
			} else {
				if (actor.role !== "ADMIN")
					throw new AccountError("没有受控撤销权限", 403);
				if (source.status !== "APPROVED")
					throw new AccountError("仅已通过记录可撤销", 409);
				if (!data.reason) throw new AccountError("请填写撤销理由");
				fields.reviewerId = actorId;
				fields.reviewedAt = new Date();
				fields.reviewReason = data.reason;
				next = "REVOKED";
			}
			const saved = await tx.recognitionSource.update({
				where: { id: source.id },
				data: {
					...fields,
					status: next,
					revision: { increment: 1 },
					history: appendHistory(
						source.history,
						historyEntry(actorId, data.action.toUpperCase(), {
							before: source.status,
							after: next,
							reason: data.reason ?? null,
							role: actor.role,
						}),
					),
				},
			});
			await tx.participation.update({
				where: { id: source.participationId },
				data: { revision: { increment: 1 } },
			});
			if ((source.status === "APPROVED") !== (next === "APPROVED"))
				await tx.term.update({
					where: { id: termId },
					data: { inputRevision: { increment: 1 } },
				});
			await tx.auditEvent.create({
				data: {
					actorId,
					action: "PARTICIPATION_REVIEWED",
					targetId: source.id,
					details: {
						termId,
						action: data.action,
						before: source.status,
						after: next,
						reason: data.reason ?? null,
						activityId: source.participation.activityId,
						studentId: source.participation.studentId,
					},
				},
			});
			return saved;
		},
	);
}

export async function listRecognitions(
	sessionId: string,
	termId: string,
	page = 1,
) {
	return pageRecognitions(sessionId, termId, page);
}

export async function pageRecognitions(
	sessionId: string,
	termId: string,
	page = 1,
	status?: string,
	query = "",
) {
	const safePage = z.number().int().min(1).max(100000).parse(page);
	const parsed = recognitionFilterSchema.optional().parse(status || undefined);
	const search = query.slice(0, 80);
	return termTransaction(
		sessionId,
		termId,
		["ADMIN", "COLLEGE", "COUNSELOR", "PUBLISHER", "STUDENT"],
		["CONFIGURATION", "ACTIVE", "CHECKING", "LOCKED"],
		async (tx, _term, actorId) => {
			const actor = await tx.user.findUniqueOrThrow({
				where: { id: actorId },
			});
			const membership = (where: Prisma.ParticipationWhereInput) => ({
				participation: where,
			});
			const scope: Prisma.RecognitionSourceWhereInput =
				actor.role === "ADMIN"
					? { participation: { activity: { termId } } }
					: actor.role === "STUDENT"
						? membership({ studentId: actorId, activity: { termId } })
						: actor.role === "COUNSELOR"
							? membership({
									student: scopedStudentWhere(actor),
									activity: { termId },
								})
							: actor.role === "COLLEGE"
								? {
										OR: [
											membership({
												student: scopedStudentWhere(actor),
												activity: { termId },
											}),
											membership({
												activity: {
													termId,
													collegeId: actor.collegeId ?? "__none__",
												},
											}),
										],
									}
								: membership({
										activity: {
											termId,
											ownerId: actorId,
											collegeId: { not: null },
										},
									});
			const where: Prisma.RecognitionSourceWhereInput = {
				AND: [
					scope,
					...(search
						? [
								{
									OR: [
										{
											participation: {
												student: {
													OR: [
														{
															name: {
																contains: search,
																mode: "insensitive" as const,
															},
														},
														{
															login: {
																contains: search,
																mode: "insensitive" as const,
															},
														},
													],
												},
											},
										},
										{
											participation: {
												activity: {
													name: {
														contains: search,
														mode: "insensitive" as const,
													},
												},
											},
										},
									],
								},
							]
						: []),
				],
				...(parsed
					? {
							status:
								parsed === "PENDING"
									? { in: [...recognitionPendingStatuses] }
									: parsed,
						}
					: {}),
			};
			const [items, total] = await Promise.all([
				tx.recognitionSource.findMany({
					where,
					include: sourceInclude,
					orderBy: [{ createdAt: "desc" }, { id: "desc" }],
					take: 20,
					skip: (safePage - 1) * 20,
				}),
				tx.recognitionSource.count({ where }),
			]);
			const staffIds = [
				...new Set(
					items.flatMap((source) => [
						source.submitterId,
						source.reviewerId,
						source.counselorId,
						source.collegeReviewerId,
					]),
				),
			].filter((id): id is string => !!id);
			const staff = staffIds.length
				? await tx.user.findMany({
						where: { id: { in: staffIds } },
						select: { id: true, name: true, role: true },
					})
				: [];
			const staffName = new Map(staff.map((user) => [user.id, user.name]));
			return {
				items: items.map((source) => {
					const student = source.participation.student;
					const schoolClass = student.studentProfile?.schoolClass;
					const activity = source.participation.activity;
					return {
						...source,
						student: {
							id: student.id,
							name: student.name,
							login: student.login,
							college: student.studentProfile?.college ?? null,
							major: student.studentProfile?.major ?? null,
							className: student.studentProfile?.className ?? null,
							counselorId: schoolClass?.counselorId ?? null,
							collegeId: schoolClass?.major.collegeId ?? null,
						},
						participation: {
							...source.participation,
							score: source.participation.score?.toFixed() ?? null,
							student,
							activity,
						},
						reviewerName: source.reviewerId
							? (staffName.get(source.reviewerId) ?? null)
							: null,
						submitterName: staffName.get(source.submitterId) ?? null,
						counselorName: source.counselorId
							? (staffName.get(source.counselorId) ?? null)
							: null,
						collegeReviewerName: source.collegeReviewerId
							? (staffName.get(source.collegeReviewerId) ?? null)
							: null,
						canReview:
							(actor.role === "COUNSELOR" &&
								source.status === "PENDING_COUNSELOR" &&
								schoolClass?.counselorId === actorId) ||
							(actor.role === "COLLEGE" &&
								source.status === "PENDING_COLLEGE" &&
								schoolClass?.major.collegeId === actor.collegeId),
						canManage: canManageActivity(activity, actor),
					};
				}),
				total,
				page: safePage,
			};
		},
		"read",
	);
}

const changeSchema = z
	.object({
		id: z.string().min(1).max(100),
		revision: z.number().int().nonnegative(),
		action: z.enum(["resubmit", "remove"]),
		reason: z.string().trim().min(2).max(1000).optional(),
		note: z.string().trim().min(2).max(2000).optional(),
		score: decimalSchema.optional(),
	})
	.strict();

export async function changeParticipation(
	sessionId: string,
	termId: string,
	input: unknown,
) {
	const data = changeSchema.parse(input);
	return termTransaction(
		sessionId,
		termId,
		["ADMIN", "COLLEGE", "PUBLISHER"],
		["ACTIVE"],
		async (tx, term, actorId) => {
			const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId } });
			const source = await tx.recognitionSource.findUnique({
				where: { id: data.id },
				include: sourceInclude,
			});
			if (!source || source.participation.activity.termId !== term.id)
				throw new AccountError("认定记录不存在", 404);
			if (!canManageActivity(source.participation.activity, actor))
				throw new AccountError("仅活动主办学院可维护参与记录", 403);
			if (source.revision !== data.revision)
				throw new AccountError("认定记录已变化，请刷新", 409);
			if (data.action === "resubmit") {
				if (source.status !== "RETURNED")
					throw new AccountError("仅退回修改的记录可重新提交", 409);
				if (!data.note) throw new AccountError("请填写补充说明");
				if (
					source.participation.activity.scoreMode === "INDIVIDUAL" &&
					data.score === undefined &&
					source.participation.score === null
				)
					throw new AccountError("请填写活动原始分后再提交");
				if (data.score !== undefined) {
					const value = Rational.from(data.score);
					if (
						value.compare(Rational.from("0")) < 0 ||
						value.compare(
							Rational.from(source.participation.activity.points.toFixed()),
						) > 0
					)
						throw new AccountError("活动原始分须在0与活动分值上限之间");
				}
				const active = await tx.activityEvidence.findFirst({
					where: {
						activityId: source.participation.activityId,
						active: true,
					},
					orderBy: [{ version: "desc" }, { id: "desc" }],
				});
				if (!active)
					throw new AccountError(
						"请先在活动详情上传当前有效的活动证明，再重新提交",
						409,
					);
				if (
					data.score !== undefined &&
					!source.participation.score?.equals(data.score)
				) {
					await tx.participation.update({
						where: { id: source.participationId },
						data: {
							score: data.score,
							revision: { increment: 1 },
							history: appendHistory(
								source.participation.history,
								historyEntry(actorId, "SCORE_CORRECTED", {
									before: source.participation.score?.toFixed() ?? null,
									after: data.score,
									reason: data.reason ?? null,
								}),
							),
						},
					});
				}
				const saved = await tx.recognitionSource.update({
					where: { id: source.id },
					data: {
						status: "PENDING_COUNSELOR",
						note: data.note,
						activityEvidenceId: active.id,
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
							historyEntry(actorId, "RESUBMIT", {
								before: source.status,
								after: "PENDING_COUNSELOR",
								note: data.note,
								reason: data.reason ?? null,
							}),
						),
					},
				});
				await tx.participation.update({
					where: { id: source.participationId },
					data: { revision: { increment: 1 } },
				});
				await tx.auditEvent.create({
					data: {
						actorId,
						action: "PARTICIPATION_CHANGED",
						targetId: source.id,
						details: {
							termId,
							action: data.action,
							before: source.status,
							after: "PENDING_COUNSELOR",
							reason: data.reason ?? null,
						},
					},
				});
				return saved;
			}
			if (!data.reason) throw new AccountError("请填写移除理由");
			const participation = await tx.participation.findUniqueOrThrow({
				where: { id: source.participationId },
				include: { sources: true },
			});
			if (participation.removedAt)
				throw new AccountError("该参与事实已移除", 409);
			const approved = participation.sources.some(
				(candidate) => candidate.status === "APPROVED",
			);
			await tx.participation.update({
				where: { id: source.participationId },
				data: {
					removedAt: new Date(),
					removedBy: actorId,
					removalReason: data.reason,
					revision: { increment: 1 },
					history: appendHistory(
						participation.history,
						historyEntry(actorId, "PARTICIPATION_REMOVED", {
							reason: data.reason,
						}),
					),
				},
			});
			for (const candidate of participation.sources) {
				const next =
					candidate.status === "APPROVED"
						? "SUPERSEDED"
						: ["PENDING_COUNSELOR", "PENDING_COLLEGE", "RETURNED"].includes(
									candidate.status,
								)
							? "WITHDRAWN"
							: null;
				if (!next) continue;
				await tx.recognitionSource.update({
					where: { id: candidate.id },
					data: {
						status: next,
						reviewReason: data.reason,
						revision: { increment: 1 },
						history: appendHistory(
							candidate.history,
							historyEntry(actorId, "PARTICIPATION_REMOVED", {
								before: candidate.status,
								after: next,
								reason: data.reason,
							}),
						),
					},
				});
			}
			if (approved)
				await tx.term.update({
					where: { id: termId },
					data: { inputRevision: { increment: 1 } },
				});
			await tx.auditEvent.create({
				data: {
					actorId,
					action: "PARTICIPATION_CHANGED",
					targetId: source.id,
					details: {
						termId,
						action: "remove",
						reason: data.reason,
						approved,
					},
				},
			});
			return source;
		},
	);
}
