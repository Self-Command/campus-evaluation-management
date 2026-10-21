import { randomBytes, createHash } from "node:crypto";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import { db } from "@/server/db";
import { getCurrentSession } from "@/server/auth";
import { AccountError } from "@/server/accounts";
import { scopedTransaction, scopedStudentWhere } from "@/server/access-scope";
export const evidenceLimit = 5 * 1024 * 1024;
// Evidence is runtime data on a separate volume, never a deployment build input.
export const evidenceRoot = () => resolve(/* turbopackIgnore: true */ process.env.EVIDENCE_DIR ?? ".local/evidence");
function identify(bytes: Buffer) {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.subarray(12, 16).toString() === "IHDR") return "image/png";
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217) return "image/jpeg";
  if (bytes.subarray(0, 5).toString() === "%PDF-" && bytes.subarray(-1024).includes(Buffer.from("%%EOF"))) return "application/pdf";
  throw new AccountError("证明只支持可识别的 PNG、JPEG 或 PDF 文件");
}
export async function uploadEvidence(sessionId: string, name: string, bytes: Buffer) {
  const current = await getCurrentSession(sessionId);
  if (!current || current.user.mustChangePassword) throw new AccountError("请重新登录", 401);
  if (!bytes.length || bytes.length > evidenceLimit) throw new AccountError("每份证明需在5MB以内");
  const mime = identify(bytes);
  if (await db.evidence.count({ where: { ownerId: current.userId, references: { none: {} }, claimReferences: { none: {} }, appealReferences: { none: {} }, createdAt: { gt: new Date(Date.now() - 86400_000) } } }) >= 30) throw new AccountError("待关联证明过多，请先完成提交");
  const storageKey = randomBytes(24).toString("hex");
  await mkdir(evidenceRoot(), { recursive: true });
  const path = join(/* turbopackIgnore: true */ evidenceRoot(), storageKey);
  await writeFile(path, bytes, { flag: "wx" });
  try {
    const session = await getCurrentSession(sessionId);
    if (!session || session.userId !== current.userId || session.user.mustChangePassword) throw new AccountError("会话已失效", 401);
    return await db.evidence.create({ data: { ownerId: current.userId, name: name.replace(/[\\/\x00-\x1f]/g, "_").slice(0, 200) || "证明文件", storageKey, mime, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }, select: { id: true, name: true, size: true, mime: true } });
  } catch (error) { await unlink(path).catch(() => {}); throw error; }
}
export async function downloadEvidence(sessionId: string, id: string) {
  return scopedTransaction(sessionId, ["ADMIN", "PUBLISHER", "COLLEGE", "COUNSELOR", "STUDENT"], false, async (tx, actor) => {
  const file = await tx.evidence.findUnique({ where: { id }, include: { references: { include: { source: { include: { participation: { include: { activity: true } } } } } }, claimReferences: { select: { claim: { select: { studentId: true } } } }, appealReferences: { select: { appeal: { select: { studentId: true } } } } } });
  if (!file) throw new AccountError("证明不存在", 404);
  const allowedByReference = actor.role === "ADMIN" || file.ownerId === actor.id || (actor.role === "STUDENT" && (file.claimReferences.some(r => r.claim.studentId === actor.id) || file.appealReferences.some(r => r.appeal.studentId === actor.id))) || file.references.some(reference => {
    const participation = reference.source.participation;
    return actor.role === "STUDENT" ? participation.studentId === actor.id : participation.activity.ownerId === actor.id;
  });
  const studentIds = [...new Set([...file.references.map(r => r.source.participation.studentId), ...file.claimReferences.map(r => r.claim.studentId), ...file.appealReferences.map(r => r.appeal.studentId)])];
  const allowedByScope = !allowedByReference && (actor.role === "COLLEGE" || actor.role === "COUNSELOR") && studentIds.length > 0 && await tx.user.count({ where: { AND: [scopedStudentWhere(actor), { id: { in: studentIds } }] } }) > 0;
  if (!allowedByReference && !allowedByScope) throw new AccountError("没有查看该证明的权限", 403);
  if (!/^[a-f0-9]{48}$/.test(file.storageKey)) throw new AccountError("证明存储标识无效", 500);
  const bytes = await readFile(/* turbopackIgnore: true */ join(/* turbopackIgnore: true */ evidenceRoot(), file.storageKey));
  if (createHash("sha256").update(bytes).digest("hex") !== file.sha256) throw new AccountError("证明文件校验失败", 500);
  if (identify(bytes) !== file.mime) throw new AccountError("证明文件类型校验失败", 500);
  return { file, bytes };
  });
}
