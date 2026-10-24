import { z } from "zod";
import { db } from "@/server/db";
import { AccountError, adminTransaction } from "@/server/accounts";
import { getCurrentSession } from "@/server/auth";
import { validateScheme } from "@/lib/scoring/validate";
import { schoolScheme } from "@/lib/scoring/template";
import { nodeSchema, schemeSchema } from "@/lib/scoring/types";
import type { Prisma, TermPhase } from "@/generated/prisma/client";
import { schemeReferences, schemeReferenceErrors } from "@/server/scheme-references";

export async function termTransaction<T>(sessionId: string, termId: string, roles: string[], phases: TermPhase[], operation: (tx: Prisma.TransactionClient, term: Awaited<ReturnType<typeof db.term.findUniqueOrThrow>>, actorId: string) => Promise<T>, mode: "read" | "write" | "manage" = "write", options: { timeout?: number } = {}) {
  return db.$transaction(async tx => {
    // Shared account lock freezes identity/scope while publishing. Account administration
    // takes this lock exclusively. Always acquire accounts before a period lock.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(72109312)`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${termId}, 72109313))`;
    const session = await tx.authSession.findUnique({ where: { id: sessionId }, include: { user: true } });
    if (!session || session.revokedAt || session.expiresAt <= new Date() || session.user.disabled || session.version !== session.user.authVersion) throw new AccountError("会话已失效，请重新登录", 401);
    if (session.user.mustChangePassword || !roles.includes(session.user.role)) throw new AccountError("没有操作权限", 403);
    const term = await tx.term.findUnique({ where: { id: termId } });
    if (!term || (term.disposition === "DELETED" && mode !== "manage")) throw new AccountError("学期不存在", 404);
    if (mode === "manage" && session.user.role !== "ADMIN") throw new AccountError("没有管理权限", 403);
    if (mode === "write" && term.disposition !== "NORMAL") throw new AccountError(term.disposition === "VOID" ? "周期已作废，仅可查询历史" : "周期已归档，请先取消归档", 409);
    if (!phases.includes(term.phase)) throw new AccountError("当前学期阶段不允许此操作", 409);
    return operation(tx, term, session.userId);
  }, { timeout: options.timeout ?? 15_000 });
}
export const termViewSchema = z.enum(["normal", "archived", "void", "deleted", "all"]);
export async function listTerms(sessionId: string, options: { view?: z.infer<typeof termViewSchema> } = {}) {
  const session = await getCurrentSession(sessionId);
  if (!session || session.user.mustChangePassword) throw new AccountError("请重新登录", 401);
  if (["deleted", "all"].includes(options.view ?? "") && session.user.role !== "ADMIN") throw new AccountError("没有管理权限", 403);
  const disposition = { normal: "NORMAL", archived: "ARCHIVED", void: "VOID", deleted: "DELETED" } as const;
  return db.term.findMany({ where: options.view && options.view !== "all" ? { disposition: disposition[options.view] } : options.view === "all" ? {} : { disposition: { not: "DELETED" } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
}
export async function createTerm(sessionId: string, input: unknown) {
  const data = z.object({ name: z.string().trim().min(1).max(80), template: z.boolean().default(true), sourceTermId: z.string().min(1).max(100).optional() }).strict().parse(input);
  return adminTransaction(sessionId, async (tx, actorId) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(72109314)`;
    if (await tx.term.count({ where: { name: { equals: data.name, mode: "insensitive" }, disposition: "NORMAL" } })) throw new AccountError("已有同名周期，请修改名称或进入原周期", 409);
    const source = data.sourceTermId ? await tx.term.findUnique({ where: { id: data.sourceTermId } }) : null;
    if (data.sourceTermId && (!source || source.disposition === "DELETED")) throw new AccountError("复制来源周期不存在", 404);
    const scheme = source?.scheme ?? (data.template ? schoolScheme() : { nodes: [nodeSchema.parse({ id: "total", parentId: null, name: "综合测评成绩", kind: "ACTIVITY", order: 0, maximum: "9999999999" })], deductions: [] });
    validateScheme(scheme);
    const term = await tx.term.create({ data: { name: data.name, scheme } });
    await tx.auditEvent.create({ data: { actorId, action: "TERM_CREATED", targetId: term.id, details: { name: term.name, sourceTermId: source?.id ?? null } } });
    return term;
  });
}

const allPhases: TermPhase[] = ["CONFIGURATION", "ACTIVE", "CHECKING", "LOCKED"];
export async function termUsage(tx: Prisma.TransactionClient, termId: string) {
  const [activities, projects, claims, grades, deductions, gradeImports, participationImports, publications, snapshots, appeals, reopenings, corrections] = await Promise.all([
    tx.activity.count({ where: { termId } }), tx.recognitionProject.count({ where: { termId } }),
    tx.personalClaim.count({ where: { termId } }), tx.gradeInput.count({ where: { termId } }),
    tx.deductionInput.count({ where: { termId } }), tx.gradeImport.count({ where: { termId } }),
    tx.participationImport.count({ where: { termId } }), tx.resultPublication.count({ where: { termId } }),
    tx.settlementSnapshot.count({ where: { termId } }), tx.resultAppeal.count({ where: { termId } }),
    tx.termReopen.count({ where: { termId } }), tx.auditEvent.count({ where: { action: "SCORING_CORRECTED", OR: [{ targetId: termId }, { details: { path: ["termId"], equals: termId } }] } }),
  ]);
  return { activities, projects, claims, grades, deductions, imports: gradeImports + participationImports, publications, snapshots, appeals, reopenings, corrections };
}
function capabilities(term: { phase: TermPhase; disposition: string }, usage: Awaited<ReturnType<typeof termUsage>>) {
  return {
    canDelete: term.disposition === "NORMAL" && term.phase === "CONFIGURATION" && Object.values(usage).every(count => count === 0),
    canVoid: term.disposition === "NORMAL" && ["CONFIGURATION", "ACTIVE"].includes(term.phase) && !usage.publications && !usage.snapshots && !usage.reopenings,
    canArchive: term.disposition === "NORMAL" && term.phase === "LOCKED",
  };
}
export async function readTermManagement(sessionId: string, termId: string) {
  return termTransaction(sessionId, termId, ["ADMIN"], allPhases, async (tx, term) => {
    const usage = await termUsage(tx, termId);
    const references = await schemeReferences(tx, termId);
    const nodeUsage = { ...references.nodeUsage };
    const scheme = schemeSchema.parse(term.scheme);
    for (const item of references.deductions) {
      const nodeId = scheme.deductions.find(project => project.id === item.projectId)?.nodeId;
      if (nodeId) nodeUsage[nodeId] = (nodeUsage[nodeId] ?? 0) + 1;
    }
    return { ...term, usage, nodeUsage, ...capabilities(term, usage) };
  }, "manage");
}
export async function manageTerm(sessionId: string, termId: string, input: unknown) {
  const data = z.object({ action: z.enum(["rename", "delete", "restore", "void", "archive", "unarchive"]), revision: z.number().int().nonnegative(), reason: z.string().trim().min(2).max(500), name: z.string().trim().min(1).max(80).optional() }).strict().parse(input);
  return termTransaction(sessionId, termId, ["ADMIN"], allPhases, async (tx, term, actorId) => {
    if (term.revision !== data.revision) throw new AccountError("周期已变化，请刷新后核对", 409);
    const usage = await termUsage(tx, termId), allowed = capabilities(term, usage);
    let disposition = term.disposition;
    if (data.action === "rename") {
      if (!data.name || term.disposition === "DELETED") throw new AccountError("请恢复周期后填写有效名称", 409);
    } else if (data.action === "delete") {
      if (!allowed.canDelete) throw new AccountError("仅无业务记录的配置周期可删除；已有记录请作废或归档", 409);
      disposition = "DELETED";
    } else if (data.action === "restore") {
      if (term.disposition !== "DELETED") throw new AccountError("仅回收站周期可以恢复", 409);
      disposition = "NORMAL";
    } else if (data.action === "void") {
      if (!allowed.canVoid) throw new AccountError("仅未发布、未结算的配置或录入周期可作废", 409);
      disposition = "VOID";
    } else if (data.action === "archive") {
      if (!allowed.canArchive) throw new AccountError("请先完成锁定结算，再归档周期", 409);
      disposition = "ARCHIVED";
    } else {
      if (term.disposition !== "ARCHIVED") throw new AccountError("当前周期未归档", 409);
      disposition = "NORMAL";
    }
    if (disposition === "NORMAL") {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(72109314)`;
      const nextName = data.action === "rename" ? data.name! : term.name;
      if (await tx.term.count({ where: { id: { not: termId }, name: { equals: nextName, mode: "insensitive" }, disposition: "NORMAL" } })) throw new AccountError("已有同名正常周期，请先更正名称", 409);
    }
    const saved = await tx.term.update({ where: { id: termId }, data: { ...(data.action === "rename" ? { name: data.name } : { disposition, dispositionReason: data.reason, dispositionAt: new Date() }), revision: { increment: 1 } } });
    await tx.auditEvent.create({ data: { actorId, action: `TERM_${data.action.toUpperCase()}`, targetId: termId, details: { reason: data.reason, before: { name: term.name, disposition: term.disposition, revision: term.revision }, after: { name: saved.name, disposition: saved.disposition, revision: saved.revision }, usage } } });
    return { ...saved, usage, ...capabilities(saved, usage) };
  }, "manage");
}
export async function saveScheme(sessionId: string, termId: string, input: unknown) {
  const data = z.object({ revision: z.number().int().nonnegative(), scheme: schemeSchema }).parse(input);
  const { scheme } = validateScheme(data.scheme);
  return termTransaction(sessionId, termId, ["ADMIN"], ["CONFIGURATION"], async (tx, term, actorId) => {
    if (term.revision !== data.revision) throw new AccountError("评分方案已变化，请刷新后重试", 409);
    const errors = schemeReferenceErrors(scheme, await schemeReferences(tx, termId));
    if (errors.length) throw new AccountError(errors.join("；"), 409);
    const updated = await tx.term.update({ where: { id: termId }, data: { scheme, revision: { increment: 1 } } });
    await tx.auditEvent.create({ data: { actorId, action: "SCHEME_SAVED", targetId: termId, details: { beforeRevision: term.revision, afterRevision: updated.revision } } });
    return updated;
  });
}
export async function activateTerm(sessionId: string, termId: string, input: unknown) {
  const { revision } = z.object({ revision: z.number().int().nonnegative() }).parse(input);
  return termTransaction(sessionId, termId, ["ADMIN"], ["CONFIGURATION"], async (tx, term, actorId) => {
    if (term.revision !== revision) throw new AccountError("评分方案已变化，请刷新后重试", 409);
    const { scheme } = validateScheme(term.scheme);
    const errors = schemeReferenceErrors(scheme, await schemeReferences(tx, termId));
    if (errors.length) throw new AccountError(errors.join("；"), 409);
    const updated = await tx.term.update({ where: { id: termId }, data: { phase: "ACTIVE", revision: { increment: 1 } } });
    await tx.auditEvent.create({ data: { actorId, action: "TERM_ACTIVATED", targetId: termId, details: { revision: updated.revision } } });
    return updated;
  });
}
