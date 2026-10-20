import { z } from "zod";
import { db } from "@/server/db";
import { AccountError, adminTransaction } from "@/server/accounts";
import { getCurrentSession } from "@/server/auth";
import { validateScheme } from "@/lib/scoring/validate";
import { schoolScheme } from "@/lib/scoring/template";
import { nodeSchema, schemeSchema } from "@/lib/scoring/types";
import type { Prisma, TermPhase } from "@/generated/prisma/client";

export async function termTransaction<T>(sessionId: string, termId: string, roles: string[], phases: TermPhase[], operation: (tx: Prisma.TransactionClient, term: Awaited<ReturnType<typeof db.term.findUniqueOrThrow>>, actorId: string) => Promise<T>) {
  return db.$transaction(async tx => {
    // Shared account lock freezes identity/scope while publishing. Account administration
    // takes this lock exclusively. Always acquire accounts before a period lock.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(72109312)`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${termId}, 72109313))`;
    const session = await tx.authSession.findUnique({ where: { id: sessionId }, include: { user: true } });
    if (!session || session.revokedAt || session.expiresAt <= new Date() || session.user.disabled || session.version !== session.user.authVersion) throw new AccountError("会话已失效，请重新登录", 401);
    if (session.user.mustChangePassword || !roles.includes(session.user.role)) throw new AccountError("没有操作权限", 403);
    const term = await tx.term.findUnique({ where: { id: termId } });
    if (!term) throw new AccountError("学期不存在", 404);
    if (!phases.includes(term.phase)) throw new AccountError("当前学期阶段不允许此操作", 409);
    return operation(tx, term, session.userId);
  }, { timeout: 15_000 });
}
export async function listTerms(sessionId: string) {
  const session = await getCurrentSession(sessionId);
  if (!session || session.user.mustChangePassword) throw new AccountError("请重新登录", 401);
  return db.term.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
}
export async function createTerm(sessionId: string, input: unknown) {
  const data = z.object({ name: z.string().trim().min(1).max(80), template: z.boolean().default(true) }).parse(input);
  const scheme = data.template ? schoolScheme() : { nodes: [nodeSchema.parse({ id: "total", parentId: null, name: "综合测评成绩", kind: "ACTIVITY", order: 0, maximum: "9999999999" })], deductions: [] };
  validateScheme(scheme);
  return adminTransaction(sessionId, async (tx, actorId) => {
    const term = await tx.term.create({ data: { name: data.name, scheme } });
    await tx.auditEvent.create({ data: { actorId, action: "TERM_CREATED", targetId: term.id, details: { name: term.name } } });
    return term;
  });
}
export async function saveScheme(sessionId: string, termId: string, input: unknown) {
  const data = z.object({ revision: z.number().int().nonnegative(), scheme: schemeSchema }).parse(input);
  const { scheme } = validateScheme(data.scheme);
  return termTransaction(sessionId, termId, ["ADMIN"], ["CONFIGURATION"], async (tx, term, actorId) => {
    if (term.revision !== data.revision) throw new AccountError("评分方案已变化，请刷新后重试", 409);
    const updated = await tx.term.update({ where: { id: termId }, data: { scheme, revision: { increment: 1 } } });
    await tx.auditEvent.create({ data: { actorId, action: "SCHEME_SAVED", targetId: termId, details: { beforeRevision: term.revision, afterRevision: updated.revision } } });
    return updated;
  });
}
export async function activateTerm(sessionId: string, termId: string, input: unknown) {
  const { revision } = z.object({ revision: z.number().int().nonnegative() }).parse(input);
  return termTransaction(sessionId, termId, ["ADMIN"], ["CONFIGURATION"], async (tx, term, actorId) => {
    if (term.revision !== revision) throw new AccountError("评分方案已变化，请刷新后重试", 409);
    validateScheme(term.scheme);
    const updated = await tx.term.update({ where: { id: termId }, data: { phase: "ACTIVE", revision: { increment: 1 } } });
    await tx.auditEvent.create({ data: { actorId, action: "TERM_ACTIVATED", targetId: termId, details: { revision: updated.revision } } });
    return updated;
  });
}
