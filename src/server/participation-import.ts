import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { AccountError } from "@/server/accounts";
import { termTransaction } from "@/server/terms";
import { assertActivityManager, eligible } from "@/server/activity-policy";
import { registerFact } from "@/server/activity-participants";
import { historyEntry, jsonValue } from "@/server/claims";
import { duplicateIdentityMessage, loadIdentityIndex } from "@/server/student-identity";
import { recordAudit } from "@/server/audit";

const rowSchema = z
	.object({
		login: z.string().trim().min(1).max(64),
		name: z.string().trim().min(1).max(80),
		college: z.string().trim().min(1).max(80),
		major: z.string().trim().min(1).max(80),
		className: z.string().trim().min(1).max(80),
	})
	.strict();
const rowsSchema = z.array(rowSchema).min(1).max(2000);
const evidenceSchema = z.array(z.string().min(1)).max(5);
const kindSchema = z.enum(["INITIAL", "CORRECTION"]);
export type ParticipationImportRow = z.infer<typeof rowSchema>;
export type ParticipationPreviewRow = {
	line: number;
	login: string;
	name: string;
	college: string;
	major: string;
	className: string;
	state: "NEW" | "EXISTING" | "UNCHANGED" | "UPDATE" | "ERROR";
	message: string;
};

const studentInclude = {
	studentProfile: {
		include: {
			schoolClass: {
				include: {
					major: { include: { college: true } },
					counselor: true,
				},
			},
		},
	},
} as const;
type ImportStudent = Prisma.UserGetPayload<{ include: typeof studentInclude }>;

function identityError(
	row: ParticipationImportRow,
	student: ImportStudent | undefined,
	activity: Parameters<typeof eligible>[0],
) {
	if (!student || student.role !== "STUDENT" || student.disabled)
		return "学号未匹配到有效学生账号";
	const profile = student.studentProfile;
	if (!profile) return "学生尚未建立档案";
	const schoolClass = profile.schoolClass;
	if (!schoolClass)
		return "学生尚未绑定正式班级，请先完成组织归属配置";
	if (
		!schoolClass.enabled ||
		!schoolClass.major.enabled ||
		!schoolClass.major.college.enabled
	)
		return "学生所属班级、专业或学院已停用";
	const counselor = schoolClass.counselor;
	if (!counselor || counselor.disabled || counselor.role !== "COUNSELOR")
		return "班级尚未配置有效的责任辅导员";
	if (counselor.collegeId !== schoolClass.major.collegeId)
		return "班级责任辅导员与学院归属不一致";
	if (
		profile.college !== schoolClass.major.college.name ||
		profile.major !== schoolClass.major.name ||
		profile.className !== schoolClass.name
	)
		return "学生档案归属与班级组织不一致，请先由管理员更正组织归属";
	if (student.login !== row.login) return "学号与权威档案不一致";
	if (student.name.trim() !== row.name) return "姓名与权威档案不一致";
	if (profile.college !== row.college) return "学院与权威档案不一致";
	if (profile.major !== row.major) return "专业与权威档案不一致";
	if (profile.className !== row.className) return "班级与权威档案不一致";
	if (!eligible(activity, student))
		return "学生不属于活动面向的学院和班级";
	return null;
}

