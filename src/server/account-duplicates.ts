import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { AccountError, adminTransaction } from "@/server/accounts";
import {
	identityClassKey,
	identityNameKey,
	identityNumberKey,
	loadIdentityIndex,
	recordIdentityException,
} from "@/server/student-identity";

export type DuplicateBusinessCounts = {
	grades: number;
	deductions: number;
	participations: number;
	claims: number;
	confirmations: number;
	appeals: number;
	publishedResults: number;
	gradeChanges: number;
	deductionChanges: number;
	recognitionSources: number;
};

export type DuplicateAccount = {
	id: string;
	login: string;
	name: string;
	studentNumber: string;
	college: string;
	major: string;
	className: string;
	disabled: boolean;
	mergedIntoId: string | null;
	createdAt: string;
	businessCounts: DuplicateBusinessCounts;
	businessTotal: number;
	recommended: boolean;
	canDisable: boolean;
};

export type DuplicateGroup = {
	key: string;
	classKey: string;
	nameKey: string;
	name: string;
	college: string;
	major: string;
	className: string;
	status: "OPEN" | "CONFIRMED";
	unresolvedPairs: number;
	accounts: DuplicateAccount[];
};

async function businessCounts(
	tx: Prisma.TransactionClient,
	studentId: string,
): Promise<DuplicateBusinessCounts> {
	const [
		grades,
		deductions,
		participations,
		claims,
		confirmations,
		appeals,
		publishedResults,
		gradeChanges,
		deductionChanges,
		recognitionSources,
	] = await Promise.all([
		tx.gradeInput.count({ where: { studentId } }),
		tx.deductionInput.count({ where: { studentId } }),
		tx.participation.count({ where: { studentId } }),
		tx.personalClaim.count({ where: { studentId } }),
		tx.resultConfirmation.count({ where: { studentId } }),
		tx.resultAppeal.count({ where: { studentId } }),
		tx.publishedResult.count({ where: { studentId } }),
		tx.gradeChange.count({ where: { studentId } }),
		tx.deductionChange.count({ where: { studentId } }),
		tx.recognitionSource.count({ where: { participation: { studentId } } }),
	]);
	return {
		grades,
		deductions,
		participations,
		claims,
		confirmations,
		appeals,
		publishedResults,
		gradeChanges,
		deductionChanges,
		recognitionSources,
	};
}

function total(counts: DuplicateBusinessCounts) {
	return Object.values(counts).reduce((sum, value) => sum + value, 0);
}

function orgClassKey(profile: {
	college: string;
	major: string;
	className: string;
}) {
	return identityClassKey({
		classId: null,
		college: profile.college,
		major: profile.major,
		className: profile.className,
	});
}

function pairKey(
	classKey: string,
	nameKey: string,
	left: string,
	right: string,
) {
	const [a, b] = [
		identityNumberKey(left),
		identityNumberKey(right),
	].sort();
	return `${classKey}\u0000${nameKey}\u0000${a}\u0000${b}`;
}

