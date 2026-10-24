import { z } from "zod";
import { AccountError } from "@/server/account-error";
import { scopedTransaction } from "@/server/access-scope";
import type { ManagementBlocker, OrganizationUsage } from "@/lib/management-types";
import type { Prisma, User } from "@/generated/prisma/client";
import { recordAudit } from "@/server/audit";

export const classIdentityInclude = { major: { include: { college: true } }, counselor: { select: { id: true, name: true, login: true, role: true, disabled: true, collegeId: true } } } as const;
export const profileSelect = { studentNumber: true, college: true, major: true, className: true, classId: true, schoolClass: { include: classIdentityInclude } } as const;

export async function configuredClass(tx: Prisma.TransactionClient, classId: string) {
  const schoolClass = await tx.schoolClass.findUnique({ where: { id: classId }, include: classIdentityInclude });
  if (!schoolClass || !schoolClass.enabled || !schoolClass.major.enabled || !schoolClass.major.college.enabled) throw new AccountError("请选择已启用的学院、专业和班级");
  if (!schoolClass.counselor || schoolClass.counselor.disabled || schoolClass.counselor.role !== "COUNSELOR" || schoolClass.counselor.collegeId !== schoolClass.major.collegeId) throw new AccountError("该班级尚未配置有效责任辅导员");
  return schoolClass;
}
export type ConfiguredClass = Awaited<ReturnType<typeof configuredClass>>;
export function classProfile(schoolClass: ConfiguredClass) {
  return { classId: schoolClass.id, college: schoolClass.major.college.name, major: schoolClass.major.name, className: schoolClass.name };
}
export async function recordStudentAffiliation(tx: Prisma.TransactionClient, studentId: string, schoolClass: ConfiguredClass, actorId: string, reason: string) {
  const now = new Date();
  await tx.studentAffiliation.updateMany({ where: { studentId, endedAt: null }, data: { endedAt: now } });
  await tx.studentAffiliation.create({ data: { studentId, classId: schoolClass.id, startedAt: now, actorId, reason,
    identity: { ...classProfile(schoolClass), collegeId: schoolClass.major.collegeId, majorId: schoolClass.majorId, counselorId: schoolClass.counselorId } } });
}

async function organizationTree(tx: Prisma.TransactionClient, actor: User) {
  const colleges = await tx.college.findMany({
    where: actor.role === "ADMIN" ? {} : { id: actor.collegeId! }, orderBy: [{ code: "asc" }, { id: "asc" }],
    include: { majors: { where: actor.role === "COUNSELOR" ? { classes: { some: { counselorId: actor.id } } } : {}, orderBy: [{ code: "asc" }, { id: "asc" }],
      include: { classes: { where: actor.role === "COUNSELOR" ? { counselorId: actor.id } : {}, orderBy: [{ code: "asc" }, { id: "asc" }],
        include: { counselor: { select: { id: true, name: true, login: true } }, _count: { select: { students: { where: { user: { role: "STUDENT" } } } } } } } } } },
  });
  const counselors = await tx.user.findMany({ where: { role: "COUNSELOR", ...(actor.role === "ADMIN" ? {} : { collegeId: actor.collegeId }), ...(actor.role === "COUNSELOR" ? { id: actor.id } : {}) },
    select: { id: true, name: true, login: true, collegeId: true, disabled: true }, orderBy: [{ name: "asc" }, { id: "asc" }] });
  const items = colleges.map(college => ({ ...college, majors: college.majors.map(major => ({ ...major, classes: major.classes.map(({ _count, ...schoolClass }) => ({ ...schoolClass, studentCount: _count.students })) })) }));
  const majors = items.flatMap(college => college.majors);
  const classes = majors.flatMap(major => major.classes);
  return { role: actor.role, canManage: actor.role !== "COUNSELOR", colleges: items, counselors,
    totals: { colleges: items.length, majors: majors.length, classes: classes.length, students: classes.reduce((sum, cls) => sum + cls.studentCount, 0), counselors: counselors.filter(c => !c.disabled).length } };
}
export async function listOrganizations(sessionId: string) {
  return scopedTransaction(sessionId, ["ADMIN", "COLLEGE", "COUNSELOR"], false, organizationTree);
}

