import { schemeSchema, type ScoringNode } from "./types";
import { Rational as R } from "./rational";
export class ScoringError extends Error {}
const zero = R.from("0"), one = R.from("1");
export function validateScheme(input: unknown) {
  const scheme = schemeSchema.parse(input);
  const nodes = new Map<string, ScoringNode>(), children = new Map<string, ScoringNode[]>();
  for (const node of scheme.nodes) {
    if (nodes.has(node.id)) throw new ScoringError(`模块标识重复：${node.id}`);
    nodes.set(node.id, node); children.set(node.id, []);
  }
  const roots = scheme.nodes.filter(node => node.parentId === null);
  if (roots.length !== 1) throw new ScoringError("评分树必须有且仅有一个根模块");
  for (const node of scheme.nodes) {
    if (node.parentId !== null) {
      if (!nodes.has(node.parentId) || node.id === node.parentId) throw new ScoringError(`${node.name}：父模块无效`);
      children.get(node.parentId)!.push(node);
    }
    if (R.from(node.weight).compare(zero) < 0 || R.from(node.weight).compare(one) > 0) throw new ScoringError(`${node.name}：比例需在0至1之间`);
    if (R.from(node.minimum).compare(R.from(node.maximum)) > 0) throw new ScoringError(`${node.name}：输入范围无效`);
    if (node.cap !== null && R.from(node.cap).compare(zero) < 0) throw new ScoringError(`${node.name}：封顶分不能为负`);
    if (node.normalize && (!node.rawMaximum || !node.targetMaximum || R.from(node.rawMaximum).compare(zero) <= 0 || R.from(node.targetMaximum).compare(zero) <= 0)) throw new ScoringError(`${node.name}：折算满分必须大于零`);
    if (node.floor !== null && node.cap !== null) {
      let ceiling = R.from(node.cap);
      if (node.normalize) ceiling = ceiling.div(R.from(node.rawMaximum!)).mul(R.from(node.targetMaximum!));
      if (R.from(node.floor).compare(ceiling) > 0) throw new ScoringError(`${node.name}：最低分超过可计入的封顶分`);
    }
    if ((node.kind === "SUM" || node.kind === "WEIGHTED") && node.required) throw new ScoringError(`${node.name}：汇总模块不能配置必需原始输入`);
    if (node.kind === "ACTIVITY" && node.required) throw new ScoringError(`${node.name}：活动无记录时按零处理`);
  }
  const order: ScoringNode[] = [], stack = [roots[0]];
  while (stack.length) {
    const node = stack.pop()!; order.push(node);
    const descendants = children.get(node.id)!;
    descendants.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    const group = node.kind === "SUM" || node.kind === "WEIGHTED";
    if (group !== (descendants.length > 0)) throw new ScoringError(`${node.name}：汇总模块必须有下级，输入模块不能有下级`);
    if (node.kind === "WEIGHTED" && descendants.reduce((sum, child) => sum.add(R.from(child.weight)), zero).compare(one) !== 0) throw new ScoringError(`${node.name}：直接下级比例合计必须为100%`);
    for (let i = descendants.length - 1; i >= 0; i--) stack.push(descendants[i]);
  }
  if (order.length !== scheme.nodes.length) throw new ScoringError("存在循环或游离模块");
  const deductionIds = new Set<string>();
  for (const item of scheme.deductions) {
    if (deductionIds.has(item.id) || !nodes.has(item.nodeId) || R.from(item.coefficient).compare(zero) < 0) throw new ScoringError(`${item.name}：扣分项目标识、节点或系数无效`);
    deductionIds.add(item.id);
  }
  return { scheme, nodes, children, order, root: roots[0] };
}