function snapshotHash(value: unknown) {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function inspect(
	tx: Prisma.TransactionClient,
	termId: string,
	actorId: string,
	input: {
		activityId: string;
		kind: "INITIAL" | "CORRECTION";
		rows: ParticipationImportRow[];
	},
) {
	const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId } });
	const activity = await tx.activity.findUnique({
		where: { id: input.activityId },
	});
	if (!activity || activity.termId !== termId)
		throw new AccountError("活动不存在", 404);
	assertActivityManager(activity, actor);
	if (input.kind === "INITIAL" && activity.rosterCommittedAt)
		throw new AccountError(
			"该活动正式名单已封存，漏报学生请使用补录更正",
			409,
		);
	if (input.kind === "CORRECTION" && !activity.rosterCommittedAt)
		throw new AccountError(
			"该活动尚未提交首份正式名单，请先完成正式名单导入",
			409,
		);
	const term = await tx.term.findUniqueOrThrow({
		where: { id: termId },
		select: { revision: true, inputRevision: true, scheme: true },
	});
	const logins = input.rows.map((row) => row.login);
	const counts = new Map<string, number>();
	for (const login of logins)
		counts.set(login, (counts.get(login) ?? 0) + 1);
	const students = await tx.user.findMany({
		where: { login: { in: [...new Set(logins)] } },
		include: studentInclude,
		orderBy: { id: "asc" },
	});
	const known = new Map(students.map((student) => [student.login, student]));
	const identityIndex = await loadIdentityIndex(
		tx,
		students
			.filter((student) => student.studentProfile)
			.map((student) => ({
				classId: student.studentProfile!.classId,
				college: student.studentProfile!.college,
				major: student.studentProfile!.major,
				className: student.studentProfile!.className,
			})),
	);
	const studentIds = students.map((student) => student.id);
	const facts = await tx.participation.findMany({
		where: { activityId: activity.id, studentId: { in: studentIds } },
		include: {
			sources: {
				select: {
					id: true,
					status: true,
					activityEvidenceId: true,
					revision: true,
				},
				orderBy: { id: "asc" },
			},
		},
		orderBy: { id: "asc" },
	});
	const factsByStudent = new Map(
		facts.map((fact) => [fact.studentId, fact]),
	);
	const rows: ParticipationPreviewRow[] = input.rows.map((row, index) => {
		const student = known.get(row.login);
		const fact = student ? factsByStudent.get(student.id) : undefined;
		const base: ParticipationPreviewRow = {
			line: index + 1,
			login: row.login,
			name: row.name,
			college: row.college,
			major: row.major,
			className: row.className,
			state: "NEW",
			message: "",
		};
		if ((counts.get(row.login) ?? 0) > 1)
			return {
				...base,
				state: "ERROR",
				message: "文件内学号重复，整份名单不写入",
			};
		const invalidIdentity = identityError(row, student, activity);
		if (invalidIdentity)
			return { ...base, state: "ERROR", message: invalidIdentity };
		if (student?.studentProfile) {
			const duplicateCandidates = identityIndex.candidatesFor({
				userId: student.id,
				studentNumber: student.studentProfile.studentNumber,
				name: student.name,
				classId: student.studentProfile.classId,
				college: student.studentProfile.college,
				major: student.studentProfile.major,
				className: student.studentProfile.className,
			});
			if (duplicateCandidates.length)
				return {
					...base,
					state: "ERROR",
					message: `${duplicateIdentityMessage(duplicateCandidates)} 参与名单在重复账号处置前不可写入。`,
				};
		}
		if (fact?.removedAt)
			return {
				...base,
				state: "ERROR",
				message:
					"该学生参与事实已移除；如需恢复，请在补录更正中说明理由并重新提交审核",
			};
		if (!fact || !fact.registeredAt) {
			return {
				...base,
				state: "NEW",
				message:
					input.kind === "INITIAL"
						? "新增参与事实并提交辅导员初核"
						: "补录漏报学生；提交后重新进入辅导员初核",
			};
		}
		if (fact.sources.length)
			return {
				...base,
				state: "UNCHANGED",
				message: "名单已包含该学生，本次无变更",
			};
		return {
			...base,
			state: "EXISTING",
			message: "沿用已有参与事实，并补充待审核来源",
		};
	});
	const snapshot = snapshotHash({
		term: term.revision,
		activity: {
			id: activity.id,
			revision: activity.revision,
			rosterRevision: activity.rosterRevision,
			rosterCommittedAt: activity.rosterCommittedAt,
			points: activity.points.toFixed(),
			audienceScope: activity.audienceScope,
			audienceColleges: activity.audienceColleges,
			audienceClasses: activity.audienceClasses,
		},
		rows: input.rows,
		students: students
			.map((student) => ({
				id: student.id,
				login: student.login,
				name: student.name,
				revision: student.revision,
				profile: student.studentProfile,
			}))
			.sort((a, b) => a.id.localeCompare(b.id)),
		facts: facts
			.map((fact) => ({
				id: fact.id,
				studentId: fact.studentId,
				revision: fact.revision,
				removedAt: fact.removedAt,
				sources: fact.sources,
			}))
			.sort((a, b) => a.id.localeCompare(b.id)),
		identity: identityIndex.snapshot,
	});
	return {
		activity,
		term,
		rows,
		known,
		factsByStudent,
		snapshot,
		errors: rows.filter((row) => row.state === "ERROR").length,
		changes: rows.filter(
			(row) => row.state === "NEW" || row.state === "EXISTING",
		).length,
	};
}

