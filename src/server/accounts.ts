import { randomBytes } from "node:crypto";
import { hash } from "bcryptjs";
import { z } from "zod";
import { db } from "@/server/db";
import { getCurrentSession } from "@/server/auth";
import type { AccountUsage, ManagementBlocker } from "@/lib/management-types";
import type { Prisma } from "@/generated/prisma/client";
import { AccountError } from "@/server/account-error";
import { scopedTransaction, scopedStudentWhere } from "@/server/access-scope";
import { configuredClass, classProfile, profileSelect, recordStudentAffiliation } from "@/server/organizations";
import { duplicateIdentityMessage, identityClassKey, loadIdentityIndex, recordIdentityException, type IdentityCandidate } from "@/server/student-identity";
import { recordAudit } from "@/server/audit";
export { AccountError } from "@/server/account-error";

const text = z.string().trim().min(1, "此项不能为空").max(80, "最多80个字符");
export const accountSchema = z.object({
  name: text,
  login: z.string().trim().min(3).max(64).regex(/^[A-Za-z0-9._-]+$/, "账号仅允许字母、数字、点、下划线和连字符"),
  role: z.enum(["ADMIN", "COLLEGE", "COUNSELOR", "STUDENT"]),
  collegeId: z.string().trim().max(100).optional(),
  classId: z.string().trim().max(100).optional(),
  duplicateReason: z.string().trim().min(10, "核对理由至少10个字").max(500).optional(),
}).strict().superRefine((v, ctx) => {
  if ((v.role === "COLLEGE" || v.role === "COUNSELOR") && !v.collegeId) ctx.addIssue({ code: "custom", path: ["collegeId"], message: "请选择所属学院" });
  if (v.role !== "STUDENT" && v.classId) ctx.addIssue({ code: "custom", path: ["classId"], message: "该身份不使用学生班级归属" });
  if (v.role !== "COLLEGE" && v.role !== "COUNSELOR" && v.collegeId) ctx.addIssue({ code: "custom", path: ["collegeId"], message: "学生学院由班级推导，管理员无需学院归属" });
});
const publicSelect = { id: true, login: true, name: true, role: true, disabled: true, mustChangePassword: true, revision: true, createdAt: true, collegeId: true,
  college: { select: { id: true, name: true, code: true, enabled: true } }, studentProfile: { select: profileSelect } } as const;
export type AccountView = Prisma.UserGetPayload<{ select: typeof publicSelect }>;

