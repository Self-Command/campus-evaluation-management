import { z } from "zod";
import { db } from "@/server/db";
import { AccountError } from "@/server/accounts";
import { profileSelect } from "@/server/organizations";

const select = { id: true, login: true, name: true, role: true, collegeId: true, college: { select: { id: true, code: true, name: true, enabled: true } }, mustChangePassword: true, revision: true, createdAt: true, studentProfile: { select: profileSelect } } as const;
export async function selfAccount(sessionId: string, input?: unknown) {
  const data = input === undefined ? null : z.object({ name: z.string().trim().min(2).max(80), revision: z.number().int().nonnegative() }).strict().parse(input);
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(72109312)`;
    const session = await tx.authSession.findUnique({ where: { id: sessionId }, include: { user: true } });
    if (!session || session.revokedAt || session.expiresAt <= new Date() || session.user.disabled || session.version !== session.user.authVersion) throw new AccountError("会话已失效，请重新登录", 401);
    if (session.user.mustChangePassword) throw new AccountError("请先修改初始密码", 403);
    if (data) {
      if (session.user.revision !== data.revision) throw new AccountError("账号信息已变化，请刷新后核对", 409);
      if (data.name !== session.user.name) {
        await tx.user.update({ where: { id: session.userId }, data: { name: data.name, revision: { increment: 1 } } });
        await tx.auditEvent.create({ data: { actorId: session.userId, action: "SELF_ACCOUNT_UPDATED", targetId: session.userId, details: { before: { name: session.user.name }, after: { name: data.name } } } });
      }
    }
    return tx.user.findUniqueOrThrow({ where: { id: session.userId }, select });
  });
}
