import { z } from "zod";
import { AccountError } from "@/server/accounts";
import { termTransaction } from "@/server/terms";
import { ownEvidence } from "@/server/claims";
import { publicationSelect } from "@/server/publications";
import { effectiveCheckingDeadline } from "@/server/publication-window";

export async function createAppeal(sessionId: string, termId: string, input: unknown) {
  const data = z.object({ publicationId: z.string(), resultHash: z.string().regex(/^[a-f0-9]{64}$/), target: z.string().trim().min(1).max(120), reason: z.string().trim().min(2).max(2000), evidenceIds: z.array(z.string()).max(5).default([]) }).parse(input);
  return termTransaction(sessionId, termId, ["STUDENT"], ["CHECKING"], async (tx, term, actorId) => {
    if (term.publishedResultSetId !== data.publicationId) throw new AccountError("结果已更新，请针对当前版本提交异议", 409);
    const result = await tx.publishedResult.findUnique({ where: { publicationId_studentId: { publicationId: data.publicationId, studentId: actorId } }, include: { publication: true } });
    if (!result || result.resultHash !== data.resultHash) throw new AccountError("结果已变化或不属于本人", 409);
    if (await effectiveCheckingDeadline(tx, result.publication) <= new Date()) throw new AccountError("异议提交时间已结束", 409);
    const existing = await tx.resultAppeal.findFirst({ where: { publicationId: data.publicationId, studentId: actorId, target: data.target, status: { in: ["OPEN", "PROCESSING"] } } });
    if (existing) throw new AccountError("该结果项目已有处理中异议，请查看原记录", 409);
    const ids = await ownEvidence(tx, actorId, data.evidenceIds);
    const appeal = await tx.resultAppeal.create({ data: { termId, publicationId: data.publicationId, studentId: actorId, resultHash: data.resultHash, target: data.target, reason: data.reason, evidence: { create: ids.map(evidenceId => ({ evidenceId })) } } });
    await tx.auditEvent.create({ data: { actorId, action: "APPEAL_CREATED", targetId: appeal.id, details: { termId, publicationId: data.publicationId, target: data.target } } });
    return appeal;
  });
}
export async function changeAppeal(sessionId: string, termId: string, id: string, input: unknown) {
  const data = z.object({ revision: z.number().int().nonnegative(), action: z.enum(["withdraw", "process", "reject", "resolve"]), resolution: z.string().trim().min(2).max(2000).optional(), resolvedPublicationId: z.string().optional() }).parse(input);
  return termTransaction(sessionId, termId, ["ADMIN", "STUDENT"], ["ACTIVE", "CHECKING"], async (tx, term, actorId) => {
    const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId } });
    const appeal = await tx.resultAppeal.findUnique({ where: { id }, include: { publication: true } });
    if (!appeal || appeal.termId !== termId || (actor.role !== "ADMIN" && appeal.studentId !== actorId)) throw new AccountError("异议不存在或无权查看", 404);
    if (appeal.revision !== data.revision) throw new AccountError("异议已变化，请刷新", 409);
    if (!["OPEN", "PROCESSING"].includes(appeal.status)) throw new AccountError("异议已结束，不可重复处理", 409);
    let status: "WITHDRAWN" | "PROCESSING" | "RESOLVED" | "REJECTED";
    if (data.action === "withdraw") {
      if (appeal.studentId !== actorId) throw new AccountError("只能撤回本人异议", 403);
      if (appeal.status !== "OPEN") throw new AccountError("异议已开始处理，不可撤回", 409);
      status = "WITHDRAWN";
    } else {
      if (actor.role !== "ADMIN") throw new AccountError("没有异议处理权限", 403);
      if (data.action === "process") { if (appeal.status !== "OPEN") throw new AccountError("异议已开始处理", 409); status = "PROCESSING"; }
      else {
        if (!data.resolution) throw new AccountError("请填写处理结论");
        status = data.action === "reject" ? "REJECTED" : "RESOLVED";
        if (status === "RESOLVED") {
          if (!data.resolvedPublicationId || data.resolvedPublicationId !== term.publishedResultSetId) throw new AccountError("认可异议须关联实际更正后的当前发布版本", 409);
          const corrected = await tx.publishedResult.findUnique({ where: { publicationId_studentId: { publicationId: data.resolvedPublicationId, studentId: appeal.studentId } }, include: { publication: true } });
          if (!corrected || corrected.publication.termId !== termId || corrected.publication.sequence <= appeal.publication.sequence || corrected.resultHash === appeal.resultHash) throw new AccountError("尚未发现该学生实际更正后的新结果，不能标记已解决", 409);
        }
      }
    }
    const updated = await tx.resultAppeal.update({ where: { id }, data: { status, revision: { increment: 1 }, resolution: data.resolution, reviewerId: actor.role === "ADMIN" ? actorId : undefined, resolvedPublicationId: status === "RESOLVED" ? data.resolvedPublicationId : undefined } });
    await tx.auditEvent.create({ data: { actorId, action: "APPEAL_CHANGED", targetId: id, details: { termId, before: appeal.status, after: status, resolution: data.resolution ?? null, resolvedPublicationId: data.resolvedPublicationId ?? null } } });
    return updated;
  });
}
export async function pageAppeals(sessionId: string, termId: string, page = 1, status?: string) {
  const safePage = z.number().int().min(1).max(100000).parse(page);
  const parsed = z.enum(["OPEN", "PROCESSING", "RESOLVED", "REJECTED", "WITHDRAWN"]).optional().parse(status || undefined);
  return termTransaction(sessionId, termId, ["ADMIN", "STUDENT"], ["CONFIGURATION", "ACTIVE", "CHECKING", "LOCKED"], async (tx, _term, actorId) => {
    const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId } });
    const where = { termId, ...(actor.role === "STUDENT" ? { studentId: actorId } : {}), ...(parsed ? { status: parsed } : {}) };
    const items = await tx.resultAppeal.findMany({ where, include: { publication: { select: publicationSelect }, evidence: { select: { evidence: { select: { id: true, name: true } } } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 20, skip: (safePage - 1) * 20 });
    const students = await tx.publishedResult.findMany({ where: { publicationId: { in: items.map(i => i.publicationId) }, studentId: { in: items.map(i => i.studentId) } }, select: { studentId: true, publicationId: true, name: true, login: true } });
    return { items: items.map(i => ({ ...i, student: students.find(s => s.studentId === i.studentId && s.publicationId === i.publicationId) ?? null, evidence: i.evidence.map(e => e.evidence) })), total: await tx.resultAppeal.count({ where }), page: safePage };
  }, "read");
}