export async function adminTransaction<T>(sessionId: string, operation: (tx: Prisma.TransactionClient, actorId: string) => Promise<T>) {
  return db.$transaction(async tx => {
    // Serialize account administration and recheck identity inside the write transaction.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(72109312)`;
    const session = await tx.authSession.findUnique({ where: { id: sessionId }, include: { user: true } });
    if (!session || session.revokedAt || session.expiresAt <= new Date() || session.user.disabled || session.version !== session.user.authVersion) throw new AccountError("会话已失效，请重新登录", 401);
    if (session.user.role !== "ADMIN" || session.user.mustChangePassword) throw new AccountError("没有管理权限", 403);
    return operation(tx, session.userId);
  });
}
export async function listAccounts(sessionId: string, query: string, page: number, filters: { role?: "ADMIN" | "PUBLISHER" | "STUDENT" | "COLLEGE" | "COUNSELOR"; disabled?: boolean } = {}) {
  const current = await getCurrentSession(sessionId);
  if (!current || current.user.role !== "ADMIN" || current.user.mustChangePassword) throw new AccountError("没有管理权限", 403);
  z.number().int().min(1).max(100000).parse(page);
  const selected = z.object({ role: z.enum(["ADMIN", "PUBLISHER", "STUDENT", "COLLEGE", "COUNSELOR"]).optional(), disabled: z.boolean().optional() }).parse(filters);
  const where: Prisma.UserWhereInput = { ...selected, ...(query ? { OR: [{ name: { contains: query, mode: "insensitive" } }, { login: { contains: query, mode: "insensitive" } }, { studentProfile: { college: { contains: query, mode: "insensitive" } } }, { studentProfile: { className: { contains: query, mode: "insensitive" } } }] } : {}) };
  const [items, total] = await db.$transaction([db.user.findMany({ where, select: publicSelect, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 20, skip: (page - 1) * 20 }), db.user.count({ where })]);
  return { items, total, page };
}
export async function createAccount(sessionId: string, input: unknown) {
  const data = accountSchema.parse(input);
  if (data.role === "STUDENT" && !data.classId) throw new AccountError("请选择已配置的班级");
  const password = `Init!${randomBytes(18).toString("base64url")}7a`;
  const passwordHash = await hash(password, 12);
  return adminTransaction(sessionId, async (tx, actorId) => {
    const schoolClass = data.role === "STUDENT" ? await configuredClass(tx, data.classId!) : null;
    await validateStaffCollege(tx, data);
    await assertLoginAvailable(tx, data.login);
    let identityCandidates: IdentityCandidate[] = [];
    if (schoolClass) {
      const index = await loadIdentityIndex(tx, [{
        classId: schoolClass.id,
        college: schoolClass.major.college.name,
        major: schoolClass.major.name,
        className: schoolClass.name,
      }]);
      identityCandidates = index.candidatesFor({
        studentNumber: data.login,
        name: data.name,
        classId: schoolClass.id,
        college: schoolClass.major.college.name,
        major: schoolClass.major.name,
        className: schoolClass.name,
      });
      if (identityCandidates.length && !data.duplicateReason)
        throw new AccountError(`${duplicateIdentityMessage(identityCandidates)} 如确认是不同学生，请通过账号导入填写核对理由后建立账号。`);
    }
    const user = await tx.user.create({ data: { name: data.name, login: data.login, role: data.role, collegeId: data.collegeId || null, passwordHash, studentProfile: schoolClass ? { create: { studentNumber: data.login, ...classProfile(schoolClass) } } : undefined }, select: publicSelect });
    if (schoolClass) await recordStudentAffiliation(tx, user.id, schoolClass, actorId, "学生建档");
    if (schoolClass && data.duplicateReason && identityCandidates.length) {
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
          studentNumberA: data.login,
          studentNumberB: candidate.studentNumber,
          studentIdA: user.id,
          studentIdB: candidate.userId,
          actorId,
          reason: data.duplicateReason,
        });
    }
    await recordAudit(tx, { actorId, action: "ACCOUNT_CREATED", targetId: user.id, details: JSON.parse(JSON.stringify({ login: user.login, role: user.role, name: user.name, profile: user.studentProfile, collegeId: user.collegeId, duplicateCandidates: identityCandidates.map(candidate => candidate.login), duplicateReason: data.duplicateReason ?? null })) });
    return { user, initialPassword: password };
  });
}
async function validateStaffCollege(tx: Prisma.TransactionClient, account: z.infer<typeof accountSchema>) {
  if (account.role === "COLLEGE" || account.role === "COUNSELOR") {
    const college = await tx.college.findUnique({ where: { id: account.collegeId! } });
    if (!college?.enabled) throw new AccountError("请选择已启用的学院");
  }
}
async function assertLoginAvailable(tx: Prisma.TransactionClient, login: string, excludeId?: string) {
  const owner = await tx.user.findFirst({
    where: { login: { equals: login, mode: "insensitive" }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true },
  });
  if (owner) throw new AccountError("登录账号已被其他账号占用（不区分大小写）");
}
const accountDeletionSelect = {
  id: true,
  login: true,
  name: true,
  role: true,
  disabled: true,
  revision: true,
  collegeId: true,
  mergedIntoId: true,
  college: { select: { name: true } },
  studentProfile: { select: { studentNumber: true, classId: true, college: true, major: true, className: true } },
} as const;
type AccountDeletionTarget = Prisma.UserGetPayload<{ select: typeof accountDeletionSelect }>;

