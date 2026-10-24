import { z } from "zod";
import { AccountError } from "@/server/account-error";
import { adminTransaction } from "@/server/accounts";
import { scopedTransaction, scopedStudentWhere } from "@/server/access-scope";
import { profileSelect, configuredClass, classProfile, recordStudentAffiliation } from "@/server/organizations";
import { duplicateIdentityMessage, identityClassKey, loadIdentityIndex, recordIdentityException } from "@/server/student-identity";
import type { Prisma } from "@/generated/prisma/client";
import { recordAudit } from "@/server/audit";

export const studentFilters = z.object({
  q: z.string().trim().max(80).default(""),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  college: z.string().trim().max(80).default(""),
  major: z.string().trim().max(80).default(""),
  className: z.string().trim().max(80).default(""),
  classId: z.string().trim().max(100).default(""),
});
export const studentDirectorySelect = {
  id: true, login: true, name: true, role: true, revision: true, disabled: true, createdAt: true,
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
  duplicateReason: z.string().trim().min(10, "核对理由至少10个字").max(500).optional(),
}).strict();
export async function updateStudentProfile(sessionId: string, id: string, input: unknown) {
  const data = profileUpdate.parse(input);
  return scopedTransaction(sessionId, ["ADMIN", "COLLEGE"], true, async (tx, actor) => {
    const before = await tx.user.findFirst({ where: { AND: [scopedStudentWhere(actor), { id }] }, select: studentDirectorySelect });
    if (!before?.studentProfile) throw new AccountError("学生档案不存在", 404);
    if (before.revision !== data.revision) throw new AccountError("学生档案已变化，请刷新后重试", 409);
    const schoolClass = await configuredClass(tx, data.classId);
    if (actor.role !== "ADMIN" && schoolClass.major.collegeId !== actor.collegeId) throw new AccountError("不能转入其他学院的班级", 403);
    const index = await loadIdentityIndex(tx, [{
      classId: schoolClass.id,
      college: schoolClass.major.college.name,
      major: schoolClass.major.name,
      className: schoolClass.name,
    }]);
    const identityCandidates = index.candidatesFor({
      userId: id,
      studentNumber: before.studentProfile.studentNumber,
      name: data.name,
      classId: schoolClass.id,
      college: schoolClass.major.college.name,
      major: schoolClass.major.name,
      className: schoolClass.name,
    });
    if (identityCandidates.length) {
      if (actor.role !== "ADMIN")
        throw new AccountError(`${duplicateIdentityMessage(identityCandidates)} 该情况需由学校管理员核对确认。`);
      if (!data.duplicateReason)
        throw new AccountError(`${duplicateIdentityMessage(identityCandidates)} 如确认是不同学生，请填写核对理由后再保存。`);
    }
    await tx.user.update({ where: { id }, data: { name: data.name, revision: { increment: 1 } } });
    await tx.studentProfile.update({ where: { userId: id }, data: classProfile(schoolClass) });
    if (before.studentProfile.classId !== schoolClass.id) await recordStudentAffiliation(tx, id, schoolClass, actor.id, data.reason);
    if (data.duplicateReason && identityCandidates.length) {
      const classKey = identityClassKey({
        classId: schoolClass.id,
        college: schoolClass.major.college.name,
        major: schoolClass.major.name,
        className: schoolClass.name,
      });
      for (const candidate of identityCandidates)
        await recordIdentityException(tx, {
          classKey,
          name: data.name,
          studentNumberA: before.studentProfile.studentNumber,
          studentNumberB: candidate.studentNumber,
          studentIdA: id,
          studentIdB: candidate.userId,
          actorId: actor.id,
          reason: data.duplicateReason,
        });
    }
    const updated = await tx.user.findUniqueOrThrow({ where: { id }, select: studentDirectorySelect });
    await recordAudit(tx, { actorId: actor.id, action: "STUDENT_PROFILE_UPDATED", targetId: id, details: JSON.parse(JSON.stringify({ reason: data.reason, duplicateCandidates: identityCandidates.map(candidate => candidate.login), duplicateReason: data.duplicateReason ?? null, before: { name: before.name, profile: before.studentProfile }, after: { name: updated.name, profile: updated.studentProfile } })) });
    return updated;
  });
}
const numberCorrection = z.object({
  revision: z.number().int().nonnegative(),
  studentNumber: z.string().trim().min(3, "学号至少3个字符").max(64, "学号最多64个字符").regex(/^[A-Za-z0-9._-]+$/, "学号仅允许字母、数字、点、下划线和连字符"),
  reason: z.string().trim().min(2, "请填写更正理由").max(500),
}).strict();
export async function correctStudentNumber(sessionId: string, id: string, input: unknown) {
  const data = numberCorrection.parse(input);
  return adminTransaction(sessionId, async (tx, actorId) => {
    const before = await tx.user.findUnique({ where: { id }, select: studentDirectorySelect });
    if (!before || before.role !== "STUDENT" || !before.studentProfile) throw new AccountError("学生档案不存在", 404);
    if (before.revision !== data.revision) throw new AccountError("学生档案已变化，请刷新后重试", 409);
    const loginOwner = await tx.user.findFirst({
      where: { login: { equals: data.studentNumber, mode: "insensitive" }, id: { not: id } },
      select: { id: true },
    });
    if (loginOwner) throw new AccountError("该学号已作为其他账号的登录名占用（不区分大小写）");
    const numberOwner = await tx.studentProfile.findFirst({
      where: { studentNumber: { equals: data.studentNumber, mode: "insensitive" }, userId: { not: id } },
      select: { userId: true },
    });
    if (numberOwner) throw new AccountError("该学号已被其他学生档案占用（不区分大小写）");
    await tx.user.update({ where: { id }, data: { login: data.studentNumber, revision: { increment: 1 }, authVersion: { increment: 1 } } });
    await tx.studentProfile.update({ where: { userId: id }, data: { studentNumber: data.studentNumber } });
    await tx.duplicateIdentityException.deleteMany({ where: { OR: [{ studentIdA: id }, { studentIdB: id }] } });
    await tx.authSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    const after = await tx.user.findUniqueOrThrow({ where: { id }, select: studentDirectorySelect });
    await recordAudit(tx, {
        actorId,
        action: "STUDENT_NUMBER_CORRECTED",
        targetId: id,
        details: JSON.parse(JSON.stringify({
          reason: data.reason,
          before: { login: before.login, studentNumber: before.studentProfile.studentNumber, profile: before.studentProfile },
          after: { login: after.login, studentNumber: after.studentProfile?.studentNumber, profile: after.studentProfile },
        })),
      });
    return after;
  });
}
