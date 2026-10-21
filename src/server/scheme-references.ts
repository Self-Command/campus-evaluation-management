import type { Prisma } from "@/generated/prisma/client";
import type { Scheme } from "@/lib/scoring/types";

export async function schemeReferences(tx: Prisma.TransactionClient, termId: string) {
  const [activities, projects, grades, deductions] = await Promise.all([
    tx.activity.findMany({ where: { termId }, select: { nodeId: true, name: true } }),
    tx.recognitionProject.findMany({ where: { termId }, select: { nodeId: true, name: true } }),
    tx.gradeInput.findMany({ where: { termId }, select: { nodeId: true } }),
    tx.deductionInput.findMany({ where: { termId }, select: { projectId: true } }),
  ]);
  const nodeUsage: Record<string, number> = {};
  for (const row of [...activities, ...projects, ...grades]) nodeUsage[row.nodeId] = (nodeUsage[row.nodeId] ?? 0) + 1;
  return { activities, projects, grades, deductions, nodeUsage };
}
export function schemeReferenceErrors(scheme: Scheme, references: Awaited<ReturnType<typeof schemeReferences>>) {
  const nodes = new Map(scheme.nodes.map(node => [node.id, node]));
  const errors: string[] = [];
  for (const item of [...references.activities, ...references.projects]) if (nodes.get(item.nodeId)?.kind !== "ACTIVITY") errors.push(`“${item.name}”引用的活动模块被删除或类型改变`);
  for (const item of references.grades) if (nodes.get(item.nodeId)?.kind !== "GRADE") errors.push(`已有成绩的模块${item.nodeId}被删除或类型改变`);
  for (const item of references.deductions) if (!scheme.deductions.some(project => project.id === item.projectId)) errors.push(`已有扣分记录的项目${item.projectId}被删除`);
  return [...new Set(errors)];
}
