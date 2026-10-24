import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { AccountError } from "@/server/accounts";
import { termTransaction } from "@/server/terms";
import { assertActivityManager, canManageActivity } from "@/server/activity-policy";
import { appendHistory, historyEntry, jsonValue } from "@/server/claims";
import { recordAudit } from "@/server/audit";

export const activityEvidenceInclude = {
	evidence: {
		select: {
			id: true,
			name: true,
			mime: true,
			size: true,
			createdAt: true,
			ownerId: true,
		},
	},
} as const;

export type ActivityEvidenceRow = Prisma.ActivityEvidenceGetPayload<{
	include: typeof activityEvidenceInclude;
}>;

export function activityEvidenceView(row: ActivityEvidenceRow) {
	return {
		id: row.id,
		version: row.version,
		active: row.active,
		uploadedBy: row.uploadedBy,
		note: row.note,
		createdAt: row.createdAt,
		evidence: row.evidence,
	};
}

/**
 * Activity materials belong to the activity, not to a roster row. A new upload
 * becomes the single active version and any approval based on the previous
 * version is retained in history but re-opened for the full review chain.
 */
export async function saveActivityEvidence(
	sessionId: string,
	termId: string,
	input: unknown,
) {
	const data = z
		.object({
			activityId: z.string().min(1).max(100),
			revision: z.number().int().nonnegative(),
			evidenceId: z.string().min(1).max(100),
			note: z.string().trim().min(1).max(500),
			reason: z.string().trim().min(2).max(1000).optional(),
		})
		.strict()
		.parse(input);
	return termTransaction(
		sessionId,
		termId,
		["ADMIN", "COLLEGE", "PUBLISHER"],
		["ACTIVE"],
		async (tx, term, actorId) => {
			const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId } });
			const activity = await tx.activity.findUnique({
				where: { id: data.activityId },
			});
			if (!activity || activity.termId !== term.id)
				throw new AccountError("活动不存在", 404);
			assertActivityManager(activity, actor);
			if (activity.revision !== data.revision)
				throw new AccountError("活动已变化，请刷新", 409);
			const evidence = await tx.evidence.findUnique({
				where: { id: data.evidenceId },
				select: { id: true, ownerId: true, name: true },
			});
			if (!evidence || evidence.ownerId !== actorId)
				throw new AccountError("证明不存在或不属于当前提交者", 403);
			const active = await tx.activityEvidence.findFirst({
				where: { activityId: activity.id, active: true },
				orderBy: [{ version: "desc" }, { id: "desc" }],
			});
			if (active?.evidenceId === evidence.id)
				throw new AccountError("该证明已是当前有效版本，无需重复上传", 409);
			const version = activity.sharedEvidenceVersion + 1;
			await tx.activityEvidence.updateMany({
				where: { activityId: activity.id, active: true },
				data: { active: false },
			});
			const created = await tx.activityEvidence.create({
				data: {
					activityId: activity.id,
					evidenceId: evidence.id,
					version,
					uploadedBy: actorId,
					note: data.note,
				},
				include: activityEvidenceInclude,
			});
			await tx.activity.update({
				where: { id: activity.id },
				data: { sharedEvidenceVersion: version, revision: { increment: 1 } },
			});
			let reopened = 0;
			if (active) {
				const pending = await tx.recognitionSource.findMany({
					where: {
						participation: { activityId: activity.id },
						activityEvidenceId: active.id,
						status: { in: ["PENDING_COUNSELOR", "PENDING_COLLEGE"] },
					},
					select: { id: true, status: true, history: true },
					orderBy: { id: "asc" },
				});
				for (const source of pending) {
					await tx.recognitionSource.update({
						where: { id: source.id },
						data: {
							activityEvidenceId: created.id,
							revision: { increment: 1 },
							history: appendHistory(
								source.history,
								historyEntry(actorId, "EVIDENCE_REBOUND", {
									before: source.status,
									after: source.status,
									previousEvidenceId: active.id,
									evidenceId: created.id,
									version,
									reason: data.reason ?? null,
								}),
							),
						},
					});
				}
				const approved = await tx.recognitionSource.findMany({
					where: {
						participation: { activityId: activity.id },
						activityEvidenceId: active.id,
						status: "APPROVED",
					},
					select: {
						id: true,
						participationId: true,
						note: true,
						history: true,
					},
					orderBy: { id: "asc" },
				});
				for (const source of approved) {
					await tx.recognitionSource.update({
						where: { id: source.id },
						data: {
							status: "SUPERSEDED",
							revision: { increment: 1 },
							history: appendHistory(
								source.history,
								historyEntry(actorId, "EVIDENCE_SUPERSEDED", {
									before: "APPROVED",
									after: "SUPERSEDED",
									previousEvidenceId: active.id,
									evidenceId: created.id,
									version,
									reason: data.reason ?? null,
								}),
							),
						},
					});
					await tx.recognitionSource.create({
						data: {
							participationId: source.participationId,
							submitterId: actorId,
							origin: "EVIDENCE_REVISION",
							status: "PENDING_COUNSELOR",
							activityEvidenceId: created.id,
							note: `活动证明已更新至第 ${version} 版，需按新版本重新核验。`,
							history: jsonValue([
								historyEntry(actorId, "EVIDENCE_REOPENED", {
									previousEvidenceId: active.id,
									evidenceId: created.id,
									version,
									reason: data.reason ?? null,
								}),
							]),
						},
					});
					await tx.participation.update({
						where: { id: source.participationId },
						data: { revision: { increment: 1 } },
					});
					reopened++;
				}
				await tx.recognitionSource.updateMany({
					where: {
						participation: { activityId: activity.id },
						activityEvidenceId: active.id,
						status: {
							in: ["PENDING_COUNSELOR", "PENDING_COLLEGE", "RETURNED"],
						},
					},
					data: {
						activityEvidenceId: created.id,
						revision: { increment: 1 },
					},
				});
			} else {
				// Pending legacy sources with their own historical files adopt the
				// first shared activity material so current reviews see one source.
				await tx.recognitionSource.updateMany({
					where: {
						participation: { activityId: activity.id },
						activityEvidenceId: null,
						status: {
							in: ["PENDING_COUNSELOR", "PENDING_COLLEGE", "RETURNED"],
						},
					},
					data: { activityEvidenceId: created.id },
				});
			}
			if (reopened)
				await tx.term.update({
					where: { id: term.id },
					data: { inputRevision: { increment: 1 } },
				});
			await recordAudit(tx, {
					actorId,
					action: active
						? "ACTIVITY_EVIDENCE_REPLACED"
						: "ACTIVITY_EVIDENCE_ADDED",
					targetId: activity.id,
					details: {
						termId: term.id,
						version,
						previousEvidenceId: active?.id ?? null,
						evidenceId: created.id,
						note: data.note,
						reason: data.reason ?? null,
						reopened,
					},
				});
			return {
				...activityEvidenceView(created),
				reopened,
				activityRevision: activity.revision + 1,
			};
		},
	);
}

export function canReadActivityEvidence(
	actor: { id: string; role: string; collegeId?: string | null },
	activity: { ownerId: string; collegeId: string | null },
	studentIds: string[],
	scopedStudentCount: number,
) {
	if (actor.role === "ADMIN") return true;
	if (canManageActivity(activity, actor)) return true;
	if (actor.role === "STUDENT") return studentIds.includes(actor.id);
	return (
		(actor.role === "COLLEGE" || actor.role === "COUNSELOR") &&
		scopedStudentCount > 0
	);
}