const organizationSchema = z.object({
  kind: z.enum(["college", "major", "class"]), id: z.string().min(1).optional(), revision: z.number().int().nonnegative().optional(),
  reason: z.string().trim().min(2).max(500).optional(), code: z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9._-]+$/, "代码仅允许字母、数字、点、下划线和连字符"),
  name: z.string().trim().min(1).max(80), enabled: z.boolean(), parentId: z.string().min(1).optional(), counselorId: z.string().min(1).nullable().optional(),
}).strict().superRefine((data, ctx) => {
  if (data.id && (data.revision === undefined || !data.reason)) ctx.addIssue({ code: "custom", message: "修改必须携带修订和理由" });
  if (!data.id && (data.revision !== undefined || data.reason !== undefined)) ctx.addIssue({ code: "custom", message: "新建请勿携带修订或修改理由" });
  if (data.kind === "college" ? data.parentId !== undefined : !data.parentId) ctx.addIssue({ code: "custom", message: "请选择正确的上级组织" });
  if (data.kind !== "class" && data.counselorId !== undefined) ctx.addIssue({ code: "custom", message: "仅班级可以指定辅导员" });
});

export async function saveOrganization(sessionId: string, input: unknown) {
  const data = organizationSchema.parse(input);
  return scopedTransaction(sessionId, ["ADMIN", "COLLEGE"], true, async (tx, actor) => {
    const values = { code: data.code.toUpperCase(), name: data.name, enabled: data.enabled };
    let targetId: string;
    let before: unknown = null;
    if (data.kind === "college") {
      if (actor.role !== "ADMIN") throw new AccountError("仅学校管理员可维护学院", 403);
      const previous = data.id ? await tx.college.findUnique({ where: { id: data.id } }) : null;
      if (data.id && !previous) throw new AccountError("学院不存在", 404);
      if (previous && previous.revision !== data.revision) throw new AccountError("组织已变化，请刷新后重试", 409);
      if (!data.enabled && previous && (await tx.major.count({ where: { collegeId: previous.id, enabled: true } }) || await tx.user.count({ where: { collegeId: previous.id, disabled: false } }))) throw new AccountError("请先停用下级组织并移交学院账号");
      before = previous;
      targetId = previous ? (await tx.college.update({ where: { id: previous.id }, data: { ...values, revision: { increment: 1 } } })).id : (await tx.college.create({ data: values })).id;
      if (previous && previous.name !== data.name) await tx.studentProfile.updateMany({ where: { schoolClass: { major: { collegeId: targetId } } }, data: { college: data.name } });
    } else if (data.kind === "major") {
      const college = await tx.college.findUnique({ where: { id: data.parentId! } });
      if (!college) throw new AccountError("学院不存在", 404);
      if (actor.role !== "ADMIN" && actor.collegeId !== college.id) throw new AccountError("不能维护其他学院的组织", 403);
      if (data.enabled && !college.enabled) throw new AccountError("上级学院已停用");
      const previous = data.id ? await tx.major.findUnique({ where: { id: data.id } }) : null;
      if (data.id && !previous) throw new AccountError("专业不存在", 404);
      if (previous && previous.collegeId !== college.id) throw new AccountError("不能直接改变专业所属学院");
      if (previous && previous.revision !== data.revision) throw new AccountError("组织已变化，请刷新后重试", 409);
      if (!data.enabled && previous && await tx.schoolClass.count({ where: { majorId: previous.id, enabled: true } })) throw new AccountError("请先停用下级班级");
      before = previous;
      targetId = previous ? (await tx.major.update({ where: { id: previous.id }, data: { ...values, revision: { increment: 1 } } })).id : (await tx.major.create({ data: { ...values, collegeId: college.id } })).id;
      if (previous && previous.name !== data.name) await tx.studentProfile.updateMany({ where: { schoolClass: { majorId: targetId } }, data: { major: data.name } });
    } else {
      const major = await tx.major.findUnique({ where: { id: data.parentId! }, include: { college: true } });
      if (!major) throw new AccountError("专业不存在", 404);
      if (actor.role !== "ADMIN" && actor.collegeId !== major.collegeId) throw new AccountError("不能维护其他学院的组织", 403);
      if (data.enabled && (!major.enabled || !major.college.enabled)) throw new AccountError("上级学院或专业已停用");
      const previous = data.id ? await tx.schoolClass.findUnique({ where: { id: data.id } }) : null;
      if (data.id && !previous) throw new AccountError("班级不存在", 404);
      if (previous && previous.majorId !== major.id) throw new AccountError("不能直接改变班级所属专业");
      if (previous && previous.revision !== data.revision) throw new AccountError("组织已变化，请刷新后重试", 409);
      const counselorId = data.counselorId === undefined ? previous?.counselorId ?? null : data.counselorId;
      if (counselorId) {
        const counselor = await tx.user.findUnique({ where: { id: counselorId } });
        if (!counselor || counselor.role !== "COUNSELOR" || counselor.disabled || counselor.collegeId !== major.collegeId) throw new AccountError("请选择本院启用的辅导员");
      }
      const students = previous && await tx.studentProfile.count({ where: { classId: previous.id, user: { role: "STUDENT" } } });
      if (students && !counselorId) throw new AccountError("班级已有学生，请先交接至另一名辅导员");
      if (students && !data.enabled) throw new AccountError("班级已有学生，请先完成学生转班");
      before = previous;
      targetId = previous ? (await tx.schoolClass.update({ where: { id: previous.id }, data: { ...values, counselorId, revision: { increment: 1 } } })).id : (await tx.schoolClass.create({ data: { ...values, majorId: major.id, counselorId } })).id;
      if (previous?.counselorId !== counselorId) {
        const now = new Date();
        await tx.classCounselorAssignment.updateMany({ where: { classId: targetId, endedAt: null }, data: { endedAt: now } });
        if (counselorId) await tx.classCounselorAssignment.create({ data: { classId: targetId, counselorId, startedAt: now, actorId: actor.id, reason: data.reason ?? "建立班级责任关系" } });
      }
      if (previous && previous.name !== data.name) await tx.studentProfile.updateMany({ where: { classId: targetId }, data: { className: data.name } });
    }
    const after = data.kind === "college" ? await tx.college.findUniqueOrThrow({ where: { id: targetId } }) : data.kind === "major" ? await tx.major.findUniqueOrThrow({ where: { id: targetId } }) : await tx.schoolClass.findUniqueOrThrow({ where: { id: targetId } });
    await recordAudit(tx, { actorId: actor.id, action: "ORGANIZATION_SAVED", targetId,
      details: JSON.parse(JSON.stringify({ kind: data.kind, reason: data.reason ?? "新建组织", before, after })) });
    return organizationTree(tx, actor);
  });
}

