import { z } from "zod";
import { AccountError } from "@/server/account-error";
import { scopedTransaction, scopedStudentWhere } from "@/server/access-scope";
import { profileSelect, configuredClass, classProfile, recordStudentAffiliation } from "@/server/organizations";
import type { Prisma } from "@/generated/prisma/client";

export const studentFilters = z.object({
  q: z.string().trim().max(80).default(""),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  college: z.string().trim().max(80).default(""),
  major: z.string().trim().max(80).default(""),
  className: z.string().trim().max(80).default(""),
  classId: z.string().trim().max(100).default(""),
});
export const studentDirectorySelect = {
  id: true, login: true, name: true, revision: true, disabled: true, createdAt: true,
  studentProfile: { select: profileSelect },
} as const;
export function studentScopeOptions(rows: { college: string; major: string; className: string }[], filters: { college: string; major: string }) {
  return {
    colleges: [...new Set(rows.map(row => row.college))].sort(),
    majors: [...new Set(rows.filter(row => !filters.college || row.college === filters.college).map(row => row.major))].sort(),
    classes: [...new Set(rows.filter(row => (!filters.college || row.college === filters.college) && (!filters.major || row.major === filters.major)).map(row => row.className))].sort(),
  };
}
export function studentDirectoryWhere(filters: z.infer<typeof studentFilters>, activeOnly = false): Prisma.UserWhereInput {
  return {
    role: "STUDENT", ...(activeOnly ? { disabled: false } : {}),
    studentProfile: { is: { ...(filters.college ? { college: filters.college } : {}), ...(filters.major ? { major: filters.major } : {}), ...(filters.className ? { className: filters.className } : {}), ...(filters.classId ? { classId: filters.classId } : {}) } },
    ...(filters.q ? { OR: [{ name: { contains: filters.q, mode: "insensitive" } }, { login: { contains: filters.q, mode: "insensitive" } }] } : {}),
  };
}
export async function pageStudents(sessionId: string, input: unknown) {
  const filters = studentFilters.parse(input);
  return scopedTransaction(sessionId, ["ADMIN", "COLLEGE", "COUNSELOR"], false, async (tx, actor) => {
    const scopeWhere = scopedStudentWhere(actor);
    const where = { AND: [scopeWhere, studentDirectoryWhere(filters)] };
    const [items, total, scope] = await Promise.all([
      tx.user.findMany({ where, select: studentDirectorySelect, orderBy: [{ login: "asc" }, { id: "asc" }], take: 20, skip: (filters.page - 1) * 20 }),
      tx.user.count({ where }),
      tx.studentProfile.findMany({ where: { user: scopeWhere }, select: { college: true, major: true, className: true }, distinct: ["college", "major", "className"] }),
    ]);
    return { items, total, page: filters.page, scopeOptions: studentScopeOptions(scope, filters) };
  });
}
const profileUpdate = z.object({
  revision: z.number().int().nonnegative(), reason: z.string().trim().min(2).max(500),
  name: z.string().trim().min(1).max(80), classId: z.string().trim().min(1).max(100),
}).strict();
export async function updateStudentProfile(sessionId: string, id: string, input: unknown) {
  const data = profileUpdate.parse(input);
  return scopedTransaction(sessionId, ["ADMIN", "COLLEGE"], true, async (tx, actor) => {
    const before = await tx.user.findFirst({ where: { AND: [scopedStudentWhere(actor), { id }] }, select: studentDirectorySelect });
    if (!before?.studentProfile) throw new AccountError("学生档案不存在", 404);
    if (before.revision !== data.revision) throw new AccountError("学生档案已变化，请刷新后重试", 409);
    const schoolClass = await configuredClass(tx, data.classId);
    if (actor.role !== "ADMIN" && schoolClass.major.collegeId !== actor.collegeId) throw new AccountError("不能转入其他学院的班级", 403);
    await tx.user.update({ where: { id }, data: { name: data.name, revision: { increment: 1 } } });
    await tx.studentProfile.update({ where: { userId: id }, data: classProfile(schoolClass) });
    if (before.studentProfile.classId !== schoolClass.id) await recordStudentAffiliation(tx, id, schoolClass, actor.id, data.reason);
    const updated = await tx.user.findUniqueOrThrow({ where: { id }, select: studentDirectorySelect });
    await tx.auditEvent.create({ data: { actorId: actor.id, action: "STUDENT_PROFILE_UPDATED", targetId: id, details: JSON.parse(JSON.stringify({ reason: data.reason, before: { name: before.name, profile: before.studentProfile }, after: { name: updated.name, profile: updated.studentProfile } })) } });
    return updated;
  });
}
