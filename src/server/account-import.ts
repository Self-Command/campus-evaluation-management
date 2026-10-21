import { createHash, randomBytes } from "node:crypto";
import { hash } from "bcryptjs";
import { z } from "zod";
import { AccountError, adminTransaction } from "@/server/accounts";
import { classIdentityInclude, classProfile, configuredClass, recordStudentAffiliation } from "@/server/organizations";
import type { Prisma } from "@/generated/prisma/client";

export const importFields = ["login", "name", "college", "major", "className"] as const;
export type ImportRow = Record<(typeof importFields)[number], string>;
export type PreviewRow = { line: number; data: ImportRow; state: "NEW" | "SKIP" | "ERROR"; message: string };
const rowsSchema = z.array(z.object({ login: z.string().max(200), name: z.string().max(200), college: z.string().max(200), major: z.string().max(200), className: z.string().max(200) })).min(1).max(100);
const identitySchema = z.object({ login: z.string().min(3).max(64).regex(/^[A-Za-z0-9._-]+$/), name: z.string().min(1).max(80), college: z.string().min(1).max(80), major: z.string().min(1).max(80), className: z.string().min(1).max(80) });
async function inspect(tx: Prisma.TransactionClient, input: ImportRow[]) {
  const existing = await tx.user.findMany({ where: { login: { in: input.map(row => row.login.trim()) } }, select: { id: true, login: true, name: true, role: true, revision: true, authVersion: true, studentProfile: true }, orderBy: { login: "asc" } });
  const classes = await tx.schoolClass.findMany({ where: { name: { in: input.map(row => row.className.trim()) } }, include: classIdentityInclude, orderBy: { id: "asc" } });
  const snapshot = createHash("sha256").update(JSON.stringify({ existing, classes })).digest("hex");
  const known = new Map(existing.map(user => [user.login, user]));
  const seen = new Map<string, string>();
  const rows: PreviewRow[] = input.map((raw, index) => {
    const data = Object.fromEntries(importFields.map(key => [key, raw[key].trim()])) as ImportRow;
    const parsed = identitySchema.safeParse(data);
    if (!parsed.success) return { line: index + 2, data, state: "ERROR", message: parsed.error.issues.map(issue => `${issue.path.join(".")}：${issue.message}`).join("；") };
    const matching = classes.filter(cls => cls.name === data.className && cls.major.name === data.major && cls.major.college.name === data.college && cls.enabled && cls.major.enabled && cls.major.college.enabled);
    if (matching.length !== 1) return { line: index + 2, data, state: "ERROR", message: "学院、专业、班级必须完整匹配唯一的已启用组织目录" };
    const schoolClass = matching[0];
    if (!schoolClass.counselor || schoolClass.counselor.role !== "COUNSELOR" || schoolClass.counselor.disabled || schoolClass.counselor.collegeId !== schoolClass.major.collegeId) return { line: index + 2, data, state: "ERROR", message: "班级责任辅导员尚未配置或已失效" };
    const signature = JSON.stringify(data);
    if (seen.has(data.login)) return { line: index + 2, data, state: seen.get(data.login) === signature ? "SKIP" : "ERROR", message: seen.get(data.login) === signature ? "文件内相同记录，跳过" : "同一学号存在不同信息，请合并后重新上传" };
    seen.set(data.login, signature);
    const user = known.get(data.login);
    if (user) {
      const same = user.role === "STUDENT" && user.name === data.name && user.studentProfile?.studentNumber === data.login && user.studentProfile.classId === schoolClass.id && user.studentProfile.college === data.college && user.studentProfile.major === data.major && user.studentProfile.className === data.className;
      return { line: index + 2, data, state: same ? "SKIP" : "ERROR", message: same ? "学生账号已存在，跳过且不重置密码" : "账号已存在且信息不同，请通过账号管理核对" };
    }
    return { line: index + 2, data, state: "NEW", message: "新建学生账号" };
  });
  return { rows, snapshot, classes };
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
      const candidateClass = preview.classes.find(cls => cls.name === row.data.className && cls.major.name === row.data.major && cls.major.college.name === row.data.college && cls.enabled && cls.major.enabled && cls.major.college.enabled)!;
      const schoolClass = await configuredClass(tx, candidateClass.id);
      const user = await tx.user.create({ data: { login: row.data.login, name: row.data.name, role: "STUDENT", passwordHash: secret.passwordHash, studentProfile: { create: { studentNumber: row.data.login, ...classProfile(schoolClass) } } } });
      await recordStudentAffiliation(tx, user.id, schoolClass, actorId, `账号导入批次${id}`);
      await tx.auditEvent.create({ data: { actorId, action: "ACCOUNT_IMPORTED", targetId: user.id, details: { batchId: id } } });
      delivered.push({ login: secret.login, initialPassword: secret.initialPassword });
    }
    const result = { created: delivered.length, skipped: preview.rows.filter(row => row.state === "SKIP").length };
    await tx.accountImport.update({ where: { id }, data: { status: "COMMITTED", result } });
    await tx.auditEvent.create({ data: { actorId, action: "ACCOUNT_IMPORT_COMMITTED", targetId: id, details: result } });
    return { ...result, credentials: delivered, replay: false };
  });
}
