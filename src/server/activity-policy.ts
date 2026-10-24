import { z } from "zod";
import type { Activity, Prisma, StudentProfile } from "@/generated/prisma/client";
import { AccountError } from "@/server/accounts";
import { adminTransaction } from "@/server/accounts";
import { termTransaction } from "@/server/terms";

export const classTargetSchema = z
	.object({
		college: z.string().trim().min(1).max(80),
		major: z.string().trim().min(1).max(80),
		className: z.string().trim().min(1).max(80),
	})
	.strict();
export const audienceScopeSchema = z.enum(["ALL", "COLLEGE", "CLASS"]);
export const audienceSchema = z
	.object({
		scope: audienceScopeSchema,
		colleges: z.array(z.string().trim().min(1).max(80)).max(500),
		classes: z.array(classTargetSchema).max(2000),
	})
	.strict();
export type Audience = z.infer<typeof audienceSchema>;
export const emptyAudience: Audience = {
	scope: "COLLEGE",
	colleges: [],
	classes: [],
};
export function classKey(
	profile: Pick<StudentProfile, "college" | "major" | "className">,
) {
	return JSON.stringify([profile.college, profile.major, profile.className]);
}
export function normalizeAudience(raw: unknown): Audience {
	const data = audienceSchema.parse(raw);
	return {
		scope: data.scope,
		colleges:
			data.scope === "COLLEGE"
				? [...new Set(data.colleges)].sort()
				: [],
		classes:
			data.scope === "CLASS"
				? [
						...new Map(
							data.classes.map((item) => [classKey(item), item]),
						).values(),
					].sort((a, b) => classKey(a).localeCompare(classKey(b)))
				: [],
	};
}
type StoredAudience = Pick<
	Activity,
	"audienceScope" | "audienceColleges" | "audienceClasses"
>;
export function activityAudience(activity: StoredAudience): Audience {
	return {
		scope: activity.audienceScope,
		colleges:
			activity.audienceScope === "COLLEGE"
				? activity.audienceColleges
				: [],
		classes:
			activity.audienceScope === "CLASS"
				? activity.audienceClasses.flatMap((key) => {
						try {
							const [college, major, className] = JSON.parse(
								key,
							) as string[];
							if (!college || !major || !className) return [];
							return [{ college, major, className }];
						} catch {
							return [];
						}
					})
				: [],
	};
}
export function audienceFields(audience: Audience) {
	return {
		audienceScope: audience.scope,
		audienceColleges:
			audience.scope === "COLLEGE" ? audience.colleges : [],
		audienceClasses:
			audience.scope === "CLASS"
				? audience.classes.map(classKey)
				: [],
	};
}
export function inActivityAudience(
	activity: StoredAudience,
	profile: Pick<StudentProfile, "college" | "major" | "className">,
) {
	if (activity.audienceScope === "ALL") return true;
	if (activity.audienceScope === "COLLEGE")
		return activity.audienceColleges.includes(profile.college);
	return activity.audienceClasses.includes(classKey(profile));
}
export function eligible(
	activity: StoredAudience,
	student: {
		role: string;
		disabled: boolean;
		studentProfile: StudentProfile | null;
	},
) {
	return (
		student.role === "STUDENT" &&
		!student.disabled &&
		!!student.studentProfile &&
		inActivityAudience(activity, student.studentProfile)
	);
}
export function studentEligibleWhere(student: {
	studentProfile: StudentProfile | null;
}): Prisma.ActivityWhereInput {
	if (!student.studentProfile) return { id: { in: [] } };
	return {
		publishedAt: { not: null },
		confirmed: true,
		OR: [
			{ audienceScope: "ALL" },
			{
				audienceScope: "COLLEGE",
				audienceColleges: { has: student.studentProfile.college },
			},
			{
				audienceScope: "CLASS",
				audienceClasses: { has: classKey(student.studentProfile) },
			},
		],
	};
}
// Feed only lists activities that are running right now. Detail visibility keeps
// using studentEligibleWhere so past participations remain reachable.
export function studentFeedWhere(
	student: { studentProfile: StudentProfile | null },
	now = new Date(),
): Prisma.ActivityWhereInput {
	const eligible = studentEligibleWhere(student);
	if (!student.studentProfile) return eligible;
	return {
		...eligible,
		endedAt: null,
		startsAt: { lte: now },
		endsAt: { gte: now },
	};
}
export function canManageActivity(
	activity: Pick<Activity, "ownerId" | "collegeId">,
	actor: { id: string; role: string; collegeId?: string | null },
) {
	if (actor.role === "ADMIN") return true;
	if (actor.role === "COLLEGE")
		return !!actor.collegeId && activity.collegeId === actor.collegeId;
	return (
		actor.role === "PUBLISHER" &&
		!!activity.collegeId &&
		activity.ownerId === actor.id
	);
}
export function assertActivityManager(
	activity: Pick<Activity, "ownerId" | "collegeId">,
	actor: { id: string; role: string; collegeId?: string | null },
) {
	if (!canManageActivity(activity, actor))
		throw new AccountError(
			"仅活动主办学院或受控历史经办人可维护参与信息和活动成绩",
			403,
		);
}
// Kept as an alias for legacy callers during the college-ownership migration.
export const assertActivityOwner = assertActivityManager;

