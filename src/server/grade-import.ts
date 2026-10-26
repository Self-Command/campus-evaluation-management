import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma, Term } from "@/generated/prisma/client";
import { AccountError } from "@/server/accounts";
import { termTransaction } from "@/server/terms";
import { validateScheme } from "@/lib/scoring/validate";
import { Rational } from "@/lib/scoring/rational";
import { decimalSchema } from "@/lib/scoring/types";
import { jsonValue } from "@/server/claims";
import { inputHistoryEntry } from "@/server/input-review";
import {
  duplicateIdentityMessage,
  identityLoginVariants,
  identityNameKey,
  identityNumberKey,
  loadIdentityIndex,
  organizationMismatchWarning,
} from "@/server/student-identity";
import { recordAudit } from "@/server/audit";

const rowsSchema = z.array(z.object({
  login: z.string().trim().max(64),
  name: z.string().trim().max(80),
  college: z.string().trim().max(80).optional().default(""),
  major: z.string().trim().max(80).optional().default(""),
  className: z.string().trim().max(80).optional().default(""),
  value: z.string().trim().max(200),
})).min(1).max(100);
export type GradePreviewRow = { line: number; login: string; name: string; college: string; major: string; className: string; before: string | null; value: string; state: "NEW" | "SAME" | "OVERWRITE" | "SKIP" | "ERROR"; message: string; warnings: string[] };
type Actor = { id: string; role: string };

