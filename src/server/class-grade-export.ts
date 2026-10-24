import { createHash } from "node:crypto";
import { z } from "zod";
import { exportDateText } from "@/lib/business-labels";
import type { Prisma } from "@/generated/prisma/client";
import { AccountError } from "@/server/account-error";
import { db } from "@/server/db";
import { termTransaction } from "@/server/terms";
import { scopedStudentWhere } from "@/server/access-scope";
import { EXPORT_TRANSACTION_TIMEOUT_MS, MAX_EXPORT_COLLEGES, MAX_EXPORT_STUDENTS, assertExportCapacity } from "@/server/export-limits";
import { buildClassSheet } from "@/lib/xlsx/class-sheet";
import { buildMultiSheetWorkbook } from "@/lib/xlsx/workbook";
import { loadLiveGradeStudents, loadPublishedGradeStudents, resolveExportSnapshot, type GradeExportStudent } from "@/server/grade-export-data";

// School-style detail export. Scope is resolved from the stored class / counselor /
// college relations. A counselor can choose one or more of their classes, a college can
// export its own classes, and only a school administrator can export all classes or
// narrow the school export to selected colleges. In CHECKING/LOCKED the identity and
// inputs come from the latest PublishedResult payload. Data is read in one authorized
// transaction, while the workbook itself is rendered after the transaction ends.

const allPhases = ["CONFIGURATION", "ACTIVE", "CHECKING", "LOCKED"] as const;
const exportInput = z.object({
  classId: z.string().min(1).max(100).optional(),
  classIds: z.array(z.string().min(1).max(100)).max(100).optional(),
  collegeIds: z.array(z.string().min(1).max(100)).max(MAX_EXPORT_COLLEGES).optional(),
  scope: z.enum(["school", "college", "counselor"]).optional(),
}).strict();

const classSelect = {
  id: true,
  name: true,
  major: { select: { name: true, college: { select: { id: true, name: true } } } },
} as const;

type Actor = { id: string; role: "ADMIN" | "COLLEGE" | "COUNSELOR"; collegeId: string | null };
type ExportClass = { id: string; name: string; major: { name: string; college: { id: string; name: string } } };

function classWhere(actor: Actor, collegeIds: string[]): Prisma.SchoolClassWhereInput {
  const college = actor.role === "ADMIN"
    ? collegeIds.length ? { id: { in: collegeIds } } : {}
    : { id: actor.collegeId ?? "__none__" };
  return {
    enabled: true,
    major: { is: { enabled: true, college: { is: { enabled: true, ...college } } } },
    ...(actor.role === "COUNSELOR" ? { counselorId: actor.id } : {}),
  };
}

