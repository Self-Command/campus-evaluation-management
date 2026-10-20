import type { Prisma } from "@/generated/prisma/client";
export async function effectiveCheckingDeadline(tx: Prisma.TransactionClient, publication: { id: string; checkingEndsAt: Date }) {
  const extension = await tx.publicationExtension.findFirst({ where: { publicationId: publication.id }, orderBy: [{ checkingEndsAt: "desc" }, { id: "desc" }], select: { checkingEndsAt: true } });
  return extension && extension.checkingEndsAt > publication.checkingEndsAt ? extension.checkingEndsAt : publication.checkingEndsAt;
}