export async function listDuplicateGroups(sessionId: string) {
	return adminTransaction(sessionId, async (tx, actorId) => {
		const profiles = await tx.studentProfile.findMany({
			where: { user: { role: "STUDENT" } },
			select: {
				userId: true,
				studentNumber: true,
				classId: true,
				college: true,
				major: true,
				className: true,
				user: {
					select: {
						id: true,
						login: true,
						name: true,
						disabled: true,
						createdAt: true,
						mergedIntoId: true,
					},
				},
			},
			orderBy: { userId: "asc" },
		});
		const exceptions = await tx.duplicateIdentityException.findMany({
			select: {
				classKey: true,
				normalizedName: true,
				studentNumberA: true,
				studentNumberB: true,
			},
		});
		const resolved = new Set(
			exceptions.map((item) =>
				pairKey(
					item.classKey,
					item.normalizedName,
					item.studentNumberA,
					item.studentNumberB,
				),
			),
		);

		const buckets = new Map<
			string,
			{
				classKey: string;
				nameKey: string;
				college: string;
				major: string;
				className: string;
				profiles: typeof profiles;
			}
		>();
		for (const profile of profiles) {
			const classKey = identityClassKey(profile);
			const nameKey = identityNameKey(profile.user.name);
			const key = `${classKey}\u0000${nameKey}`;
			const group = buckets.get(key) ?? {
				classKey,
				nameKey,
				college: profile.college,
				major: profile.major,
				className: profile.className,
				profiles: [],
			};
			group.profiles.push(profile);
			buckets.set(key, group);
		}

		const groups: DuplicateGroup[] = [];
		for (const group of buckets.values()) {
			if (group.profiles.length < 2) continue;
			const counts = new Map<
				string,
				{ counts: DuplicateBusinessCounts; total: number }
			>();
			let unresolvedPairs = 0;
			const unresolvedByUser = new Map<string, number>();
			for (let i = 0; i < group.profiles.length; i++) {
				for (let j = i + 1; j < group.profiles.length; j++) {
					const left = group.profiles[i];
					const right = group.profiles[j];
					const keys = new Set([
						group.classKey,
						orgClassKey(left),
						orgClassKey(right),
					]);
					const covered = [...keys].some((key) =>
						resolved.has(
							pairKey(
								key,
								group.nameKey,
								left.studentNumber,
								right.studentNumber,
							),
						),
					);
					if (!covered) {
						unresolvedPairs++;
						unresolvedByUser.set(left.userId, (unresolvedByUser.get(left.userId) ?? 0) + 1);
						unresolvedByUser.set(right.userId, (unresolvedByUser.get(right.userId) ?? 0) + 1);
					}
				}
			}
			for (const profile of group.profiles) {
				const value = await businessCounts(tx, profile.userId);
				counts.set(profile.userId, { counts: value, total: total(value) });
			}
			const recommended = [...group.profiles].sort((left, right) => {
				const leftCount = counts.get(left.userId)!.total;
				const rightCount = counts.get(right.userId)!.total;
				return (
					rightCount - leftCount ||
					left.user.createdAt.getTime() - right.user.createdAt.getTime() ||
					left.user.id.localeCompare(right.user.id)
				);
			})[0];
			const accounts = group.profiles
				.map((profile) => {
					const value = counts.get(profile.userId)!;
					return {
						id: profile.user.id,
						login: profile.user.login,
						name: profile.user.name,
						studentNumber: profile.studentNumber,
						college: profile.college,
						major: profile.major,
						className: profile.className,
						disabled: profile.user.disabled,
						mergedIntoId: profile.user.mergedIntoId,
						createdAt: profile.user.createdAt.toISOString(),
						businessCounts: value.counts,
						businessTotal: value.total,
						recommended: profile.user.id === recommended.user.id,
						canDisable:
							!profile.user.disabled &&
							!profile.user.mergedIntoId &&
							value.total === 0 &&
							(unresolvedByUser.get(profile.userId) ?? 0) > 0,
					};
				})
				.sort(
					(left, right) =>
						Number(right.recommended) - Number(left.recommended) ||
						right.businessTotal - left.businessTotal ||
						left.createdAt.localeCompare(right.createdAt),
				);
			groups.push({
				key: `${group.classKey}\u0000${group.nameKey}`,
				classKey: group.classKey,
				nameKey: group.nameKey,
				name: group.profiles[0].user.name,
				college: group.college,
				major: group.major,
				className: group.className,
				status: unresolvedPairs === 0 ? "CONFIRMED" : "OPEN",
				unresolvedPairs,
				accounts,
			});
		}
		groups.sort(
			(left, right) =>
				Number(right.status === "OPEN") - Number(left.status === "OPEN") ||
				left.college.localeCompare(right.college) ||
				left.className.localeCompare(right.className) ||
				left.name.localeCompare(right.name),
		);
		return { groups, generatedAt: new Date().toISOString(), actorId };
	});
}

