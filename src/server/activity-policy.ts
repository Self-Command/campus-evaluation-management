import { z } from "zod";
import type { Activity, Prisma, StudentProfile } from "@/generated/prisma/client";
import { AccountError } from "@/server/accounts";
import { adminTransaction } from "@/server/accounts";
import { termTransaction } from "@/server/terms";
import { issueFlowToken } from "@/server/flow-token";

export const classTargetSchema = z.object({ college: z.string().trim().min(1).max(80), major: z.string().trim().min(1).max(80), className: z.string().trim().min(1).max(80) }).strict();
export const audienceSchema = z.object({ colleges: z.array(z.string().trim().min(1).max(80)).max(500), classes: z.array(classTargetSchema).max(2000), studentIds: z.array(z.string().min(1).max(100)).max(2000) }).strict();
export type Audience = z.infer<typeof audienceSchema>;
export const emptyAudience: Audience = { colleges: [], classes: [], studentIds: [] };
export function classKey(profile: Pick<StudentProfile, "college" | "major" | "className">) { return JSON.stringify([profile.college, profile.major, profile.className]); }
export function normalizeAudience(raw: unknown) {
  const data = audienceSchema.parse(raw);
  return { colleges: [...new Set(data.colleges)].sort(), classes: [...new Map(data.classes.map(item => [classKey(item), item])).values()].sort((a, b) => classKey(a).localeCompare(classKey(b))), studentIds: [...new Set(data.studentIds)].sort() };
}
export function activityAudience(activity: Pick<Activity, "audienceColleges" | "audienceClasses" | "audienceStudents">): Audience {
  return { colleges: activity.audienceColleges, classes: activity.audienceClasses.map(key => { const [college, major, className] = JSON.parse(key) as string[]; return { college, major, className }; }), studentIds: activity.audienceStudents };
}
export function audienceFields(audience: Audience) { return { audienceColleges: audience.colleges, audienceClasses: audience.classes.map(classKey), audienceStudents: audience.studentIds }; }
export function eligible(activity: Pick<Activity, "audienceColleges" | "audienceClasses" | "audienceStudents">, student: { id: string; role: string; disabled: boolean; studentProfile: StudentProfile | null }) {
  return student.role === "STUDENT" && !student.disabled && !!student.studentProfile && activity.audienceColleges.includes(student.studentProfile.college) && activity.audienceClasses.includes(classKey(student.studentProfile)) && activity.audienceStudents.includes(student.id);
}
export function studentFeedWhere(student: { id: string; studentProfile: StudentProfile | null }): Prisma.ActivityWhereInput {
  if (!student.studentProfile) return { id: { in: [] } };
  return { publishedAt: { not: null }, confirmed: true, audienceColleges: { has: student.studentProfile.college }, audienceClasses: { has: classKey(student.studentProfile) }, audienceStudents: { has: student.id } };
}
export function canManageActivity(activity: Pick<Activity, "ownerId" | "collegeId">, actor: { id: string; role: string; collegeId?: string | null }) {
  if (actor.role === "ADMIN") return true;
  if (actor.role === "COLLEGE") return !!actor.collegeId && activity.collegeId === actor.collegeId;
  return actor.role === "PUBLISHER" && !!activity.collegeId && activity.ownerId === actor.id;
}
export function assertActivityManager(activity: Pick<Activity, "ownerId" | "collegeId">, actor: { id: string; role: string; collegeId?: string | null }) {
  if (!canManageActivity(activity, actor)) throw new AccountError("仅活动主办学院或受控历史经办人可维护参与信息和活动成绩", 403);
}
// Kept as an alias for legacy callers during the college-ownership migration.
export const assertActivityOwner = assertActivityManager;
export const audienceStudentSelect = { id: true, login: true, name: true, role: true, disabled: true, revision: true, studentProfile: true } as const;
export async function inspectAudience(tx: Prisma.TransactionClient, raw: unknown) {
  const audience = normalizeAudience(raw);
  const students = await tx.user.findMany({ where: { id: { in: audience.studentIds } }, select: audienceStudentSelect, orderBy: { id: "asc" } });
  const profiles = await tx.studentProfile.findMany({ where: { user: { role: "STUDENT", disabled: false } }, distinct: ["college", "major", "className"], select: { college: true, major: true, className: true } });
  const classKeys = new Set(profiles.map(classKey));
  const colleges = new Set(profiles.map(profile => profile.college));
  const errors: string[] = [];
  if (!audience.colleges.length || !audience.classes.length || !audience.studentIds.length) errors.push("学院、班级、学生三组均须至少选择一项");
  if (audience.colleges.some(college => !colleges.has(college))) errors.push("所选学院已无有效学生，请重新选择");
  if (audience.classes.some(item => !classKeys.has(classKey(item)) || !audience.colleges.includes(item.college))) errors.push("所选班级不存在或不属于已选学院，请修正冲突");
  const fields = audienceFields(audience);
  const matching = students.filter(student => eligible(fields, student));
  if (matching.length !== audience.studentIds.length) errors.push("部分所选学生已失效或不同时满足学院、班级条件，请修正选择");
  if (!matching.length) errors.push("当前范围没有符合全部条件的学生");
  return { audience, students, profiles: profiles.sort((a, b) => classKey(a).localeCompare(classKey(b))), matching, errors };
}
export function audienceTokenState(inspected: Awaited<ReturnType<typeof inspectAudience>>) { return { audience: inspected.audience, students: inspected.students }; }
export async function audienceAction(sessionId: string, input: unknown) {
  const data = z.object({ action: z.enum(["options", "preview"]), q: z.string().max(80).default(""), page: z.number().int().min(1).max(100000).default(1), termId: z.string().optional(), audience: audienceSchema.optional() }).parse(input);
  const operation = async (tx: Prisma.TransactionClient, actorId: string) => {
    if (data.action === "preview") {
      const inspected = await inspectAudience(tx, data.audience ?? emptyAudience);
      return { count: inspected.matching.length, students: inspected.matching.slice(0, 20).map(student => ({ id: student.id, name: student.name, login: student.login, ...student.studentProfile })), errors: inspected.errors, ...issueFlowToken(actorId, "ACTIVITY_AUDIENCE", audienceTokenState(inspected)) };
    }
    const scope = data.audience ? normalizeAudience(data.audience) : emptyAudience;
    const where: Prisma.UserWhereInput = { role: "STUDENT", disabled: false, studentProfile: { isNot: null }, ...(data.q ? { OR: [{ name: { contains: data.q, mode: "insensitive" } }, { login: { contains: data.q, mode: "insensitive" } }] } : {}), AND: [ ...(scope.colleges.length ? [{ studentProfile: { college: { in: scope.colleges } } }] : []), ...(scope.classes.length ? [{ OR: scope.classes.map(item => ({ studentProfile: item })) }] : []) ] };
    const [students, total, profiles] = await Promise.all([tx.user.findMany({ where, select: audienceStudentSelect, take: 20, skip: (data.page - 1) * 20, orderBy: [{ login: "asc" }, { id: "asc" }] }), tx.user.count({ where }), tx.studentProfile.findMany({ where: { user: { role: "STUDENT", disabled: false } }, distinct: ["college", "major", "className"], select: { college: true, major: true, className: true } })]);
    const selected = await tx.user.findMany({ where: { id: { in: scope.studentIds } }, select: audienceStudentSelect });
    return { colleges: [...new Set(profiles.map(item => item.college))].sort(), classes: profiles.sort((a, b) => classKey(a).localeCompare(classKey(b))), students: students.map(student => ({ id: student.id, name: student.name, login: student.login, college: student.studentProfile!.college, major: student.studentProfile!.major, className: student.studentProfile!.className })), selectedStudents: scope.studentIds.map(id => { const student = selected.find(item => item.id === id); return { id, name: student?.name ?? "学生已不存在", login: student?.login ?? "", college: student?.studentProfile?.college ?? "", major: student?.studentProfile?.major ?? "", className: student?.studentProfile?.className ?? "", invalid: !student || student.role !== "STUDENT" || student.disabled || !student.studentProfile }; }), total, page: data.page };
  };
  // Publishers may search the current valid directory solely to set activity targets.
  // A period transaction also revalidates the current role; no ADMIN bypass is needed.
  if (data.termId) return termTransaction(sessionId, data.termId, ["ADMIN", "COLLEGE", "PUBLISHER"], ["ACTIVE"], (tx, _term, actorId) => operation(tx, actorId));
  const { getCurrentSession } = await import("@/server/auth");
  const current = await getCurrentSession(sessionId);
  if (!current || !["ADMIN", "COLLEGE", "PUBLISHER"].includes(current.user.role) || current.user.mustChangePassword) throw new AccountError("没有活动范围设置权限", 403);
  if (current.user.role === "ADMIN") return adminTransaction(sessionId, operation);
  const { db } = await import("@/server/db");
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(72109312)`;
    const session = await tx.authSession.findUnique({ where: { id: sessionId }, include: { user: true } });
    if (!session || session.revokedAt || session.expiresAt <= new Date() || session.user.disabled || session.version !== session.user.authVersion || session.user.mustChangePassword || !["ADMIN", "COLLEGE", "PUBLISHER"].includes(session.user.role)) throw new AccountError("会话或活动范围设置权限已变化", 403);
    return operation(tx, session.userId);
  });
}