async function studentBusinessCounts(tx: Prisma.TransactionClient, studentId: string) {
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
    evidence,
    activityEvidence,
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
    tx.evidence.count({ where: { ownerId: studentId } }),
    tx.activityEvidence.count({ where: { uploadedBy: studentId } }),
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
    evidence,
    activityEvidence,
  };
}

const studentBusinessLabels: [keyof Awaited<ReturnType<typeof studentBusinessCounts>>, string][] = [
  ["grades", "成绩录入"],
  ["deductions", "扣分记录"],
  ["participations", "活动参与"],
  ["claims", "个人申报"],
  ["confirmations", "结果确认"],
  ["appeals", "成绩申诉"],
  ["publishedResults", "发布结果"],
  ["gradeChanges", "成绩更正"],
  ["deductionChanges", "扣分更正"],
  ["recognitionSources", "认定来源"],
  ["evidence", "证明附件"],
  ["activityEvidence", "活动证明上传记录"],
];

async function accountDeletionState(
  tx: Prisma.TransactionClient,
  user: AccountDeletionTarget,
  actorId: string,
) {
  const blockers: ManagementBlocker[] = [];
  const notes: string[] = [];
  const businessHint = "已有业务记录时不能删除，可停用账号保留历史";
  if (user.id === actorId) blockers.push({ key: "self", label: "当前登录账号", count: 1, hint: "不能删除当前登录账号" });
  if (user.role === "ADMIN" && !user.disabled) {
    const activeAdmins = await tx.user.count({ where: { role: "ADMIN", disabled: false } });
    if (activeAdmins <= 1) blockers.push({ key: "lastAdmin", label: "启用中的管理员", count: 1, hint: "必须至少保留一个启用中的管理员" });
  }
  const [mergedFrom, profileCount, affiliationCount, sessionCount] = await Promise.all([
    tx.user.count({ where: { mergedIntoId: user.id } }),
    tx.studentProfile.count({ where: { userId: user.id } }),
    tx.studentAffiliation.count({ where: { studentId: user.id } }),
    tx.authSession.count({ where: { userId: user.id } }),
  ]);
  if (user.mergedIntoId || mergedFrom)
    blockers.push({ key: "merged", label: "账号合并关系", count: user.mergedIntoId ? mergedFrom + 1 : mergedFrom, hint: "该账号存在合并关系，只能停用" });
  if (user.role === "STUDENT" || profileCount) {
    const counts = await studentBusinessCounts(tx, user.id);
    for (const [key, label] of studentBusinessLabels) {
      if (counts[key]) blockers.push({ key, label, count: counts[key], hint: businessHint });
    }
    if (profileCount)
      notes.push(`将同时删除学生档案${affiliationCount ? `和 ${affiliationCount} 条学籍变更记录` : ""}，删除前写入审计。`);
  } else {
    const [evidence, activityEvidence] = await Promise.all([
      tx.evidence.count({ where: { ownerId: user.id } }),
      tx.activityEvidence.count({ where: { uploadedBy: user.id } }),
    ]);
    if (evidence) blockers.push({ key: "evidence", label: "证明附件", count: evidence, hint: "请先处理证明附件" });
    if (activityEvidence) blockers.push({ key: "activityEvidence", label: "活动证明上传记录", count: activityEvidence, hint: "请先处理活动证明" });
  }
  if (user.role !== "STUDENT") {
    const [classes, assignments, activities, operations] = await Promise.all([
      tx.schoolClass.count({ where: { counselorId: user.id } }),
      tx.classCounselorAssignment.count({ where: { counselorId: user.id } }),
      tx.activity.count({ where: { ownerId: user.id } }),
      tx.auditEvent.count({
        where: {
          actorId: user.id,
          action: { notIn: ["LOGIN", "PASSWORD_CHANGED", "SELF_ACCOUNT_UPDATED"] },
        },
      }),
    ]);
    if (classes) blockers.push({ key: "classes", label: "负责班级", count: classes, hint: "请先在学院与班级中交接班级" });
    if (assignments) blockers.push({ key: "assignments", label: "辅导员交接记录", count: assignments, hint: "有辅导员交接历史，只能停用账号" });
    if (activities) blockers.push({ key: "activities", label: "负责活动", count: activities, hint: "请先交接或结束其负责的活动" });
    if (operations) blockers.push({ key: "operations", label: "管理操作记录", count: operations, hint: "该账号参与过审核、导入或评分等管理操作，只能停用" });
  }
  return { blockers, notes, profileCount, affiliationCount, sessionCount };
}

