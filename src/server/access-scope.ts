import { db } from "@/server/db";
import { AccountError } from "@/server/account-error";
import type { Prisma, Role, User } from "@/generated/prisma/client";

export async function scopedTransaction<T>(sessionId: string, roles: Role[], write: boolean, operation: (tx: Prisma.TransactionClient, actor: User) => Promise<T>) {
  return db.$transaction(async tx => {
    // Organization/account writes share the same exclusive lock. Period writes take
    // its shared form first, so an assignment cannot change midway through review.
    if (write) await tx.$executeRaw`SELECT pg_advisory_xact_lock(72109312)`;
    else await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(72109312)`;
    const session = await tx.authSession.findUnique({ where: { id: sessionId }, include: { user: true } });
    if (!session || session.revokedAt || session.expiresAt <= new Date() || session.user.disabled || session.version !== session.user.authVersion) throw new AccountError("会话已失效，请重新登录", 401);
    if (session.user.mustChangePassword || !roles.includes(session.user.role)) throw new AccountError("没有管理权限", 403);
    if (session.user.role === "COLLEGE" || session.user.role === "COUNSELOR") {
      const college = session.user.collegeId && await tx.college.findUnique({ where: { id: session.user.collegeId } });
      if (!college || !college.enabled) throw new AccountError("学院归属未配置或已停用，请联系学校管理员", 403);
    }
    return operation(tx, session.user);
  }, { timeout: 15_000 });
}

export function scopedStudentWhere(actor: Pick<User, "id" | "role" | "collegeId">): Prisma.UserWhereInput {
  if (actor.role === "ADMIN") return { role: "STUDENT" };
  if (actor.role === "STUDENT") return { role: "STUDENT", id: actor.id };
  if ((actor.role === "COLLEGE" || actor.role === "COUNSELOR") && actor.collegeId) return {
    role: "STUDENT", studentProfile: { is: { schoolClass: { is: {
      enabled: true, major: { is: { enabled: true, collegeId: actor.collegeId, college: { is: { enabled: true } } } },
      ...(actor.role === "COUNSELOR" ? { counselorId: actor.id } : {}),
    } } } },
  };
  throw new AccountError("没有查看权限", 403);
}
