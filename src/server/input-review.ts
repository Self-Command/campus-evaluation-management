import { z } from "zod";
import type { Prisma, Role } from "@/generated/prisma/client";
import { AccountError } from "@/server/account-error";
import { scopedStudentWhere } from "@/server/access-scope";
import { historyEntry, appendHistory, jsonValue } from "@/server/claims";

// Score and deduction review share one authorization rule: a counselor acts on
// the classes they are responsible for, a college acts on its own students and
// an administrator only keeps the school-wide read view plus the separately
// audited exceptional correction entry point.
export type InputActor = { id: string; role: Role; collegeId: string | null };
export const inputChangeStatus = z.enum(["PENDING_COLLEGE", "RETURNED", "APPROVED", "ABANDONED"]);
export const inputChangeFilter = z.enum(["PENDING", ...inputChangeStatus.options]);
export const inputPendingStatuses = ["PENDING_COLLEGE", "RETURNED"] as const;

const studentSelect = {
  id: true, login: true, name: true, disabled: true,
  studentProfile: { include: { schoolClass: { include: { major: { include: { college: true } } } } } },
} as const;

export async function inputStudentScope(tx: Prisma.TransactionClient, actor: InputActor, studentId: string) {
  const student = await tx.user.findUnique({ where: { id: studentId }, select: studentSelect });
  const schoolClass = student?.studentProfile?.schoolClass;
  if (!student || !student.studentProfile || !schoolClass || !schoolClass.enabled || !schoolClass.major.enabled || !schoolClass.major.college.enabled) throw new AccountError("学生档案不存在或不在可录入范围", 404);
  if (actor.role === "COUNSELOR" && schoolClass.counselorId !== actor.id) throw new AccountError("只能处理本人负责班级的学生", 403);
  if (actor.role === "COLLEGE" && schoolClass.major.collegeId !== actor.collegeId) throw new AccountError("只能处理本院学生", 403);
  if (actor.role !== "ADMIN" && actor.role !== "COUNSELOR" && actor.role !== "COLLEGE") throw new AccountError("没有成绩或扣分处理权限", 403);
  return student;
}

export async function scopedStudentIds(tx: Prisma.TransactionClient, actor: InputActor) {
  const rows = await tx.user.findMany({ where: scopedStudentWhere(actor), select: { id: true } });
  return rows.map(row => row.id);
}

export function inputHistoryEntry(actorId: string, action: string, details: Record<string, unknown> = {}) {
  return historyEntry(actorId, action, details);
}
export { appendHistory, jsonValue };

export async function staffNames(tx: Prisma.TransactionClient, ids: (string | null | undefined)[]) {
  const unique = [...new Set(ids.filter((value): value is string => Boolean(value)))];
  const rows = unique.length ? await tx.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } }) : [];
  return new Map(rows.map(row => [row.id, row.name]));
}