const disableSchema = z.object({
	studentId: z.string().min(1).max(100),
	keepId: z.string().min(1).max(100),
	reason: z.string().trim().min(10, "核对理由至少10个字").max(500),
}).strict();

export async function disableDuplicateAccount(sessionId: string, input: unknown) {
	const data = disableSchema.parse(input);
	return adminTransaction(sessionId, async (tx, actorId) => {
		if (data.studentId === data.keepId)
			throw new AccountError("保留账号与待停用账号不能相同");
		const [target, keep] = await Promise.all([
			tx.user.findUnique({
				where: { id: data.studentId },
				include: { studentProfile: true },
			}),
			tx.user.findUnique({
				where: { id: data.keepId },
				include: { studentProfile: true },
			}),
		]);
		if (
			!target ||
			target.role !== "STUDENT" ||
			!target.studentProfile ||
			!keep ||
			keep.role !== "STUDENT" ||
			!keep.studentProfile
		)
			throw new AccountError("待处置学生账号不存在", 404);
		if (target.disabled)
			throw new AccountError("该账号已停用，无需重复处置", 409);
		if (keep.disabled || keep.mergedIntoId)
			throw new AccountError("保留账号必须处于启用状态", 409);
		const targetKey = identityClassKey(target.studentProfile);
		const keepKey = identityClassKey(keep.studentProfile);
		if (
			targetKey !== keepKey ||
			identityNameKey(target.name) !== identityNameKey(keep.name)
		)
			throw new AccountError("只能处置同一班级的同名学生账号", 400);
		if (
			identityNumberKey(target.studentProfile.studentNumber) ===
			identityNumberKey(keep.studentProfile.studentNumber)
		)
			throw new AccountError("两个账号的学号相同，不能作为同班同名不同学号处理", 400);
		const identityIndex = await loadIdentityIndex(tx, [target.studentProfile]);
		const unresolved = identityIndex.candidatesFor({
			userId: target.id,
			studentNumber: target.studentProfile.studentNumber,
			name: target.name,
			classId: target.studentProfile.classId,
			college: target.studentProfile.college,
			major: target.studentProfile.major,
			className: target.studentProfile.className,
		});
		if (!unresolved.length)
			throw new AccountError("该组合已确认保留或不存在待处置的重复账号，不能按重复账号停用", 409);
		const counts = await businessCounts(tx, target.id);
		const businessTotal = total(counts);
		if (businessTotal > 0)
			throw new AccountError(
				`该账号仍关联 ${businessTotal} 条业务或历史记录，不能直接停用；请先核对并迁移业务记录后再处置`,
				409,
			);
		await tx.user.update({
			where: { id: target.id },
			data: {
				disabled: true,
				mergedIntoId: keep.id,
				authVersion: { increment: 1 },
				revision: { increment: 1 },
			},
		});
		await tx.authSession.updateMany({
			where: { userId: target.id, revokedAt: null },
			data: { revokedAt: new Date() },
		});
		await recordIdentityException(tx, {
			classKey: targetKey,
			name: target.name,
			studentNumberA: target.studentProfile.studentNumber,
			studentNumberB: keep.studentProfile.studentNumber,
			studentIdA: target.id,
			studentIdB: keep.id,
			actorId,
			reason: data.reason,
		});
		await tx.auditEvent.create({
			data: {
				actorId,
				action: "ACCOUNT_DUPLICATE_DISABLED",
				targetId: target.id,
				details: {
					keepId: keep.id,
					keepLogin: keep.login,
					targetLogin: target.login,
					reason: data.reason,
					businessCounts: counts,
				},
			},
		});
		return {
			targetId: target.id,
			keepId: keep.id,
			keepLogin: keep.login,
			targetLogin: target.login,
			status: "DISABLED",
		};
	});
}
