import { randomBytes } from "node:crypto";
import { hash } from "bcryptjs";
import { z } from "zod";
import { db } from "@/server/db";
import { getCurrentSession } from "@/server/auth";
import type { Prisma } from "@/generated/prisma/client";
import { AccountError } from "@/server/account-error";
import { scopedTransaction, scopedStudentWhere } from "@/server/access-scope";
import { configuredClass, classProfile, profileSelect, recordStudentAffiliation } from "@/server/organizations";
export { AccountError } from "@/server/account-error";

const text = z.string().trim().min(1, "此项不能为空").max(80, "最多80个字符");
export const accountSchema = z.object({
  name: text,
  login: z.string().trim().min(3).max(64).regex(/^[A-Za-z0-9._-]+$/, "账号仅允许字母、数字、点、下划线和连字符"),
  role: z.enum(["ADMIN", "COLLEGE", "COUNSELOR", "STUDENT"]),
  collegeId: z.string().trim().max(100).optional(),
  classId: z.string().trim().max(100).optional(),
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
    const user = await tx.user.create({ data: { name: data.name, login: data.login, role: data.role, collegeId: data.collegeId || null, passwordHash, studentProfile: schoolClass ? { create: { studentNumber: data.login, ...classProfile(schoolClass) } } : undefined }, select: publicSelect });
    if (schoolClass) await recordStudentAffiliation(tx, user.id, schoolClass, actorId, "学生建档");
    await tx.auditEvent.create({ data: { actorId, action: "ACCOUNT_CREATED", targetId: user.id, details: JSON.parse(JSON.stringify({ login: user.login, role: user.role, name: user.name, profile: user.studentProfile, collegeId: user.collegeId })) } });
    return { user, initialPassword: password };
  });
}
async function validateStaffCollege(tx: Prisma.TransactionClient, account: z.infer<typeof accountSchema>) {
  if (account.role === "COLLEGE" || account.role === "COUNSELOR") {
    const college = await tx.college.findUnique({ where: { id: account.collegeId! } });
    if (!college?.enabled) throw new AccountError("请选择已启用的学院");
  }
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
    const classId = account.classId || (previous.role === "STUDENT" ? previous.studentProfile?.classId : null);
    if (account.role === "STUDENT" && !classId && previous.role !== "STUDENT") throw new AccountError("请选择已配置的班级");
    const schoolClass = account.role === "STUDENT" && classId ? await configuredClass(tx, classId) : null;
    const collegeId = account.collegeId || null;
    if (previous.role === "COUNSELOR" && (account.role !== "COUNSELOR" || previous.collegeId !== collegeId || disabled)) {
      if (await tx.schoolClass.count({ where: { counselorId: id } })) throw new AccountError("请先交接该辅导员负责的全部班级");
    }
    const authChanged = previous.role !== account.role || previous.disabled !== disabled || previous.collegeId !== collegeId;
    await tx.user.update({ where: { id }, data: { name: account.name, login: account.login, role: account.role, collegeId, disabled, revision: { increment: 1 }, authVersion: authChanged ? { increment: 1 } : undefined }, select: publicSelect });
    if (schoolClass) {
      await tx.studentProfile.upsert({ where: { userId: id }, create: { userId: id, studentNumber: account.login, ...classProfile(schoolClass) }, update: classProfile(schoolClass) });
      if (previous.role !== "STUDENT" || previous.studentProfile?.classId !== schoolClass.id) await recordStudentAffiliation(tx, id, schoolClass, actorId, reason);
    } else if (previous.role === "STUDENT") await tx.studentAffiliation.updateMany({ where: { studentId: id, endedAt: null }, data: { endedAt: new Date() } });
    if (authChanged) await tx.authSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    const updated = await tx.user.findUniqueOrThrow({ where: { id }, select: publicSelect });
    await tx.auditEvent.create({ data: { actorId, action: "ACCOUNT_UPDATED", targetId: id, details: JSON.parse(JSON.stringify({ reason, before: { name: previous.name, role: previous.role, collegeId: previous.collegeId, login: previous.login, disabled: previous.disabled, profile: previous.studentProfile }, after: { name: updated.name, role: updated.role, collegeId: updated.collegeId, login: updated.login, disabled: updated.disabled, profile: updated.studentProfile } })) } });
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
    await tx.auditEvent.create({ data: { actorId, action: "PASSWORD_RESET", targetId: id, details: { reason } } });
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