type OrganizationKind = OrganizationUsage["kind"];
type OrganizationTarget = {
  id: string;
  code: string;
  name: string;
  enabled: boolean;
  revision: number;
  parentLabel: string;
  collegeId: string | null;
};

async function loadOrganizationTarget(tx: Prisma.TransactionClient, kind: OrganizationKind, id: string): Promise<OrganizationTarget | null> {
  if (kind === "college") {
    const row = await tx.college.findUnique({ where: { id } });
    return row ? { id: row.id, code: row.code, name: row.name, enabled: row.enabled, revision: row.revision, parentLabel: "全校", collegeId: null } : null;
  }
  if (kind === "major") {
    const row = await tx.major.findUnique({ where: { id }, include: { college: true } });
    return row ? { id: row.id, code: row.code, name: row.name, enabled: row.enabled, revision: row.revision, parentLabel: row.college.name, collegeId: row.collegeId } : null;
  }
  const row = await tx.schoolClass.findUnique({ where: { id }, include: { major: { include: { college: true } } } });
  return row ? { id: row.id, code: row.code, name: row.name, enabled: row.enabled, revision: row.revision, parentLabel: `${row.major.college.name} / ${row.major.name}`, collegeId: row.major.collegeId } : null;
}

function assertOrganizationPermission(actor: User, kind: OrganizationKind, target: OrganizationTarget) {
  if (actor.role === "ADMIN") return;
  if (actor.role !== "COLLEGE" || kind === "college" || !actor.collegeId || actor.collegeId !== target.collegeId)
    throw new AccountError(kind === "college" ? "仅学校管理员可删除学院" : "不能删除其他学院的组织", 403);
}

