import { Rational as R } from "./rational";
import { validateScheme, ScoringError } from "./validate";
import { decimalSchema, type ScoringInput } from "./types";
const zero = R.from("0");
export function calculate(input: unknown, raw: ScoringInput) {
  const { scheme, nodes, children, order, root } = validateScheme(input);
  for (const key of Object.keys(raw.values)) if (!nodes.has(key) || ["SUM", "WEIGHTED"].includes(nodes.get(key)!.kind)) throw new ScoringError(`原始输入目标无效：${key}`);
  for (const key of Object.keys(raw.deductions)) if (!scheme.deductions.some(item => item.id === key)) throw new ScoringError(`扣分项目无效：${key}`);
  const deductions = new Map<string, R>();
  for (const item of scheme.deductions) {
    const value = R.from(decimalSchema.parse(raw.deductions[item.id] ?? "0"));
    if (value.compare(zero) < 0) throw new ScoringError(`${item.name}：扣分额不能为负`);
    deductions.set(item.nodeId, (deductions.get(item.nodeId) ?? zero).add(value.mul(R.from(item.coefficient))));
  }
  const scores = new Map<string, R>();
  const complete = new Map<string, boolean>();
  const missing: { id: string; name: string }[] = [];
  const details = [];
  for (let i = order.length - 1; i >= 0; i--) {
    const node = order[i], descendants = children.get(node.id)!;
    let gross = zero, isComplete = true;
    if (descendants.length) {
      for (const child of descendants) {
        gross = gross.add(scores.get(child.id)!.mul(node.kind === "WEIGHTED" ? R.from(child.weight) : R.from("1")));
        isComplete = isComplete && complete.get(child.id)!;
      }
    } else {
      const value = raw.values[node.id];
      if (value === undefined && node.required) { missing.push({ id: node.id, name: node.name }); isComplete = false; }
      if (value !== undefined) {
        gross = R.from(decimalSchema.parse(value));
        if (gross.compare(R.from(node.minimum)) < 0 || gross.compare(R.from(node.maximum)) > 0) throw new ScoringError(`${node.name}：原始分不在${node.minimum}至${node.maximum}范围内`);
      }
    }
    const capped = node.cap !== null && gross.compare(R.from(node.cap)) > 0 ? R.from(node.cap) : gross;
    const normalized = node.normalize ? capped.div(R.from(node.rawMaximum!)).mul(R.from(node.targetMaximum!)) : capped;
    const deduction = deductions.get(node.id) ?? zero;
    const beforeFloor = normalized.sub(deduction);
    const score = node.floor !== null && beforeFloor.compare(R.from(node.floor)) < 0 ? R.from(node.floor) : beforeFloor;
    scores.set(node.id, score); complete.set(node.id, isComplete);
    const stages = { gross, capped, normalized, deduction, beforeFloor, score };
    const formatted = Object.fromEntries(Object.entries(stages).map(([key, value]) => [key, value.fixed()])) as Record<keyof typeof stages, string>;
    details.push({ id: node.id, name: node.name, parentId: node.parentId, kind: node.kind, weight: node.weight, order: node.order, complete: isComplete, ...formatted, exact: Object.fromEntries(Object.entries(stages).map(([key, value]) => [key, value.exact()])), normalization: node.normalize ? { rawMaximum: node.rawMaximum, targetMaximum: node.targetMaximum } : null, parentContribution: node.parentId && nodes.get(node.parentId)!.kind === "WEIGHTED" ? score.mul(R.from(node.weight)).fixed() : score.fixed() });
  }
  return { total: complete.get(root.id) ? scores.get(root.id)!.fixed() : null, provisionalTotal: scores.get(root.id)!.fixed(), complete: complete.get(root.id)!, missing, details: details.reverse() };
}
