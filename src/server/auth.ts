import type { NextAuthOptions } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare, hash } from "bcryptjs";
import { consumeLimit } from "@/server/rate-limit";
import { z } from "zod";
import { db } from "@/server/db";

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  pages: { signIn: "/login", error: "/login" },
  providers: [Credentials({ name: "账号密码", credentials: { login: {}, password: {} }, async authorize(raw) {
    const parsed = z.object({ login: z.string().trim().min(1).max(64), password: z.string().min(1).max(128) }).safeParse(raw);
    if (!parsed.success) return null;
    const { login, password } = parsed.data;
    // Loopback-only development: use a global bucket, never trust client proxy headers.
    if (!(await consumeLimit("login-global", "local", 200)) || !(await consumeLimit("login", login.toLowerCase(), 20))) return null;
    const user = await db.user.findUnique({ where: { login } });
    // Always perform a password hash comparison, including unknown accounts.
    const dummy = "$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW";
    const valid = await compare(password, user?.passwordHash ?? dummy);
    if (!user || !valid || user.disabled) return null;
    const session = await db.$transaction(async (tx) => {
      const current = await tx.user.findUnique({ where: { id: user.id } });
      if (!current || current.disabled || current.authVersion !== user.authVersion || current.passwordHash !== user.passwordHash) return null;
      const session = await tx.authSession.create({ data: { userId: user.id, version: user.authVersion, expiresAt: new Date(Date.now() + 8 * 60 * 60_000) } });
      await tx.auditEvent.create({ data: { actorId: user.id, action: "LOGIN", targetId: session.id } });
      return session;
    });
    return session ? { id: user.id, name: user.name, sessionId: session.id } : null;
  } })],
  callbacks: {
    async jwt({ token, user }) { if (user) token.sessionId = user.sessionId; return token; },
    async session({ session, token }) {
      const current = typeof token.sessionId === "string" ? await getCurrentSession(token.sessionId) : null;
      session.user = current ? { id: current.user.id, name: current.user.name, role: current.user.role, mustChangePassword: current.user.mustChangePassword, sessionId: current.id } : undefined;
      return session;
    },
  },
  events: { async signOut(message) { if ("token" in message && typeof message.token?.sessionId === "string") await revokeSession(message.token.sessionId); } },
  logger: { error(code) { console.error("认证服务错误", code); }, warn(code) { console.warn("认证服务提示", code); }, debug() {} },
};

export async function getCurrentSession(id: string) {
  const session = await db.authSession.findUnique({ where: { id }, include: { user: true } });
  if (!session || session.revokedAt || session.expiresAt <= new Date() || session.user.disabled || session.version !== session.user.authVersion) return null;
  return session;
}
export async function revokeSession(id: string) {
  await db.authSession.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
}
export async function changePassword(sessionId: string, oldPassword: string, newPassword: string) {
  const current = await getCurrentSession(sessionId);
  if (!current || !(await compare(oldPassword, current.user.passwordHash))) return false;
  if (oldPassword === newPassword) return false;
  const passwordHash = await hash(newPassword, 12);
  return db.$transaction(async (tx) => {
    const updated = await tx.user.updateMany({ where: { id: current.userId, authVersion: current.version, passwordHash: current.user.passwordHash, disabled: false, sessions: { some: { id: sessionId, revokedAt: null, expiresAt: { gt: new Date() } } } }, data: { passwordHash, mustChangePassword: false, authVersion: { increment: 1 } } });
    if (!updated.count) return false;
    await tx.authSession.updateMany({ where: { userId: current.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.auditEvent.create({ data: { actorId: current.userId, action: "PASSWORD_CHANGED", targetId: current.userId } });
    return true;
  });
}
