import { z } from "zod";
import { AccountError } from "@/server/accounts";
import { termTransaction } from "@/server/terms";
export async function inputHistory(sessionId: string, input: unknown) {
  const data = z.object({ termId: z.string(), kind: z.enum(["grade", "deduction"]), id: z.string(), page: z.coerce.number().int().min(1).max(100000).default(1) }).parse(input);
  return termTransaction(sessionId, data.termId, ["ADMIN", "STUDENT"], ["CONFIGURATION", "ACTIVE", "CHECKING", "LOCKED"], async (tx, _term, actorId) => {
    const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId } });
    const record = data.kind === "grade" ? await tx.gradeInput.findUnique({ where: { id: data.id } }) : await tx.deductionInput.findUnique({ where: { id: data.id } });
    if (!record || record.termId !== data.termId || (actor.role !== "ADMIN" && record.studentId !== actorId)) throw new AccountError("输入记录不存在或无权查看历史", 404);
    const where = { targetId: data.id, action: { in: data.kind === "grade" ? ["GRADE_SAVED", "GRADE_IMPORTED"] : ["DEDUCTION_SAVED", "DEDUCTION_REVOKED"] } };
    const [events, total] = await Promise.all([tx.auditEvent.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 20, skip: (data.page - 1) * 20 }), tx.auditEvent.count({ where })]);
    const actors = await tx.user.findMany({ where: { id: { in: events.flatMap(event => event.actorId ? [event.actorId] : []) } }, select: { id: true, name: true, login: true } });
    return { items: events.map(event => { const details = (event.details ?? {}) as Record<string, unknown>; return { id: event.id, at: event.createdAt, actor: actors.find(user => user.id === event.actorId) ?? null, action: event.action, before: details.before ?? null, after: details.after ?? null, reason: typeof details.reason === "string" ? details.reason : "" }; }), total, page: data.page };
  });
}
