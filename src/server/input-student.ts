import { z } from "zod";
import { AccountError } from "@/server/accounts";
import type { Prisma, Term } from "@/generated/prisma/client";

// A reopened period retains the prior cohort until an administrator explicitly
// selects the current roster. Historical accounts need not be re-enabled.
export async function inputStudent(tx: Prisma.TransactionClient, term: Term, studentLogin: string) {
  const login = z.string().trim().min(1).max(64).parse(studentLogin);
  const publicationId = term.phase === "CHECKING" || term.phase === "LOCKED" ? term.publishedResultSetId : term.phase === "ACTIVE" && term.cohortPolicy === "PREVIOUS" ? term.cohortPublicationId : null;
  if (["CHECKING", "LOCKED"].includes(term.phase) && !publicationId) throw new AccountError("本周期尚未发布结果", 409);
  if (publicationId) {
    const frozen = await tx.publishedResult.findFirst({ where: { publicationId, login }, select: { studentId: true, name: true, login: true } });
    if (!frozen) throw new AccountError("该学生不在本次发布范围内", 404);
    return { id: frozen.studentId, login: frozen.login, name: frozen.name };
  }
  const student = await tx.user.findFirst({ where: { login, role: "STUDENT", disabled: false, studentProfile: { isNot: null } }, select: { id: true, login: true, name: true } });
  if (!student) throw new AccountError("学号未匹配有效学生档案", 404);
  return student;
}
