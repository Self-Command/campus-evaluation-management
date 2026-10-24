import type { Prisma, Term } from "@/generated/prisma/client";
import { exportDateText } from "@/lib/business-labels";
import { AccountError } from "@/server/account-error";
import { EXPORT_BATCH_SIZE, chunkItems } from "@/server/export-limits";
import { Rational } from "@/lib/scoring/rational";
import { validateScheme } from "@/lib/scoring/validate";
import type { Scheme } from "@/lib/scoring/types";

// Shared export data loader. Outside a published/locked term the workbook is explicitly
// labelled as the current entry progress. Once results are published or locked, identity
// and inputs are read from the frozen PublishedResult payload, never from live tables.

export type GradeExportStudent = {
  id: string;
  login: string;
  name: string;
  studentNumber: string;
  college: string;
  major: string;
  className: string;
  values: Record<string, string>;
  deductions: Record<string, string>;
};

export type ExportSnapshot = {
  scheme: Scheme;
  termRevision: number;
  batchLabel: string;
  published: boolean;
  publicationId: string | null;
  publicationSequence: number | null;
  publishedAt: string | null;
};

type PublishedPayload = {
  student?: { id?: string; login?: string; name?: string; profile?: { studentNumber?: string; college?: string; major?: string; className?: string } | null };
  grades?: { nodeId?: string; value?: string }[];
  participations?: { nodeId?: string; points?: string | null; name?: string }[];
  claims?: { nodeId?: string; points?: string | null; name?: string }[];
  deductions?: { projectId?: string; amount?: string }[];
};

const phaseText = (term: Term) => term.phase === "CONFIGURATION" ? "配置阶段" : term.phase === "ACTIVE" ? "录入阶段" : term.phase === "CHECKING" ? "核对阶段" : "锁定阶段";

export async function resolveExportSnapshot(tx: Prisma.TransactionClient, term: Term): Promise<ExportSnapshot> {
  if (term.phase === "CHECKING" || term.phase === "LOCKED") {
    if (!term.publishedResultSetId) throw new AccountError("本周期尚未发布结果，不能导出正式成绩", 409);
    const publication = await tx.resultPublication.findUnique({
      where: { id: term.publishedResultSetId },
      select: { id: true, termId: true, sequence: true, publishedAt: true, scheme: true, termRevision: true },
    });
    if (!publication || publication.termId !== term.id) throw new AccountError("发布版本不存在，请联系管理员", 409);
    validateScheme(publication.scheme);
    return {
      scheme: publication.scheme as unknown as Scheme,
      termRevision: publication.termRevision,
      batchLabel: `第 ${publication.sequence} 次发布（${exportDateText(publication.publishedAt)}）· 正式发布快照`,
      published: true,
      publicationId: publication.id,
      publicationSequence: publication.sequence,
      publishedAt: publication.publishedAt.toISOString(),
    };
  }
  validateScheme(term.scheme);
  return {
    scheme: term.scheme as unknown as Scheme,
    termRevision: term.revision,
    batchLabel: `未发布 · ${phaseText(term)}`,
    published: false,
    publicationId: null,
    publicationSequence: null,
    publishedAt: null,
  };
}

function add(values: Record<string, string>, nodeId: string, points: string) {
  values[nodeId] = (Rational.from(values[nodeId] ?? "0").add(Rational.from(points))).fixed(12);
}

