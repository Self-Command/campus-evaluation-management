import { createHash, randomBytes } from "node:crypto";
import { hash } from "bcryptjs";
import { z } from "zod";
import { AccountError, accountSchema, adminTransaction } from "@/server/accounts";
import type { Prisma } from "@/generated/prisma/client";

export const importFields = ["login", "name", "college", "major", "className"] as const;
export type ImportRow = Record<(typeof importFields)[number], string>;
export type PreviewRow = { line: number; data: ImportRow; state: "NEW" | "SKIP" | "ERROR"; message: string };
const rowsSchema = z.array(z.object({ login: z.string().max(200), name: z.string().max(200), college: z.string().max(200), major: z.string().max(200), className: z.string().max(200) })).min(1).max(100);
async function inspect(tx: Prisma.TransactionClient, input: ImportRow[]) {
  const existing = await tx.user.findMany({ where: { login: { in: input.map(row => row.login.trim()) } }, select: { id: true, login: true, name: true, role: true, revision: true, authVersion: true, studentProfile: true }, orderBy: { login: "asc" } });
  const snapshot = createHash("sha256").update(JSON.stringify(existing)).digest("hex");
  const known = new Map(existing.map(user => [user.login, user]));
  const seen = new Map<string, string>();
  const rows: PreviewRow[] = input.map((raw, index) => {
    const data = Object.fromEntries(importFields.map(key => [key, raw[key].trim()])) as ImportRow;
    const parsed = accountSchema.safeParse({ ...data, role: "STUDENT" });
    if (!parsed.success) return { line: index + 2, data, state: "ERROR", message: parsed.error.issues.map(issue => `${issue.path.join(".")}：${issue.message}`).join("；") };
    const signature = JSON.stringify(data);
    if (seen.has(data.login)) return { line: index + 2, data, state: seen.get(data.login) === signature ? "SKIP" : "ERROR", message: seen.get(data.login) === signature ? "文件内相同记录，跳过" : "同一学号存在不同信息，请合并后重新上传" };
    seen.set(data.login, signature);
    const user = known.get(data.login);
    if (user) {
      const same = user.role === "STUDENT" && user.name === data.name && user.studentProfile?.studentNumber === data.login && user.studentProfile.college === data.college && user.studentProfile.major === data.major && user.studentProfile.className === data.className;
      return { line: index + 2, data, state: same ? "SKIP" : "ERROR", message: same ? "学生账号已存在，跳过且不重置密码" : "账号已存在且信息不同，请通过账号管理核对" };
    }
    return { line: index + 2, data, state: "NEW", message: "新建学生账号" };
  });
  return { rows, snapshot };
}
export async function previewAccountImport(sessionId: string, input: unknown) {
  const data = rowsSchema.parse(input);
  return adminTransaction(sessionId, async (tx, actorId) => {
    const preview = await inspect(tx, data);
    const batch = await tx.accountImport.create({ data: { actorId, rows: data, snapshot: preview.snapshot, expiresAt: new Date(Date.now() + 15 * 60_000) } });
    return { id: batch.id, expiresAt: batch.expiresAt, rows: preview.rows, errors: preview.rows.filter(row => row.state === "ERROR").length };
  });
}
export async function commitAccountImport(sessionId: string, id: string) {
  // Authorize and validate before expensive hashing; revalidate after preparation.
  const candidate = await adminTransaction(sessionId, async (tx, actorId) => {
    const batch = await tx.accountImport.findUnique({ where: { id } });
    if (!batch) throw new AccountError("导入批次不存在", 404);
    if (batch.actorId !== actorId) throw new AccountError("不能提交其他管理员的导入批次", 403);
    const data = rowsSchema.parse(batch.rows);
    if (batch.status === "COMMITTED") return { data, rows: [] as PreviewRow[] };
    if (batch.expiresAt <= new Date()) throw new AccountError("预览已过期，请重新上传预览", 409);
    const preview = await inspect(tx, data);
    if (preview.snapshot !== batch.snapshot) throw new AccountError("预览后的账号数据已变化，请重新预览", 409);
    if (preview.rows.some(row => row.state === "ERROR")) throw new AccountError("名单中存在错误行，本批次未写入");
    return { data, rows: preview.rows };
  });
  const data = candidate.data;
  const credentials = new Map<string, { login: string; initialPassword: string; passwordHash: string }>();
  for (const row of candidate.rows.filter(row => row.state === "NEW")) {
    const login = row.data.login;
    if (credentials.has(login)) continue;
    const initialPassword = `Init!${randomBytes(18).toString("base64url")}7a`;
    credentials.set(login, { login, initialPassword, passwordHash: await hash(initialPassword, 12) });
  }
  return adminTransaction(sessionId, async (tx, actorId) => {
    const batch = await tx.accountImport.findUniqueOrThrow({ where: { id } });
    if (batch.actorId !== actorId) throw new AccountError("不能提交其他管理员的导入批次", 403);
    if (batch.status === "COMMITTED") return { ...(batch.result as { created: number; skipped: number }), credentials: [], replay: true };
    if (batch.expiresAt < new Date()) throw new AccountError("预览已过期，请重新上传预览", 409);
    const preview = await inspect(tx, data);
    if (preview.snapshot !== batch.snapshot) throw new AccountError("预览后的账号数据已变化，请重新预览", 409);
    if (preview.rows.some(row => row.state === "ERROR")) throw new AccountError("名单中存在错误行，本批次未写入");
    const delivered: { login: string; initialPassword: string }[] = [];
    for (const row of preview.rows.filter(row => row.state === "NEW")) {
      const secret = credentials.get(row.data.login)!;
      const user = await tx.user.create({ data: { login: row.data.login, name: row.data.name, role: "STUDENT", passwordHash: secret.passwordHash, studentProfile: { create: { studentNumber: row.data.login, college: row.data.college, major: row.data.major, className: row.data.className } } } });
      await tx.auditEvent.create({ data: { actorId, action: "ACCOUNT_IMPORTED", targetId: user.id, details: { batchId: id } } });
      delivered.push({ login: secret.login, initialPassword: secret.initialPassword });
    }
    const result = { created: delivered.length, skipped: preview.rows.filter(row => row.state === "SKIP").length };
    await tx.accountImport.update({ where: { id }, data: { status: "COMMITTED", result } });
    await tx.auditEvent.create({ data: { actorId, action: "ACCOUNT_IMPORT_COMMITTED", targetId: id, details: result } });
    return { ...result, credentials: delivered, replay: false };
  });
}