export async function accountRemovalCheck(tx: Prisma.TransactionClient, userId: string, actorId: string) {
  const user = await tx.user.findUnique({ where: { id: userId }, select: accountDeletionSelect });
  if (!user) return null;
  return { user, ...(await accountDeletionState(tx, user, actorId)) };
}

export async function accountUsage(sessionId: string, idInput: string): Promise<AccountUsage> {
  const current = await getCurrentSession(sessionId);
  if (!current || current.user.role !== "ADMIN" || current.user.mustChangePassword) throw new AccountError("没有管理权限", 403);
  const id = z.string().trim().min(1).max(100).parse(idInput);
  return db.$transaction(async tx => {
    const user = await tx.user.findUnique({ where: { id }, select: accountDeletionSelect });
    if (!user) throw new AccountError("账号不存在", 404);
    const state = await accountDeletionState(tx, user, current.user.id);
    return {
      id: user.id,
      login: user.login,
      name: user.name,
      role: user.role,
      disabled: user.disabled,
      revision: user.revision,
      collegeName: user.college?.name ?? null,
      className: user.studentProfile?.className ?? null,
      canDelete: state.blockers.length === 0,
      blockers: state.blockers,
      notes: state.notes,
    };
  });
}

const accountDeleteSchema = z.object({
  revision: z.number().int().nonnegative(),
  reason: z.string().trim().min(2, "请填写删除理由").max(500),
  confirmLogin: z.string().trim().min(1).max(64),
}).strict();

async function removeAccountInTransaction(
  tx: Prisma.TransactionClient,
  id: string,
  data: z.infer<typeof accountDeleteSchema>,
  actorId: string,
  expectedRole?: "STUDENT",
) {
  const user = await tx.user.findUnique({ where: { id }, select: accountDeletionSelect });
  if (!user) throw new AccountError("账号不存在", 404);
  if (expectedRole && user.role !== expectedRole) throw new AccountError("该账号不是学生账号", 409);
  if (user.revision !== data.revision) throw new AccountError("账号已被修改，请刷新后重试", 409);
  if (user.login !== data.confirmLogin) throw new AccountError("请输入完整的登录账号以确认删除");
  const state = await accountDeletionState(tx, user, actorId);
  if (state.blockers.length) {
    const detail = state.blockers.map(item => `${item.label} ${item.count}`).join("，");
    const hint = state.blockers.find(item => item.hint)?.hint;
    throw new AccountError(`不能删除：仍有${detail}。${hint ?? "请先处理关联数据"}`, 409);
  }
  await recordAudit(tx, {
      actorId,
      action: "ACCOUNT_DELETED",
      targetId: user.id,
      details: JSON.parse(JSON.stringify({
        reason: data.reason,
        confirmLogin: data.confirmLogin,
        before: user,
        cleaned: { profileCount: state.profileCount, affiliationCount: state.affiliationCount, sessionCount: state.sessionCount },
      })),
    });
  await tx.studentAffiliation.deleteMany({ where: { studentId: user.id } });
  await tx.duplicateIdentityException.deleteMany({ where: { OR: [{ studentIdA: user.id }, { studentIdB: user.id }] } });
  await tx.studentProfile.deleteMany({ where: { userId: user.id } });
  await tx.authSession.deleteMany({ where: { userId: user.id } });
  await tx.user.delete({ where: { id: user.id } });
  return { id: user.id, login: user.login, name: user.name, deleted: true };
}

