import type { Prisma } from "@/generated/prisma/client";

const ZERO_WIDTH = /[\u200B-\u200D\uFEFF]/g;
const WHITESPACE = /\s+/g;

export type IdentityClassRef = {
	classId: string | null;
	college: string;
	major: string;
	className: string;
};

export type IdentityStudentRef = IdentityClassRef & {
	userId?: string;
	studentNumber: string;
	name: string;
};

export type IdentityCandidate = {
	userId: string;
	login: string;
	name: string;
	studentNumber: string;
	disabled: boolean;
	createdAt: Date;
	likely: boolean;
};

export type IdentityIndex = {
	candidatesFor(ref: IdentityStudentRef): IdentityCandidate[];
	snapshot: { profiles: unknown[]; exceptions: unknown[] };
};

type RawCandidate = {
	userId: string;
	login: string;
	name: string;
	studentNumber: string;
	disabled: boolean;
	createdAt: Date;
	classId: string | null;
	college: string;
	major: string;
	className: string;
};

function normalizeText(value: string) {
	return value.normalize("NFKC").replace(ZERO_WIDTH, "").trim();
}

export function identityNameKey(value: string) {
	return normalizeText(value).replace(WHITESPACE, "").toLowerCase();
}

export function identityNumberKey(value: string) {
	return normalizeText(value).toLowerCase();
}

function orgKey(ref: IdentityClassRef) {
	return `org:${[
		normalizeText(ref.college).replace(WHITESPACE, " "),
		normalizeText(ref.major).replace(WHITESPACE, " "),
		normalizeText(ref.className).replace(WHITESPACE, " "),
	].join("\u001f")}`;
}

export function identityClassKey(ref: IdentityClassRef) {
	return ref.classId ? `id:${ref.classId}` : orgKey(ref);
}

function lookupKeys(ref: IdentityClassRef) {
	return ref.classId ? [`id:${ref.classId}`, orgKey(ref)] : [orgKey(ref)];
}

function bucketKey(classKey: string, nameKey: string) {
	return `${classKey}\u0000${nameKey}`;
}

function pairKey(classKey: string, nameKey: string, left: string, right: string) {
	const [a, b] = [identityNumberKey(left), identityNumberKey(right)].sort();
	return `${bucketKey(classKey, nameKey)}\u0000${a}\u0000${b}`;
}

// A single substitution/insertion/deletion is the common typo shape that
// produced the historical duplicate. This is a warning signal, not proof:
// administrators still need to review the candidate explicitly.
export function oneEditApart(left: string, right: string) {
	const a = identityNumberKey(left);
	const b = identityNumberKey(right);
	if (a === b || Math.abs(a.length - b.length) > 1) return false;
	let i = 0;
	let j = 0;
	let edits = 0;
	while (i < a.length && j < b.length) {
		if (a[i] === b[j]) {
			i++;
			j++;
			continue;
		}
		edits++;
		if (edits > 1) return false;
		if (a.length > b.length) i++;
		else if (b.length > a.length) j++;
		else {
			i++;
			j++;
		}
	}
	if (i < a.length || j < b.length) edits++;
	return edits <= 1;
}