const previewSchema = z
	.object({
		activityId: z.string().min(1).max(100),
		kind: kindSchema.default("INITIAL"),
		rows: rowsSchema,
		note: z.string().trim().min(2).max(2000),
		reason: z.string().trim().min(2).max(1000).optional(),
		evidenceIds: evidenceSchema.optional(),
	})
	.strict();

type PreviewMeta = { fileHash?: string; templateVersion?: string; requestId?: string };

export async function previewParticipationImport(
	sessionId: string,
	termId: string,
	input: unknown,
	meta: PreviewMeta = {},
) {
	const data = previewSchema.parse(input);
	if (data.kind === "CORRECTION" && !data.reason)
		throw new AccountError("补录更正必须填写理由");
	return termTransaction(
		sessionId,
		termId,
		["ADMIN", "COLLEGE", "PUBLISHER"],
		["ACTIVE"],
		async (tx, term, actorId) => {
			const preview = await inspect(tx, term.id, actorId, data);
			const requestId = meta.requestId ?? randomUUID();
			const templateVersion = meta.templateVersion ?? "participation-v5-fixed";
			const batch = await tx.participationImport.create({
				data: {
					termId,
					activityId: data.activityId,
					actorId,
					kind: data.kind,
					rows: jsonValue(data.rows),
					evidenceIds: jsonValue([]),
					note: data.note,
					reason: data.reason ?? null,
					diff: jsonValue(preview.rows),
					snapshot: preview.snapshot,
					baselineRevision: preview.activity.rosterRevision,
					fileHash: meta.fileHash ?? null,
					templateVersion,
					scopeKey: `${term.id}:participation:${data.activityId}`,
					requestId,
					expiresAt: new Date(Date.now() + 30 * 60_000),
				},
			});
			return {
				id: batch.id,
				requestId,
				templateVersion,
				kind: data.kind,
				expiresAt: batch.expiresAt,
				rows: preview.rows,
				errors: preview.errors,
				changes: preview.changes,
				baselineRevision: preview.activity.rosterRevision,
				rosterCommitted: !!preview.activity.rosterCommittedAt,
			};
		},
	);
}

export type ParticipationImportResult = {
	submitted: number;
	updated: number;
	unchanged: number;
	skipped: number;
	kind: "INITIAL" | "CORRECTION";
	rosterRevision: number;
	replay: boolean;
};