function audienceStudentWhere(audience: Audience): Prisma.UserWhereInput {
	if (audience.scope === "ALL")
		return {
			role: "STUDENT",
			disabled: false,
			studentProfile: { isNot: null },
		};
	if (audience.scope === "COLLEGE")
		return {
			role: "STUDENT",
			disabled: false,
			studentProfile: {
				is: { college: { in: audience.colleges } },
			},
		};
	return {
		role: "STUDENT",
		disabled: false,
		studentProfile: {
			is: {
				OR: audience.classes.map((item) => ({
					college: item.college,
					major: item.major,
					className: item.className,
				})),
			},
		},
	};
}

export async function inspectAudience(
	tx: Prisma.TransactionClient,
	raw: unknown,
) {
	const audience = normalizeAudience(raw);
	const profiles = await tx.studentProfile.findMany({
		where: { user: { role: "STUDENT", disabled: false } },
		distinct: ["college", "major", "className"],
		select: { college: true, major: true, className: true },
	});
	const classKeys = new Set(profiles.map(classKey));
	const colleges = new Set(profiles.map((profile) => profile.college));
	const errors: string[] = [];
	if (audience.scope === "COLLEGE") {
		if (!audience.colleges.length) errors.push("请至少选择一个学院");
		else if (audience.colleges.some((college) => !colleges.has(college)))
			errors.push("所选学院已无有效学生，请重新选择");
	} else if (audience.scope === "CLASS") {
		if (!audience.classes.length) errors.push("请至少选择一个班级");
		else if (
			audience.classes.some((item) => !classKeys.has(classKey(item)))
		)
			errors.push("所选班级已无有效学生，请重新选择");
	}
	const count = await tx.user.count({ where: audienceStudentWhere(audience) });
	const matched = profiles.filter((profile) =>
		inActivityAudience(
			{
				audienceScope: audience.scope,
				audienceColleges: audience.colleges,
				audienceClasses: audience.classes.map(classKey),
			},
			profile,
		),
	);
	if (!count && !errors.length)
		errors.push("当前范围没有符合条件的学生");
	return {
		audience,
		profiles: profiles.sort((a, b) => classKey(a).localeCompare(classKey(b))),
		count,
		collegeCount: new Set(matched.map((profile) => profile.college)).size,
		majorCount: new Set(
			matched.map((profile) => JSON.stringify([profile.college, profile.major])),
		).size,
		classCount: new Set(matched.map(classKey)).size,
		errors,
	};
}
export async function audienceAction(sessionId: string, input: unknown) {
	const data = z
		.object({
			action: z.enum(["options", "preview"]),
			termId: z.string().optional(),
			audience: audienceSchema.optional(),
		})
		.parse(input);
	const operation = async (tx: Prisma.TransactionClient) => {
		if (data.action === "preview") {
			const inspected = await inspectAudience(
				tx,
				data.audience ?? emptyAudience,
			);
			return {
				count: inspected.count,
				collegeCount: inspected.collegeCount,
				majorCount: inspected.majorCount,
				classCount: inspected.classCount,
				errors: inspected.errors,
			};
		}
		const profiles = await tx.studentProfile.findMany({
			where: { user: { role: "STUDENT", disabled: false } },
			distinct: ["college", "major", "className"],
			select: { college: true, major: true, className: true },
		});
		return {
			colleges: [...new Set(profiles.map((item) => item.college))].sort(),
			classes: profiles.sort((a, b) => classKey(a).localeCompare(classKey(b))),
		};
	};
	if (data.termId)
		return termTransaction(
			sessionId,
			data.termId,
			["ADMIN", "COLLEGE", "PUBLISHER"],
			["ACTIVE"],
			operation,
		);
	const { getCurrentSession } = await import("@/server/auth");
	const current = await getCurrentSession(sessionId);
	if (
		!current ||
		!["ADMIN", "COLLEGE", "PUBLISHER"].includes(current.user.role) ||
		current.user.mustChangePassword
	)
		throw new AccountError("没有活动范围设置权限", 403);
	if (current.user.role === "ADMIN")
		return adminTransaction(sessionId, operation);
	const { db } = await import("@/server/db");
	return db.$transaction(async (tx) => {
		await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(72109312)`;
		const session = await tx.authSession.findUnique({
			where: { id: sessionId },
			include: { user: true },
		});
		if (
			!session ||
			session.revokedAt ||
			session.expiresAt <= new Date() ||
			session.user.disabled ||
			session.version !== session.user.authVersion ||
			session.user.mustChangePassword ||
			!["ADMIN", "COLLEGE", "PUBLISHER"].includes(session.user.role)
		)
			throw new AccountError("会话或活动范围设置权限已变化", 403);
		return operation(tx);
	});
}
