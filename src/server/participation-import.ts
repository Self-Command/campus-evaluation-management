import { createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { AccountError } from "@/server/accounts";
import { termTransaction } from "@/server/terms";
import { assertActivityOwner, eligible } from "@/server/activity-policy";
import { registerFact } from "@/server/activity-participants";
import { historyEntry, jsonValue } from "@/server/claims";
const rowsSchema = z.array(z.string().trim().min(1).max(64)).min(1).max(100);
const evidenceSchema = z.array(z.string().min(1)).min(1).max(5);
export type ParticipationPreviewRow = { line: number; login: string; name: string; state: "NEW" | "EXISTING" | "SKIP" | "ERROR"; message: string };
async function inspect(tx: Prisma.TransactionClient, termId: string, actorId: string, activityId: string, logins: string[], evidenceIds: string[]) {
  const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId } });
  const activity = await tx.activity.findUnique({ where: { id: activityId } });
  if (!activity || activity.termId !== termId) throw new AccountError("活动不存在", 404);
  assertActivityOwner(activity, actor);
  if (!activity.confirmed) throw new AccountError("活动分值尚未确认", 409);
  const evidence = await tx.evidence.findMany({ where: { id: { in: [...new Set(evidenceIds)] }, ownerId: actorId }, select: { id: true, sha256: true }, orderBy: { id: "asc" } });
  if (evidence.length !== new Set(evidenceIds).size) throw new AccountError("共享证明不存在或不属于当前提交者", 403);
  const students = await tx.user.findMany({ where: { login: { in: logins } }, select: { id: true, login: true, name: true, role: true, disabled: true, revision: true, studentProfile: true }, orderBy: { id: "asc" } });
  const facts = await tx.participation.findMany({ where: { activityId, studentId: { in: students.map(student => student.id) } }, include: { sources: { select: { id: true, submitterId: true, status: true, revision: true }, orderBy: { id: "asc" } } }, orderBy: { id: "asc" } });
  const known = new Map(students.map(student => [student.login, student]));
  const existing = new Map(facts.map(fact => [fact.studentId, fact]));
  const seen = new Set<string>();
  const rows: ParticipationPreviewRow[] = logins.map((login, index) => {
    const student = known.get(login), base = { line: index + 2, login, name: student?.name ?? "" };
    if (!student || student.role !== "STUDENT" || student.disabled || !student.studentProfile) return { ...base, state: "ERROR", message: "学号未匹配到有效学生档案" };
    if (!eligible(activity, student)) return { ...base, state: "ERROR", message: "学生不同时满足活动的学院、班级和指定学生范围" };
    if (seen.has(login)) return { ...base, state: "SKIP", message: "文件内重复学号，跳过" };
    seen.add(login);
    const fact = existing.get(student.id);
    if (fact?.registeredAt && fact.sources.some(source => source.status === "APPROVED")) return { ...base, state: "SKIP", message: "已有有效参与认定，不重复提交或计分" };
    if (fact?.registeredAt && fact.sources.some(source => source.submitterId === actorId && source.status === "PENDING")) return { ...base, state: "SKIP", message: "本人已有待审核提交，跳过" };
    return { ...base, state: fact ? "EXISTING" : "NEW", message: fact ? "复用已有参与事实并补充来源" : "新增参与事实并提交审核" };
  });
  const term = await tx.term.findUniqueOrThrow({ where: { id: termId }, select: { revision: true } });
  const snapshot = createHash("sha256").update(JSON.stringify({ activity, term, evidence, students, facts })).digest("hex");
  return { rows, snapshot, known };
}
export async function previewParticipationImport(sessionId: string, termId: string, input: unknown) {
  const data = z.object({ activityId: z.string().min(1), logins: rowsSchema, evidenceIds: evidenceSchema, note: z.string().trim().min(1).max(2000) }).parse(input);
  return termTransaction(sessionId, termId, ["ADMIN", "PUBLISHER"], ["ACTIVE"], async (tx, term, actorId) => {
    const preview = await inspect(tx, term.id, actorId, data.activityId, data.logins, data.evidenceIds);
    const batch = await tx.participationImport.create({ data: { termId, activityId: data.activityId, actorId, rows: data.logins, evidenceIds: [...new Set(data.evidenceIds)], note: data.note, snapshot: preview.snapshot, expiresAt: new Date(Date.now() + 15 * 60_000) } });
    return { id: batch.id, expiresAt: batch.expiresAt, rows: preview.rows, errors: preview.rows.filter(row => row.state === "ERROR").length };
  });
}
export async function commitParticipationImport(sessionId: string, termId: string, id: string) {
  return termTransaction(sessionId, termId, ["ADMIN", "PUBLISHER"], ["ACTIVE"], async (tx, term, actorId) => {
    const batch = await tx.participationImport.findUnique({ where: { id } });
    if (!batch || batch.termId !== term.id) throw new AccountError("导入批次不存在", 404);
    if (batch.actorId !== actorId) throw new AccountError("不能提交他人的导入批次", 403);
    const activity = await tx.activity.findUnique({ where: { id: batch.activityId } });
    const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId } });
    if (!activity) throw new AccountError("活动不存在", 404);
    assertActivityOwner(activity, actor);
    if (batch.status === "COMMITTED") return { ...(batch.result as { submitted: number; skipped: number }), replay: true };
    if (batch.expiresAt <= new Date()) throw new AccountError("名单预览已过期，请重新预览", 409);
    const evidenceIds = evidenceSchema.parse(batch.evidenceIds), logins = rowsSchema.parse(batch.rows);
    const preview = await inspect(tx, termId, actorId, batch.activityId, logins, evidenceIds);
    if (preview.snapshot !== batch.snapshot) throw new AccountError("预览后的活动或学生记录已变化，请重新预览", 409);
    if (preview.rows.some(row => row.state === "ERROR")) throw new AccountError("名单存在错误，本批次未写入");
    let submitted = 0;
    for (const row of preview.rows.filter(row => row.state === "NEW" || row.state === "EXISTING")) {
      const student = preview.known.get(row.login)!;
      const fact = await registerFact(tx, batch.activityId, student, actorId, batch.id);
      await tx.recognitionSource.create({ data: { participationId: fact.id, submitterId: actorId, origin: "IMPORT", importBatchId: batch.id, note: batch.note, history: jsonValue([historyEntry(actorId, "IMPORTED", { batchId: batch.id, note: batch.note, evidenceIds })]), evidence: { create: evidenceIds.map(evidenceId => ({ evidenceId })) } } });
      submitted++;
    }
    const result = { submitted, skipped: preview.rows.filter(row => row.state === "SKIP").length };
    await tx.participationImport.update({ where: { id }, data: { status: "COMMITTED", result } });
    await tx.auditEvent.create({ data: { actorId, action: "PARTICIPATION_IMPORT_COMMITTED", targetId: id, details: { ...result, termId, activityId: batch.activityId } } });
    return { ...result, replay: false };
  });
}