async function selectedColleges(tx: Prisma.TransactionClient, ids: string[]) {
  const unique = [...new Set(ids)];
  const colleges = await tx.college.findMany({
    where: { id: { in: unique }, enabled: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  if (colleges.length !== unique.length) throw new AccountError("所选学院不在可导出范围", 403);
  return colleges;
}

async function selectedClasses(tx: Prisma.TransactionClient, actor: Actor, ids: string[], collegeIds: string[]): Promise<ExportClass[]> {
  const where: Prisma.SchoolClassWhereInput = { ...classWhere(actor, collegeIds), ...(ids.length ? { id: { in: ids } } : {}) };
  const classes = await tx.schoolClass.findMany({ where, select: classSelect, orderBy: [{ major: { college: { name: "asc" } } }, { major: { name: "asc" } }, { name: "asc" }] });
  if (ids.length && classes.length !== ids.length) throw new AccountError("所选班级不在可导出范围", 403);
  if (!classes.length) throw new AccountError(collegeIds.length ? "所选学院没有可导出的班级" : "当前范围没有可导出的班级", 404);
  return classes;
}

function scopeText(actor: Actor, classes: ExportClass[], filters: { classIds: string[]; collegeIds: string[] }) {
  const collegeNames = [...new Set(classes.map((item) => item.major.college.name))];
  const college = collegeNames[0];
  if (classes.length === 1) {
    const label = `${college}·${classes[0].major.name}·${classes[0].name}`;
    return { title: `${label}综合素质测评成绩明细表`, fileLabel: label };
  }
  const count = `${classes.length}个班级`;
  if (actor.role === "COUNSELOR") return { title: `所负责班级综合素质测评成绩明细表（${count}）`, fileLabel: `所负责班级（${count}）` };
  if (actor.role === "COLLEGE") return { title: `${college}综合素质测评成绩明细表（${count}）`, fileLabel: `${college}（${count}）` };
  if (filters.classIds.length) return { title: `所选班级综合素质测评成绩明细表（${count}）`, fileLabel: `所选班级（${count}）` };
  if (filters.collegeIds.length) {
    if (collegeNames.length === 1) return { title: `${college}综合素质测评成绩明细表（${count}）`, fileLabel: `${college}（${count}）` };
    const collegeCount = `${collegeNames.length}个学院`;
    return { title: `所选学院综合素质测评成绩明细表（${collegeCount}·${count}）`, fileLabel: `所选学院（${collegeCount}·${count}）` };
  }
  return { title: `全校综合素质测评成绩明细表（${count}）`, fileLabel: `全校（${count}）` };
}

const safe = (value: string) => value.replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 60);

export async function exportClassGradeWorkbook(sessionId: string, termId: string, input: unknown) {
  const data = exportInput.parse(input);
  const job = await termTransaction(sessionId, termId, ["ADMIN", "COLLEGE", "COUNSELOR"], [...allPhases], async (tx, term, actorId) => {
    const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId }, select: { id: true, role: true, collegeId: true } }) as Actor;
    if (data.scope === "school" && actor.role !== "ADMIN") throw new AccountError("只有学校管理员可以导出全校成绩", 403);
    if (data.scope === "college" && actor.role !== "COLLEGE") throw new AccountError("只有学院管理人员可以导出本院成绩", 403);
    if (data.scope === "counselor" && actor.role !== "COUNSELOR") throw new AccountError("只有辅导员可以导出本人负责班级", 403);
    if (data.collegeIds?.length && actor.role !== "ADMIN") throw new AccountError("只有学校管理员可以按学院筛选导出", 403);
    const ids = [...new Set(data.classIds ?? (data.classId ? [data.classId] : []))];
    const collegeIds = [...new Set(data.collegeIds ?? [])];
    if (collegeIds.length) await selectedColleges(tx, collegeIds);
    const classes = await selectedClasses(tx, actor, ids, collegeIds);
    const where: Prisma.UserWhereInput = { AND: [scopedStudentWhere(actor), { studentProfile: { is: { classId: { in: classes.map((item) => item.id) } } } }] };
    const total = await tx.user.count({ where });
    if (!total) throw new AccountError("所选班级没有可导出的学生", 404);
    assertExportCapacity(total);
    const students = await tx.user.findMany({
      where,
      select: { id: true },
      orderBy: [{ login: "asc" }, { id: "asc" }],
      take: MAX_EXPORT_STUDENTS + 1,
    });
    assertExportCapacity(students.length);
    const snapshot = await resolveExportSnapshot(tx, term);
    const studentIds = students.map((student) => student.id);
    const rows: GradeExportStudent[] = snapshot.published
      ? await loadPublishedGradeStudents(snapshot, tx, studentIds)
      : await loadLiveGradeStudents(tx, term, studentIds);
    if (!rows.length) throw new AccountError("当前发布版本中没有可导出的学生，请联系管理员", 409);
    return {
      termName: term.name,
      actorId,
      scopeKey: data.scope ?? (ids.length ? "classes" : collegeIds.length ? "colleges" : "scope"),
      collegeIds,
      classIds: classes.map((item) => item.id),
      scope: scopeText(actor, classes, { classIds: ids, collegeIds }),
      snapshot,
      rows,
    };
  }, "read", { timeout: EXPORT_TRANSACTION_TIMEOUT_MS });

  const sheets = buildClassSheet({
    title: job.scope.title,
    termName: job.termName,
    batchLabel: job.snapshot.batchLabel,
    scheme: job.snapshot.scheme,
    showOrganization: true,
    mode: job.snapshot.published ? "published" : "live",
    students: job.rows.map((row) => ({
      login: row.login,
      name: row.name,
      studentNumber: row.studentNumber,
      college: row.college,
      major: row.major,
      className: row.className,
      values: row.values,
      deductions: row.deductions,
    })),
  });
  const buffer = buildMultiSheetWorkbook([sheets.detail, sheets.rules]);
  await db.auditEvent.create({
    data: {
      actorId: job.actorId,
      action: "GRADE_DETAIL_EXPORTED",
      targetId: job.snapshot.publicationId ?? termId,
      details: {
        termId,
        scope: job.scopeKey,
        collegeIds: job.collegeIds,
        classIds: job.classIds,
        studentCount: job.rows.length,
        published: job.snapshot.published,
        publicationId: job.snapshot.publicationId,
        publicationSequence: job.snapshot.publicationSequence,
        sha256: createHash("sha256").update(buffer).digest("hex"),
      },
    },
  });
  const fileName = `成绩明细表_${safe(job.scope.fileLabel)}_${job.snapshot.published ? "正式发布" : "当前阶段"}_${exportDateText()}.xlsx`;
  return { buffer, fileName, count: job.rows.length, published: job.snapshot.published, batchLabel: job.snapshot.batchLabel };
}

/** Authorized class choices and the exact snapshot label shown before download. */
export async function gradeExportScope(sessionId: string, termId: string) {
  return termTransaction(sessionId, termId, ["ADMIN", "COLLEGE", "COUNSELOR"], [...allPhases], async (tx, term, actorId) => {
    const actor = await tx.user.findUniqueOrThrow({ where: { id: actorId }, select: { id: true, role: true, collegeId: true } }) as Actor;
    const classes = await tx.schoolClass.findMany({
      where: classWhere(actor, []),
      select: classSelect,
      orderBy: [{ major: { college: { name: "asc" } } }, { major: { name: "asc" } }, { name: "asc" }],
    });
    const counts = classes.length
      ? await tx.studentProfile.groupBy({
          by: ["classId"],
          where: { classId: { in: classes.map((item) => item.id) }, user: { role: "STUDENT" } },
          _count: { _all: true },
        })
      : [];
    const countMap = new Map(counts.map((item) => [item.classId, item._count._all]));
    const colleges = new Map<string, { id: string; name: string; classCount: number; studentCount: number }>();
    for (const item of classes) {
      const entry = colleges.get(item.major.college.id) ?? { id: item.major.college.id, name: item.major.college.name, classCount: 0, studentCount: 0 };
      entry.classCount += 1;
      entry.studentCount += countMap.get(item.id) ?? 0;
      colleges.set(item.major.college.id, entry);
    }
    const snapshot = await resolveExportSnapshot(tx, term);
    return {
      classes: classes.map((item) => ({
        id: item.id,
        name: item.name,
        major: item.major.name,
        college: item.major.college.name,
        collegeId: item.major.college.id,
        studentCount: countMap.get(item.id) ?? 0,
      })),
      colleges: [...colleges.values()].sort((left, right) => left.name.localeCompare(right.name, "zh-CN")),
      published: snapshot.published,
      batchLabel: snapshot.batchLabel,
      phase: term.phase,
    };
  }, "read", { timeout: EXPORT_TRANSACTION_TIMEOUT_MS });
}