export async function deleteAccount(sessionId: string, id: string, input: unknown) {
  const data = accountDeleteSchema.parse(input);
  return adminTransaction(sessionId, (tx, actorId) => removeAccountInTransaction(tx, id, data, actorId));
}

export async function deleteStudentAccount(sessionId: string, id: string, input: unknown) {
  const data = accountDeleteSchema.parse(input);
  return adminTransaction(sessionId, (tx, actorId) => removeAccountInTransaction(tx, id, data, actorId, "STUDENT"));
}

const updateSchema = z.object({ revision: z.number().int().nonnegative(), reason: z.string().trim().min(2).max(500), disabled: z.boolean(), account: accountSchema }).strict();
export async function updateAccount(sessionId: string, id: string, input: unknown) {
  const { revision, reason, disabled, account } = updateSchema.parse(input);
  return adminTransaction(sessionId, async (tx, actorId) => {
    const previous = await tx.user.findUnique({ where: { id }, select: publicSelect });
    if (!previous) throw new AccountError("账号不存在", 404);
    if (previous.revision !== revision) throw new AccountError("账号已被修改，请刷新后重试", 409);
    if (id === actorId && (disabled || account.role !== "ADMIN")) throw new AccountError("不能停用自身账号或移除自身管理员权限");
    if (previous.studentProfile && account.login !== previous.login) throw new AccountError("已有学生档案的学号不可更改");
    await validateStaffCollege(tx, account);
    await assertLoginAvailable(tx, account.login, id);
    const classId = account.classId || (previous.role === "STUDENT" ? previous.studentProfile?.classId : null);
    if (account.role === "STUDENT" && !classId && previous.role !== "STUDENT") throw new AccountError("请选择已配置的班级");
    const schoolClass = account.role === "STUDENT" && classId ? await configuredClass(tx, classId) : null;
    const collegeId = account.collegeId || null;
    let identityCandidates: IdentityCandidate[] = [];
    if (schoolClass) {
      const index = await loadIdentityIndex(tx, [{
        classId: schoolClass.id,
        college: schoolClass.major.college.name,
        major: schoolClass.major.name,
        className: schoolClass.name,
      }]);
      identityCandidates = index.candidatesFor({
        userId: id,
        studentNumber: previous.studentProfile?.studentNumber ?? account.login,
        name: account.name,
        classId: schoolClass.id,
        college: schoolClass.major.college.name,
        major: schoolClass.major.name,
        className: schoolClass.name,
      });
      if (identityCandidates.length && !account.duplicateReason)
        throw new AccountError(`${duplicateIdentityMessage(identityCandidates)} 如确认是不同学生，请填写核对理由后再保存。`);
    }
    if (previous.role === "COUNSELOR" && (account.role !== "COUNSELOR" || previous.collegeId !== collegeId || disabled)) {
      if (await tx.schoolClass.count({ where: { counselorId: id } })) throw new AccountError("请先交接该辅导员负责的全部班级");
    }
    const leavingStudent = previous.role === "STUDENT" && account.role !== "STUDENT";
    if (leavingStudent) {
      const counts = await studentBusinessCounts(tx, id);
      const active = studentBusinessLabels.filter(([key]) => counts[key] > 0).map(([key, label]) => `${label} ${counts[key]}`);
      if (active.length)
        throw new AccountError(`该学生已有业务记录（${active.join("，")}），不能改为其他身份；请保留学生身份或先处理业务数据。`);
    }
    const authChanged = previous.role !== account.role || previous.disabled !== disabled || previous.collegeId !== collegeId;
    let studentCleanup: { profileRemoved: boolean; affiliationsRemoved: number } | null = null;
    await tx.user.update({ where: { id }, data: { name: account.name, login: account.login, role: account.role, collegeId, disabled, revision: { increment: 1 }, authVersion: authChanged ? { increment: 1 } : undefined }, select: publicSelect });
    if (schoolClass) {
      await tx.studentProfile.upsert({ where: { userId: id }, create: { userId: id, studentNumber: account.login, ...classProfile(schoolClass) }, update: classProfile(schoolClass) });
      if (previous.role !== "STUDENT" || previous.studentProfile?.classId !== schoolClass.id) await recordStudentAffiliation(tx, id, schoolClass, actorId, reason);
      if (account.duplicateReason && identityCandidates.length) {
        const classKey = identityClassKey({
          classId: schoolClass.id,
          college: schoolClass.major.college.name,
          major: schoolClass.major.name,
          className: schoolClass.name,
        });
        for (const candidate of identityCandidates)
          await recordIdentityException(tx, {
            classKey,
            name: account.name,
            studentNumberA: previous.studentProfile?.studentNumber ?? account.login,
            studentNumberB: candidate.studentNumber,
            studentIdA: id,
            studentIdB: candidate.userId,
            actorId,
            reason: account.duplicateReason,
          });
      }
    } else if (leavingStudent) {
      const affiliations = await tx.studentAffiliation.deleteMany({ where: { studentId: id } });
      await tx.duplicateIdentityException.deleteMany({ where: { OR: [{ studentIdA: id }, { studentIdB: id }] } });
      const profiles = await tx.studentProfile.deleteMany({ where: { userId: id } });
      studentCleanup = { profileRemoved: profiles.count > 0, affiliationsRemoved: affiliations.count };
    }
    if (authChanged) await tx.authSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    const updated = await tx.user.findUniqueOrThrow({ where: { id }, select: publicSelect });
    await recordAudit(tx, { actorId, action: "ACCOUNT_UPDATED", targetId: id, details: JSON.parse(JSON.stringify({ reason, duplicateCandidates: identityCandidates.map(candidate => candidate.login), duplicateReason: account.duplicateReason ?? null, before: { name: previous.name, role: previous.role, collegeId: previous.collegeId, login: previous.login, disabled: previous.disabled, profile: previous.studentProfile }, after: { name: updated.name, role: updated.role, collegeId: updated.collegeId, login: updated.login, disabled: updated.disabled, profile: updated.studentProfile }, studentCleanup })) });
    return updated;
  });
}
export async function resetAccountPassword(sessionId: string, id: string, input: unknown) {
  const { revision, reason } = z.object({ revision: z.number().int().nonnegative(), reason: z.string().trim().min(2).max(500) }).parse(input);
  const password = `Reset!${randomBytes(18).toString("base64url")}7a`;
  const passwordHash = await hash(password, 12);
  return adminTransaction(sessionId, async (tx, actorId) => {
    if (id === actorId) throw new AccountError("请通过账号安全修改自己的密码");
    const user = await tx.user.findUnique({ where: { id }, select: publicSelect });
    if (!user) throw new AccountError("账号不存在", 404);
    if (user.revision !== revision) throw new AccountError("账号已被修改，请刷新后重试", 409);
    await tx.user.update({ where: { id }, data: { passwordHash, mustChangePassword: true, authVersion: { increment: 1 }, revision: { increment: 1 } } });
    await tx.authSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await recordAudit(tx, { actorId, action: "PASSWORD_RESET", targetId: id, details: { reason } });
    return { login: user.login, initialPassword: password };
  });
}
export async function readStudentProfile(sessionId: string, userId: string) {
  return scopedTransaction(sessionId, ["ADMIN", "COLLEGE", "COUNSELOR", "STUDENT"], false, async (tx, actor) => {
    if (actor.role === "STUDENT" && actor.id !== userId) throw new AccountError("没有查看权限", 403);
    const user = await tx.user.findFirst({ where: { AND: [scopedStudentWhere(actor), { id: userId }] }, select: { id: true, name: true, login: true, revision: true, studentProfile: { select: profileSelect } } });
    if (!user?.studentProfile) throw new AccountError("学生档案不存在或不在权限范围", 404);
    const affiliationHistory = await tx.studentAffiliation.findMany({ where: { studentId: userId }, orderBy: [{ startedAt: "desc" }, { id: "desc" }], take: 20 });
    return { ...user, affiliationHistory };
  });
}