async function organizationDeleteState(tx: Prisma.TransactionClient, kind: OrganizationKind, target: OrganizationTarget) {
  const blockers: ManagementBlocker[] = [];
  const notes: string[] = [];
  if (kind === "college") {
    const [majors, staff, activities] = await Promise.all([
      tx.major.count({ where: { collegeId: target.id } }),
      tx.user.count({ where: { collegeId: target.id } }),
      tx.activity.count({ where: { collegeId: target.id } }),
    ]);
    if (majors) blockers.push({ key: "majors", label: "专业", count: majors, hint: "请先删除全部专业（包括已停用的专业）" });
    if (staff) blockers.push({ key: "staff", label: "学院账号", count: staff, hint: "请先删除或转移学院账号（包括已停用账号）" });
    if (activities) blockers.push({ key: "activities", label: "学院活动", count: activities, hint: "学院仍有关联活动；如不再使用请停用学院" });
  } else if (kind === "major") {
    const classes = await tx.schoolClass.count({ where: { majorId: target.id } });
    if (classes) blockers.push({ key: "classes", label: "班级", count: classes, hint: "请先删除全部班级（包括已停用的班级）" });
  } else {
    const [students, affiliations, assignments] = await Promise.all([
      tx.studentProfile.count({ where: { classId: target.id } }),
      tx.studentAffiliation.count({ where: { classId: target.id } }),
      tx.classCounselorAssignment.count({ where: { classId: target.id } }),
    ]);
    if (students) blockers.push({ key: "students", label: "学生档案", count: students, hint: "请先转班或删除学生账号" });
    if (affiliations) blockers.push({ key: "affiliations", label: "学籍异动记录", count: affiliations, hint: "该班级有学籍异动历史；如不再使用请停用班级" });
    if (assignments) notes.push(`删除后将同时移除 ${assignments} 条辅导员交接记录，并写入审计。`);
  }
  return { canDelete: blockers.length === 0, blockers, notes };
}

export async function organizationUsage(sessionId: string, kindInput: string, idInput: string) {
  const kind = z.enum(["college", "major", "class"]).parse(kindInput);
  const id = z.string().trim().min(1).max(100).parse(idInput);
  return scopedTransaction(sessionId, ["ADMIN", "COLLEGE"], false, async (tx, actor) => {
    const target = await loadOrganizationTarget(tx, kind, id);
    if (!target) throw new AccountError("组织不存在", 404);
    assertOrganizationPermission(actor, kind, target);
    const state = await organizationDeleteState(tx, kind, target);
    return { kind, ...target, ...state };
  });
}

const organizationDeleteSchema = z.object({
  kind: z.enum(["college", "major", "class"]),
  id: z.string().trim().min(1).max(100),
  revision: z.number().int().nonnegative(),
  reason: z.string().trim().min(2, "请填写删除理由").max(500),
  confirmName: z.string().trim().min(1).max(80),
}).strict();

export async function deleteOrganization(sessionId: string, input: unknown) {
  const data = organizationDeleteSchema.parse(input);
  return scopedTransaction(sessionId, ["ADMIN", "COLLEGE"], true, async (tx, actor) => {
    const target = await loadOrganizationTarget(tx, data.kind, data.id);
    if (!target) throw new AccountError("组织不存在", 404);
    assertOrganizationPermission(actor, data.kind, target);
    if (target.revision !== data.revision) throw new AccountError("组织已变化，请刷新后重试", 409);
    if (target.name !== data.confirmName) throw new AccountError("请输入完整的组织名称以确认删除");
    const state = await organizationDeleteState(tx, data.kind, target);
    if (!state.canDelete) {
      const detail = state.blockers.map(item => `${item.label} ${item.count}`).join("，");
      const hint = state.blockers.find(item => item.hint)?.hint;
      throw new AccountError(`不能删除：仍有${detail}。${hint ?? "请先处理关联数据"}`, 409);
    }
    const archivedAssignments = data.kind === "class"
      ? await tx.classCounselorAssignment.count({ where: { classId: target.id } })
      : 0;
    await recordAudit(tx, {
        actorId: actor.id,
        action: "ORGANIZATION_DELETED",
        targetId: target.id,
        details: JSON.parse(JSON.stringify({ kind: data.kind, reason: data.reason, confirmName: data.confirmName, before: target, archivedAssignments })),
      });
    if (data.kind === "class") {
      await tx.classCounselorAssignment.deleteMany({ where: { classId: target.id } });
      await tx.schoolClass.delete({ where: { id: target.id } });
    } else if (data.kind === "major") {
      await tx.major.delete({ where: { id: target.id } });
    } else {
      await tx.college.delete({ where: { id: target.id } });
    }
    return { ...(await organizationTree(tx, actor)), deleted: { kind: data.kind, id: target.id, name: target.name } };
  });
}
