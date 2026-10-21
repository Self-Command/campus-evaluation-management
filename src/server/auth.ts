import type { NextAuthOptions } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare, hash } from "bcryptjs";
import { consumeLimit } from "@/server/rate-limit";
import { z } from "zod";
import { db } from "@/server/db";
import { createHmac } from "node:crypto";
import { consumeLoginCaptcha } from "@/server/login-captcha";
import { settingsSchema, defaultSettings } from "@/lib/settings-schema";

// NextAuth v4 publishes this provider as CJS exports.default. Native Node ESM
// (local account tooling) receives that namespace; Next's bundler unwraps it.
const credentialsProvider: typeof Credentials = typeof Credentials === "function" ? Credentials : (Credentials as unknown as { default: typeof Credentials }).default;

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  pages: { signIn: "/login", error: "/login" },
  providers: [credentialsProvider({ name: "账号密码", credentials: { login: {}, password: {}, role: {}, captchaId: {}, captcha: {} }, authorize: authenticateCredentials })],
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

export function matchesLoginRole(actual: string, selected: string) {
  return actual === selected || (actual === "PUBLISHER" && selected === "COLLEGE");
}
export async function authenticateCredentials(raw: unknown) {
  const parsed = z.object({ login: z.string().trim().min(1).max(64), password: z.string().min(1).max(128), role: z.enum(["ADMIN", "COLLEGE", "COUNSELOR", "STUDENT"]).optional(), captchaId: z.string().uuid(), captcha: z.string().trim().regex(/^[a-zA-Z]{5}$/) }).safeParse(raw);
  if (!parsed.success) return null;
  const { login, password, role, captchaId, captcha } = parsed.data;
  // Never trust proxy headers for authentication throttling.
  if (!(await consumeLimit("login-global", "local", 200))) return null;
  if (!(await consumeLoginCaptcha(captchaId, captcha))) throw new Error("CaptchaInvalid");
  const key = createHmac("sha256", process.env.NEXTAUTH_SECRET!).update(`login-failure:${login.toLowerCase()}`).digest("hex");
  const user = await db.user.findUnique({ where: { login } });
  const dummy = "$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW";
  const valid = await compare(password, user?.passwordHash ?? dummy);
  const outcome = await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(72109312)`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(72109315, ${Buffer.from(key, "hex").readInt32BE(0)})`;
    const settings = await tx.siteSettings.findUnique({ where: { id: "site" } });
    const policy = settings ? settingsSchema.parse(settings.content) : defaultSettings;
    const policyKey = `${policy.loginFailureMaxAttempts}:${policy.loginFailureLockMinutes}`;
    const now = new Date();
    let failures = 0;
    if (policy.loginFailureLimitEnabled) {
      const previous = await tx.loginFailureState.findUnique({ where: { key } });
      if (previous?.policyKey === policyKey) {
        if (previous.lockedUntil && previous.lockedUntil > now) return { kind: "locked" } as const;
        failures = previous.lockedUntil ? 0 : previous.failures;
      }
    }
    const current = user ? await tx.user.findUnique({ where: { id: user.id } }) : null;
    if (!user || !valid || !current || current.disabled || current.authVersion !== user.authVersion || current.passwordHash !== user.passwordHash || (role && !matchesLoginRole(current.role, role))) {
      if (policy.loginFailureLimitEnabled) {
        failures += 1;
        const lockedUntil = failures >= policy.loginFailureMaxAttempts ? new Date(now.getTime() + policy.loginFailureLockMinutes * 60_000) : null;
        await tx.loginFailureState.upsert({ where: { key }, create: { key, failures, policyKey, lockedUntil }, update: { failures, policyKey, lockedUntil } });
        if (lockedUntil) return { kind: "locked" } as const;
      }
      return { kind: "invalid" } as const;
    }
    await tx.loginFailureState.deleteMany({ where: { key } });
    const created = await tx.authSession.create({ data: { userId: current.id, version: current.authVersion, expiresAt: new Date(Date.now() + 8 * 60 * 60_000) } });
    await tx.auditEvent.create({ data: { actorId: current.id, action: "LOGIN", targetId: created.id } });
    return { kind: "success", id: current.id, name: current.name, sessionId: created.id } as const;
  });
  if (outcome.kind === "locked") throw new Error("LoginLocked");
  return outcome.kind === "success" ? { id: outcome.id, name: outcome.name, sessionId: outcome.sessionId } : null;
}

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