export async function loadLiveGradeStudents(tx: Prisma.TransactionClient, term: Term, ids: string[]): Promise<GradeExportStudent[]> {
  if (!ids.length) return [];
  const { nodes } = validateScheme(term.scheme);
  const known = new Map<string, { id: string; login: string; name: string; studentProfile: { studentNumber: string; college: string; major: string; className: string } | null }>();
  const valuesByStudent = new Map<string, Record<string, string>>();
  const deductionsByStudent = new Map<string, Record<string, string>>();
  for (const batch of chunkItems(ids)) {
    const [students, grades, participations, claims, deductions] = await Promise.all([
      tx.user.findMany({
        where: { id: { in: batch }, role: "STUDENT" },
        select: { id: true, login: true, name: true, studentProfile: { select: { studentNumber: true, college: true, major: true, className: true } } },
      }),
      tx.gradeInput.findMany({ where: { termId: term.id, studentId: { in: batch } }, select: { studentId: true, nodeId: true, value: true } }),
      tx.participation.findMany({
        where: { studentId: { in: batch }, removedAt: null, activity: { termId: term.id, confirmed: true }, sources: { some: { status: "APPROVED" } } },
        select: { studentId: true, activity: { select: { nodeId: true, points: true } } },
      }),
      tx.personalClaim.findMany({ where: { termId: term.id, studentId: { in: batch }, status: "APPROVED" }, select: { studentId: true, score: true, scoreNodeId: true, project: { select: { nodeId: true, points: true } } } }),
      tx.deductionInput.findMany({ where: { termId: term.id, studentId: { in: batch }, revoked: false }, select: { studentId: true, projectId: true, amount: true } }),
    ]);
    for (const student of students) known.set(student.id, student);
    for (const studentId of batch) {
      valuesByStudent.set(studentId, {});
      deductionsByStudent.set(studentId, {});
    }
    for (const grade of grades) {
      const values = valuesByStudent.get(grade.studentId);
      if (values) values[grade.nodeId] = grade.value.toFixed();
    }
    for (const fact of participations) {
      if (nodes.get(fact.activity.nodeId)?.kind !== "ACTIVITY") continue;
      const values = valuesByStudent.get(fact.studentId);
      if (values) add(values, fact.activity.nodeId, fact.activity.points.toFixed());
    }
    for (const claim of claims) {
      const nodeId = claim.scoreNodeId ?? claim.project?.nodeId;
      const points = claim.score ?? claim.project?.points;
      if (!nodeId || points === null || points === undefined || nodes.get(nodeId)?.kind !== "ACTIVITY") continue;
      const values = valuesByStudent.get(claim.studentId);
      if (values) add(values, nodeId, points.toFixed());
    }
    for (const item of deductions) {
      const values = deductionsByStudent.get(item.studentId);
      if (values) add(values, item.projectId, item.amount.toFixed());
    }
  }
  return ids.flatMap((id) => {
    const student = known.get(id);
    if (!student?.studentProfile) return [];
    return [{
      id,
      login: student.login,
      name: student.name,
      studentNumber: student.studentProfile.studentNumber || student.login,
      college: student.studentProfile.college,
      major: student.studentProfile.major,
      className: student.studentProfile.className,
      values: valuesByStudent.get(id) ?? {},
      deductions: deductionsByStudent.get(id) ?? {},
    }];
  });
}

type PublishedIdentity = {
  studentId: string;
  login: string;
  name: string;
  college: string;
  major: string;
  className: string;
  payload: unknown;
};

function publishedStudent(row: PublishedIdentity, nodes: ReturnType<typeof validateScheme>["nodes"]): GradeExportStudent {
  const payload = row.payload as PublishedPayload;
  const values: Record<string, string> = {};
  for (const grade of payload.grades ?? []) if (grade.nodeId && grade.value !== undefined) values[grade.nodeId] = grade.value;
  for (const fact of payload.participations ?? []) {
    if (!fact.nodeId || fact.points === null || fact.points === undefined || nodes.get(fact.nodeId)?.kind !== "ACTIVITY") continue;
    add(values, fact.nodeId, fact.points);
  }
  for (const claim of payload.claims ?? []) {
    if (!claim.nodeId || claim.points === null || claim.points === undefined || nodes.get(claim.nodeId)?.kind !== "ACTIVITY") continue;
    add(values, claim.nodeId, claim.points);
  }
  const deductions: Record<string, string> = {};
  for (const item of payload.deductions ?? []) if (item.projectId && item.amount !== undefined) add(deductions, item.projectId, item.amount);
  const profile = payload.student?.profile;
  return {
    id: row.studentId,
    login: row.login,
    name: row.name,
    studentNumber: profile?.studentNumber || row.login,
    college: row.college,
    major: row.major,
    className: row.className,
    values,
    deductions,
  };
}

export async function loadPublishedGradeStudents(snapshot: ExportSnapshot, tx: Prisma.TransactionClient, ids: string[]): Promise<GradeExportStudent[]> {
  const publicationId = snapshot.publicationId;
  if (!publicationId || !ids.length) return [];
  const { nodes } = validateScheme(snapshot.scheme);
  const byId = new Map<string, GradeExportStudent>();
  for (const batch of chunkItems(ids)) {
    const rows = await tx.publishedResult.findMany({
      where: { publicationId, studentId: { in: batch } },
      select: { studentId: true, login: true, name: true, college: true, major: true, className: true, payload: true },
      orderBy: [{ login: "asc" }, { studentId: "asc" }],
    });
    for (const row of rows) byId.set(row.studentId, publishedStudent(row, nodes));
  }
  return ids.flatMap((id) => {
    const row = byId.get(id);
    return row ? [row] : [];
  });
}

/** Every student frozen in one publication, independent of later class or account changes. */
export async function loadAllPublishedGradeStudents(tx: Prisma.TransactionClient, publicationId: string, scheme: Scheme): Promise<GradeExportStudent[]> {
  const { nodes } = validateScheme(scheme);
  const rows: GradeExportStudent[] = [];
  for (let skip = 0; ; skip += EXPORT_BATCH_SIZE) {
    const batch = await tx.publishedResult.findMany({
      where: { publicationId },
      select: { studentId: true, login: true, name: true, college: true, major: true, className: true, payload: true },
      orderBy: [{ college: "asc" }, { major: "asc" }, { className: "asc" }, { login: "asc" }, { studentId: "asc" }],
      skip,
      take: EXPORT_BATCH_SIZE,
    });
    rows.push(...batch.map((row) => publishedStudent(row, nodes)));
    if (batch.length < EXPORT_BATCH_SIZE) break;
  }
  return rows;
}