export async function loadIdentityIndex(
	tx: Prisma.TransactionClient,
	refs: IdentityClassRef[],
): Promise<IdentityIndex> {
	const seeds = new Map<string, IdentityClassRef>();
	for (const ref of refs) {
		const key = bucketKey(identityClassKey(ref), "");
		if (!seeds.has(key)) seeds.set(key, ref);
	}
	if (!seeds.size) return { candidatesFor: () => [], snapshot: { profiles: [], exceptions: [] } };

	const where: Prisma.StudentProfileWhereInput[] = [];
	const seenWhere = new Set<string>();
	const classKeys = new Set<string>();
	for (const ref of seeds.values()) {
		classKeys.add(identityClassKey(ref));
		classKeys.add(orgKey(ref));
		const clauses: Prisma.StudentProfileWhereInput[] = [];
		if (ref.classId) clauses.push({ classId: ref.classId });
		clauses.push({
			classId: null,
			college: ref.college,
			major: ref.major,
			className: ref.className,
		});
		for (const clause of clauses) {
			const key = JSON.stringify(clause);
			if (!seenWhere.has(key)) {
				seenWhere.add(key);
				where.push(clause);
			}
		}
	}

	const profiles = await tx.studentProfile.findMany({
		where: { user: { role: "STUDENT" }, OR: where },
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
					role: true,
					createdAt: true,
				},
			},
		},
		orderBy: { userId: "asc" },
	});

	const exceptions = await tx.duplicateIdentityException.findMany({
		where: { classKey: { in: [...classKeys] } },
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

	const byKey = new Map<string, RawCandidate[]>();
	for (const profile of profiles) {
		if (profile.user.role !== "STUDENT") continue;
		const key = bucketKey(
			identityClassKey(profile),
			identityNameKey(profile.user.name),
		);
		const rows = byKey.get(key) ?? [];
		rows.push({
			userId: profile.userId,
			login: profile.user.login,
			name: profile.user.name,
			studentNumber: profile.studentNumber,
			disabled: profile.user.disabled,
			createdAt: profile.user.createdAt,
			classId: profile.classId,
			college: profile.college,
			major: profile.major,
			className: profile.className,
		});
		byKey.set(key, rows);
	}

	function candidatesFor(ref: IdentityStudentRef) {
		const nameKey = identityNameKey(ref.name);
		const numberKey = identityNumberKey(ref.studentNumber);
		const found = new Map<string, IdentityCandidate>();
		for (const classKey of lookupKeys(ref)) {
			for (const candidate of byKey.get(bucketKey(classKey, nameKey)) ?? []) {
				if (candidate.userId === ref.userId) continue;
				if (identityNumberKey(candidate.studentNumber) === numberKey) continue;
				const covered = lookupKeys(ref).some((key) =>
					resolved.has(
						pairKey(
							key,
							nameKey,
							candidate.studentNumber,
							ref.studentNumber,
						),
					),
				);
				if (covered) continue;
				found.set(candidate.userId, {
					userId: candidate.userId,
					login: candidate.login,
					name: candidate.name,
					studentNumber: candidate.studentNumber,
					disabled: candidate.disabled,
					createdAt: candidate.createdAt,
					likely: oneEditApart(candidate.studentNumber, ref.studentNumber),
				});
			}
		}
		return [...found.values()].sort(
			(a, b) =>
				Number(b.likely) - Number(a.likely) ||
				a.login.localeCompare(b.login),
		);
	}

	return {
		candidatesFor,
		snapshot: {
			profiles: profiles
				.map((profile) => ({
					userId: profile.userId,
					login: profile.user.login,
					name: profile.user.name,
					disabled: profile.user.disabled,
					studentNumber: profile.studentNumber,
					classId: profile.classId,
					college: profile.college,
					major: profile.major,
					className: profile.className,
				}))
				.sort((a, b) => a.userId.localeCompare(b.userId)),
			exceptions: exceptions
				.map((item) => ({
					classKey: item.classKey,
					normalizedName: item.normalizedName,
					studentNumberA: item.studentNumberA,
					studentNumberB: item.studentNumberB,
				}))
				.sort((a, b) =>
					`${a.classKey}:${a.normalizedName}:${a.studentNumberA}:${a.studentNumberB}`.localeCompare(
						`${b.classKey}:${b.normalizedName}:${b.studentNumberA}:${b.studentNumberB}`,
					),
				),
		},
	};
}

export function duplicateIdentityMessage(candidates: IdentityCandidate[]) {
	const likely = candidates.some((candidate) => candidate.likely);
	const examples = candidates
		.slice(0, 3)
		.map(
			(candidate) =>
				`${candidate.name}（${candidate.login}${candidate.disabled ? "，已停用" : ""}）`,
		)
		.join("、");
	return `${likely ? "疑似重复账号" : "同班同名账号"}：${examples}${candidates.length > 3 ? " 等" : ""}。请核对后选择跳过、保留双方并填写理由，或先在账号管理中处置重复账号。`;
}

export async function recordIdentityException(
	tx: Prisma.TransactionClient,
	input: {
		classKey: string;
		name: string;
		studentNumberA: string;
		studentNumberB: string;
		studentIdA?: string | null;
		studentIdB?: string | null;
		batchId?: string | null;
		actorId: string;
		reason: string;
	},
) {
	const [a, b] = [
		identityNumberKey(input.studentNumberA),
		identityNumberKey(input.studentNumberB),
	].sort();
	if (a === b) return;
	const [idA, idB] =
		identityNumberKey(input.studentNumberA) === a
			? [input.studentIdA ?? null, input.studentIdB ?? null]
			: [input.studentIdB ?? null, input.studentIdA ?? null];
	await tx.duplicateIdentityException.createMany({
		data: [
			{
				classKey: input.classKey,
				normalizedName: identityNameKey(input.name),
				studentNumberA: a,
				studentNumberB: b,
				studentIdA: idA,
				studentIdB: idB,
				batchId: input.batchId ?? null,
				actorId: input.actorId,
				reason: input.reason.trim(),
			},
		],
		skipDuplicates: true,
	});
}