// Counselors import into their own classes and every row becomes a pending college
// revision; administrators keep the separately audited direct import.
async function inspect(tx: Prisma.TransactionClient, term: Term, nodeId: string, rows: z.infer<typeof rowsSchema>, actor: Actor) {
  const node = validateScheme(term.scheme).nodes.get(nodeId);
  if (!node || node.kind !== "GRADE") throw new AccountError("目标必须为成绩输入模块");
  const frozen = actor.role === "ADMIN" && term.cohortPolicy === "PREVIOUS" && term.cohortPublicationId;
  const queryLogins = [...new Set(rows.flatMap(row => identityLoginVariants(row.login)))];
  const students = frozen
    ? (await tx.publishedResult.findMany({ where: { publicationId: term.cohortPublicationId!, login: { in: queryLogins, mode: "insensitive" } }, orderBy: { studentId: "asc" } })).map(row => ({ id: row.studentId, login: row.login, name: row.name, role: "STUDENT" as const, disabled: false, revision: 0, studentProfile: { userId: row.studentId, studentNumber: row.login, college: row.college, major: row.major, className: row.className } }))
    : await tx.user.findMany({
      where: {
        login: { in: queryLogins, mode: "insensitive" }, role: "STUDENT", disabled: false, studentProfile: { isNot: null },
        ...(actor.role === "COUNSELOR" ? { AND: [{ studentProfile: { is: { schoolClass: { is: { enabled: true, counselorId: actor.id, major: { is: { enabled: true, college: { is: { enabled: true } } } } } } } } }] } : {}),
      },
      select: { id: true, login: true, name: true, role: true, disabled: true, revision: true, studentProfile: true }, orderBy: { id: "asc" },
    });
  const ids = students.map(student => student.id);
  const liveProfiles = ids.length
    ? await tx.studentProfile.findMany({
      where: { userId: { in: ids } },
      select: { userId: true, studentNumber: true, classId: true, college: true, major: true, className: true },
      orderBy: { userId: "asc" },
    })
    : [];
  const liveProfileByStudent = new Map(liveProfiles.map(profile => [profile.userId, profile]));
  const identityIndex = await loadIdentityIndex(
    tx,
    liveProfiles.map(profile => ({
      classId: profile.classId,
      college: profile.college,
      major: profile.major,
      className: profile.className,
    })),
  );
  const [grades, pending] = await Promise.all([
    tx.gradeInput.findMany({ where: { termId: term.id, nodeId, studentId: { in: ids } }, orderBy: { id: "asc" } }),
    ids.length ? tx.gradeChange.findMany({ where: { termId: term.id, nodeId, studentId: { in: ids }, status: { in: ["PENDING_COLLEGE", "RETURNED"] } }, select: { studentId: true } }) : [],
  ]);
  const studentsByLogin = new Map<string, (typeof students)[number][]>();
  for (const student of students) {
    const key = identityNumberKey(student.login);
    const list = studentsByLogin.get(key) ?? [];
    list.push(student);
    studentsByLogin.set(key, list);
  }
  const known = new Map<string, (typeof students)[number]>();
  const ambiguous = new Set<string>();
  for (const [key, list] of studentsByLogin) {
    if (list.length === 1) known.set(key, list[0]);
    else ambiguous.add(key);
  }
  const previous = new Map(grades.map(grade => [grade.studentId, grade]));
  const waiting = new Set(pending.map(row => row.studentId));
  const review = actor.role === "COUNSELOR";
  const seen = new Map<string, string>();
  const preview: GradePreviewRow[] = rows.map((row, index) => {
    const key = identityNumberKey(row.login);
    const student = ambiguous.has(key) ? undefined : known.get(key);
    const profile = student?.studentProfile;
    const grade = student ? previous.get(student.id) : undefined;
    const base: GradePreviewRow = {
      line: index + 2,
      login: student?.login ?? row.login,
      name: student?.name ?? row.name,
      college: profile?.college ?? row.college,
      major: profile?.major ?? row.major,
      className: profile?.className ?? row.className,
      before: grade?.value.toFixed() ?? null,
      value: row.value,
      state: "NEW",
      message: "",
      warnings: [],
    };
    if (ambiguous.has(key)) return { ...base, state: "ERROR", message: "学号存在多个匹配账号，请先在账号管理中处置重复账号" };
    if (!student || student.role !== "STUDENT" || student.disabled || !profile) return { ...base, state: "ERROR", message: review ? "学号未匹配本人负责班级的有效学生档案" : "学号未匹配有效学生档案" };
    if (identityNameKey(student.name) !== identityNameKey(row.name)) return { ...base, state: "ERROR", message: "学号与姓名不一致，请核对后重新导出模板" };
    const warning = organizationMismatchWarning(row, profile);
    const checked = warning ? { ...base, warnings: [warning] } : base;
    const identityProfile = liveProfileByStudent.get(student.id);
    const duplicateCandidates = identityIndex.candidatesFor({
      userId: student.id,
      studentNumber: identityProfile?.studentNumber ?? row.login,
      name: student.name,
      classId: identityProfile?.classId ?? null,
      college: identityProfile?.college ?? profile.college,
      major: identityProfile?.major ?? profile.major,
      className: identityProfile?.className ?? profile.className,
    });
    if (duplicateCandidates.length) return { ...checked, state: "ERROR", message: `${duplicateIdentityMessage(duplicateCandidates)} 成绩导入在重复账号处置前不可写入。` };
    if (waiting.has(student.id)) return { ...checked, state: "ERROR", message: "该学生此成绩项已有待审或退回中的修订，请先在成绩页处理" };
    if (!decimalSchema.safeParse(row.value).success) return { ...checked, state: "ERROR", message: "成绩必须为合法十进制数，最多12位小数" };
    const value = Rational.from(row.value);
    if (value.compare(Rational.from(node.minimum)) < 0 || value.compare(Rational.from(node.maximum)) > 0) return { ...checked, state: "ERROR", message: `成绩应在${node.minimum}至${node.maximum}范围内` };
    const duplicate = seen.get(key);
    if (duplicate !== undefined) return { ...checked, state: Rational.from(duplicate).compare(value) === 0 ? "SKIP" : "ERROR", message: Rational.from(duplicate).compare(value) === 0 ? "文件内相同成绩，跳过" : "同一学号出现不同成绩，请先核对" };
    seen.set(key, row.value);
    if (grade && Rational.from(grade.value.toFixed()).compare(value) === 0) return { ...checked, state: "SAME", message: "与当前有效成绩相同，不重复提交" };
    if (review) return { ...checked, state: grade ? "OVERWRITE" : "NEW", message: grade ? `提交学院审核，通过后替换 ${grade.value.toFixed()}` : "提交学院审核，通过后成为有效成绩" };
    return { ...checked, state: grade ? "OVERWRITE" : "NEW", message: grade ? "覆盖当前成绩并保留更正记录" : "新增成绩输入" };
  });
  return { rows: preview, known, previous, waiting, warnings: preview.reduce((total, row) => total + row.warnings.length, 0), snapshot: createHash("sha256").update(JSON.stringify({ revision: term.revision, node, students, grades, pending, identity: identityIndex.snapshot })).digest("hex") };
}
type PreviewMeta = { fileHash?: string; templateVersion?: string; requestId?: string };
export async function previewGradeImport(sessionId: string, termId: string, input: unknown, meta: PreviewMeta = {}) {
  const data = z.object({ nodeId: z.string().min(1), rows: rowsSchema, reason: z.string().trim().min(2).max(1000) }).parse(input);
  return termTransaction(sessionId, termId, ["ADMIN", "COUNSELOR"], ["ACTIVE"], async (tx, term, actorId) => {
    const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId }, select: { id: true, role: true } });
    const preview = await inspect(tx, term, data.nodeId, data.rows, actor);
    const requestId = meta.requestId ?? randomUUID();
    const batch = await tx.gradeImport.create({ data: {
      termId: term.id,
      actorId,
      nodeId: data.nodeId,
      rows: data.rows,
      reason: data.reason,
      snapshot: preview.snapshot,
      fileHash: meta.fileHash ?? null,
      templateVersion: meta.templateVersion ?? "grades-v4",
      scopeKey: `${term.id}:grades:${data.nodeId}`,
      requestId,
      expiresAt: new Date(Date.now() + 15 * 60_000),
    } });
    return { id: batch.id, requestId, templateVersion: batch.templateVersion, rows: preview.rows, errors: preview.rows.filter(row => row.state === "ERROR").length, warnings: preview.warnings, review: actor.role === "COUNSELOR", expiresAt: batch.expiresAt };
  });
}
export async function commitGradeImport(sessionId: string, termId: string, id: string) {
  return termTransaction(sessionId, termId, ["ADMIN", "COUNSELOR"], ["ACTIVE"], async (tx, term, actorId) => {
    const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId }, select: { id: true, role: true } });
    const batch = await tx.gradeImport.findUnique({ where: { id } });
    if (!batch || batch.termId !== term.id) throw new AccountError("成绩导入批次不存在", 404);
    if (batch.actorId !== actorId) throw new AccountError("不能提交他人的成绩批次", 403);
    if (batch.status === "COMMITTED") {
      const stored = batch.result as { written: number; skipped: number; warnings?: number };
      return { ...stored, warnings: stored.warnings ?? 0, replay: true };
    }
    if (batch.expiresAt <= new Date()) throw new AccountError("成绩预览已过期", 409);
    const preview = await inspect(tx, term, batch.nodeId, rowsSchema.parse(batch.rows), actor);
    if (preview.snapshot !== batch.snapshot) throw new AccountError("预览后成绩或学生记录已变化，请重新预览", 409);
    if (preview.rows.some(row => row.state === "ERROR")) throw new AccountError("成绩存在错误行，本批次未写入");
    const changed = preview.rows.filter(row => row.state === "NEW" || row.state === "OVERWRITE");
    if (actor.role === "COUNSELOR") {
      let submitted = 0;
      for (const row of changed) {
        const student = preview.known.get(identityNumberKey(row.login))!, previous = preview.previous.get(student.id);
        await tx.gradeChange.create({
          data: {
            termId, studentId: student.id, nodeId: batch.nodeId, value: row.value, reason: batch.reason,
            requestId: `${batch.id}:${student.id}`, submittedBy: actorId,
            baseInputId: previous?.id ?? null, baseRevision: previous?.revision ?? null, baseValue: previous?.value ?? null,
            history: jsonValue([inputHistoryEntry(actorId, "SUBMITTED", { importBatchId: batch.id, value: row.value, baseValue: previous?.value.toFixed() ?? null, reason: batch.reason })]),
          },
        });
        submitted++;
      }
      const result = { written: 0, submitted, skipped: preview.rows.length - submitted, submittedForReview: true, warnings: preview.warnings };
      await tx.gradeImport.update({ where: { id }, data: {
        status: "COMMITTED",
        result,
        rowResults: preview.rows,
        confirmations: [],
        committedAt: new Date(),
      } });
      await recordAudit(tx, { actorId, action: "GRADE_IMPORT_SUBMITTED", targetId: id, details: { termId, nodeId: batch.nodeId, submitted, skipped: result.skipped, warnings: result.warnings, fileHash: batch.fileHash, templateVersion: batch.templateVersion, requestId: batch.requestId } });
      return { ...result, replay: false };
    }
    let written = 0;
    for (const row of changed) {
      const student = preview.known.get(identityNumberKey(row.login))!, previous = preview.previous.get(student.id);
      const saved = previous ? await tx.gradeInput.update({ where: { id: previous.id }, data: { value: row.value, revision: { increment: 1 } } }) : await tx.gradeInput.create({ data: { termId, studentId: student.id, nodeId: batch.nodeId, value: row.value } });
      await recordAudit(tx, { actorId, action: "GRADE_IMPORTED", targetId: saved.id, details: { termId, batchId: id, studentId: student.id, nodeId: batch.nodeId, before: row.before, after: row.value, reason: batch.reason } });
      written++;
    }
    const result = { written, skipped: preview.rows.length - written, warnings: preview.warnings };
    if (written) await tx.term.update({ where: { id: termId }, data: { inputRevision: { increment: 1 } } });
    await tx.gradeImport.update({ where: { id }, data: {
      status: "COMMITTED",
      result,
      rowResults: preview.rows,
      confirmations: [],
      committedAt: new Date(),
    } });
    await recordAudit(tx, { actorId, action: "GRADE_IMPORT_COMMITTED", targetId: id, details: { ...result, termId, fileHash: batch.fileHash, templateVersion: batch.templateVersion, requestId: batch.requestId } });
    return { ...result, replay: false };
  });
}
