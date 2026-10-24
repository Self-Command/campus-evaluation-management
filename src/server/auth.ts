import type { NextAuthOptions } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compare, hash } from "bcryptjs";
import { consumeLimit } from "@/server/rate-limit";
import { z } from "zod";
import { db } from "@/server/db";
import { createHmac } from "node:crypto";
import { consumeLoginCaptcha } from "@/server/login-captcha";
import { storedSettingsSchema, defaultSettings } from "@/lib/settings-schema";
import { recordAudit, recordAuditBestEffort, recordSecurityAuditBestEffort } from "@/server/audit";

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
  // Never trust proxy headers for authentication throttling. This is only a
  // coarse flood guard; per-account failure limits are configured in 系统设置.
  if (!(await consumeLimit("login-global", "local", 1200))) {
    await recordSecurityAuditBestEffort(db, { action: "AUTH_LOGIN_FAILED", result: "DENIED", details: { login: login.slice(0, 3) + "***", reason: "登录请求过于频繁" } });
    return null;
  }
  if (!(await consumeLoginCaptcha(captchaId, captcha))) {
    await recordSecurityAuditBestEffort(db, { action: "AUTH_LOGIN_FAILED", result: "FAILURE", details: { login: login.slice(0, 3) + "***", reason: "验证码无效" } });
    throw new Error("CaptchaInvalid");
  }
  const key = createHmac("sha256", process.env.NEXTAUTH_SECRET!).update(`login-failure:${login.toLowerCase()}`).digest("hex");
  const user = await db.user.findUnique({ where: { login } });
  const dummy = "$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW";
  const valid = await compare(password, user?.passwordHash ?? dummy);
  const outcome = await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(72109312)`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(72109315, ${Buffer.from(key, "hex").readInt32BE(0)})`;
    const settings = await tx.siteSettings.findUnique({ where: { id: "site" } });
    const policy = settings ? storedSettingsSchema.parse(settings.content) : defaultSettings;
    const policyKey = `${policy.loginFailureMaxAttempts}:${policy.loginFailureLockMinutes}`;
    const now = new Date();
    let failures = 0;
    if (policy.loginFailureLimitEnabled) {
      const previous = await tx.loginFailureState.findUnique({ where: { key } });
      if (previous?.policyKey === policyKey) {
        if (previous.lockedUntil && previous.lockedUntil > now) {
          await recordAuditBestEffort(tx, { action: "AUTH_LOGIN_LOCKED", result: "DENIED", details: { login: login.slice(0, 3) + "***", lockedUntil: previous.lockedUntil.toISOString() } });
          return { kind: "locked" } as const;
        }
        failures = previous.lockedUntil ? 0 : previous.failures;
      }
    }
    const current = user ? await tx.user.findUnique({ where: { id: user.id } }) : null;
    if (!user || !valid || !current || current.disabled || current.authVersion !== user.authVersion || current.passwordHash !== user.passwordHash || (role && !matchesLoginRole(current.role, role))) {
      if (policy.loginFailureLimitEnabled) {
        failures += 1;
        const lockedUntil = failures >= policy.loginFailureMaxAttempts ? new Date(now.getTime() + policy.loginFailureLockMinutes * 60_000) : null;
        await tx.loginFailureState.upsert({ where: { key }, create: { key, failures, policyKey, lockedUntil }, update: { failures, policyKey, lockedUntil } });
        if (lockedUntil) {
          await recordAuditBestEffort(tx, { action: "AUTH_LOGIN_LOCKED", result: "DENIED", details: { login: login.slice(0, 3) + "***", lockedUntil: lockedUntil.toISOString(), attempts: failures } });
          return { kind: "locked" } as const;
        }
      }
      await recordSecurityAuditBestEffort(tx, { action: "AUTH_LOGIN_FAILED", result: "FAILURE", details: { login: login.slice(0, 3) + "***", selectedRole: role ?? null, accountDisabled: current?.disabled ?? false } });
      return { kind: "invalid" } as const;
    }
    await tx.loginFailureState.deleteMany({ where: { key } });
    const created = await tx.authSession.create({ data: { userId: current.id, version: current.authVersion, expiresAt: new Date(Date.now() + 8 * 60 * 60_000) } });
    await recordAudit(tx, { action: "AUTH_LOGIN_SUCCEEDED", actorId: current.id, actor: { id: current.id, name: current.name, login: current.login, role: current.role }, targetId: created.id, targetLabel: current.login });
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
  const session = await db.authSession.findUnique({ where: { id }, include: { user: true } });
  await db.authSession.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
  if (session && !session.revokedAt) await recordAuditBestEffort(db, {
    action: "AUTH_LOGOUT",
    actorId: session.userId,
    actor: { id: session.user.id, name: session.user.name, login: session.user.login, role: session.user.role },
    targetId: session.id,
  });
}

export async function verifyAdminPassword(sessionId: string, password: string) {
  const current = await getCurrentSession(sessionId);
  if (!current || current.user.role !== "ADMIN" || current.user.mustChangePassword) return false;
  const valid = await compare(password, current.user.passwordHash);
  if (!valid) await recordAuditBestEffort(db, {
    action: "AUTH_ADMIN_REAUTH_FAILED",
    actorId: current.userId,
    actor: { id: current.user.id, name: current.user.name, login: current.user.login, role: current.user.role },
    result: "DENIED",
  });
  return valid;
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
    await recordAudit(tx, { action: "PASSWORD_CHANGED", actorId: current.userId, targetId: current.userId, targetLabel: current.user.login });
    return true;
  });
}