export async function commitParticipationImport(
	sessionId: string,
	termId: string,
	id: string,
) {
	return termTransaction(
		sessionId,
		termId,
		["ADMIN", "COLLEGE", "PUBLISHER"],
		["ACTIVE"],
		async (tx, term, actorId) => {
			const batch = await tx.participationImport.findUnique({ where: { id } });
			if (!batch || batch.termId !== term.id)
				throw new AccountError("导入批次不存在", 404);
			if (batch.actorId !== actorId)
				throw new AccountError("不能提交他人的导入批次", 403);
			const activity = await tx.activity.findUnique({
				where: { id: batch.activityId },
			});
			const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId } });
			if (!activity) throw new AccountError("活动不存在", 404);
			assertActivityManager(activity, actor);
			if (batch.status === "COMMITTED") {
				const previous = batch.result as ParticipationImportResult;
				return { ...previous, replay: true };
			}
			if (batch.expiresAt <= new Date())
				throw new AccountError("名单预览已过期，请重新预览", 409);
			const kind = kindSchema.parse(batch.kind);
			const rows = rowsSchema.parse(batch.rows);
			// The period transaction already serializes term writes; this additional
			// activity lock documents and protects roster competition per activity.
			await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`activity-roster:${batch.activityId}`}, 72109316))`;
			const freshActivity = await tx.activity.findUniqueOrThrow({
				where: { id: batch.activityId },
			});
			if (
				kind === "INITIAL" &&
				freshActivity.rosterCommittedAt &&
				freshActivity.rosterImportId !== batch.id
			)
				throw new AccountError(
					"该活动正式名单已由其他批次提交，普通导入已封存",
					409,
				);
			if (
				kind === "INITIAL" &&
				freshActivity.rosterImportId &&
				freshActivity.rosterImportId !== batch.id
			)
				throw new AccountError(
					"该活动正式名单已由其他批次提交，普通导入已封存",
					409,
				);
			if (
				batch.baselineRevision !== null &&
				batch.baselineRevision !== freshActivity.rosterRevision
			)
				throw new AccountError("名单版本已变化，请重新预览差异", 409);
			if (!freshActivity.publishedAt)
				throw new AccountError("活动尚未发布，不能提交参与名单", 409);
			const preview = await inspect(tx, termId, actorId, {
				activityId: batch.activityId,
				kind,
				rows,
			});
			if (preview.snapshot !== batch.snapshot)
				throw new AccountError(
					"预览后的活动、学生或参与记录已变化，请重新预览",
					409,
				);
			if (preview.errors)
				throw new AccountError("名单存在错误，本批次未写入", 409);
			const activeEvidence = await tx.activityEvidence.findFirst({
				where: { activityId: batch.activityId, active: true },
				orderBy: [{ version: "desc" }, { id: "desc" }],
			});
			if (!activeEvidence)
				throw new AccountError(
					"请先在活动详情上传当前有效的活动证明，再提交参与名单",
					409,
				);
			let submitted = 0;
			let unchanged = 0;
			for (const row of preview.rows) {
				if (row.state === "ERROR") continue;
				if (row.state === "UNCHANGED") {
					unchanged++;
					continue;
				}
				const student = preview.known.get(row.login)!;
				const fact = preview.factsByStudent.get(student.id);
				const registered = await registerFact(
					tx,
					batch.activityId,
					student,
					actorId,
					batch.id,
				);
				if (fact?.sources.length) {
					unchanged++;
					continue;
				}
				await tx.recognitionSource.create({
					data: {
						participationId: registered.id,
						submitterId: actorId,
						origin: kind === "CORRECTION" ? "CORRECTION" : "IMPORT",
						importBatchId: batch.id,
						status: "PENDING_COUNSELOR",
						activityEvidenceId: activeEvidence.id,
						note: batch.note,
						history: jsonValue([
							historyEntry(
								actorId,
								kind === "CORRECTION" ? "CORRECTION_ADDED" : "IMPORTED",
								{
									batchId: batch.id,
									kind,
									note: batch.note,
									reason: batch.reason ?? null,
									activityEvidenceId: activeEvidence.id,
								},
							),
						]),
					},
				});
				submitted++;
			}
			const rosterRevision =
				kind === "INITIAL"
					? 1
					: submitted > 0
						? freshActivity.rosterRevision + 1
						: freshActivity.rosterRevision;
			await tx.activity.update({
				where: { id: freshActivity.id },
				data: {
					...(kind === "INITIAL"
						? {
								rosterCommittedAt: new Date(),
								rosterImportId: batch.id,
								rosterRevision: 1,
							}
						: submitted > 0
							? { rosterRevision: { increment: 1 } }
							: {}),
				},
			});
			const result: ParticipationImportResult = {
				submitted,
				updated: 0,
				unchanged,
				skipped: 0,
				kind,
				rosterRevision,
				replay: false,
			};
			await tx.participationImport.update({
				where: { id },
				data: {
					status: "COMMITTED",
					result: jsonValue(result),
					diff: jsonValue(preview.rows),
					rowResults: jsonValue(preview.rows),
					confirmations: jsonValue([]),
					committedAt: new Date(),
					baselineRevision: freshActivity.rosterRevision,
				},
			});
			await recordAudit(tx, {
					actorId,
					action: "PARTICIPATION_IMPORT_COMMITTED",
					targetId: id,
					details: {
						...result,
						termId,
						activityId: batch.activityId,
						reason: batch.reason ?? null,
						activityEvidenceId: activeEvidence.id,
						fileHash: batch.fileHash,
						templateVersion: batch.templateVersion,
						requestId: batch.requestId,
					},
				});
			return result;
		},
	);
}
