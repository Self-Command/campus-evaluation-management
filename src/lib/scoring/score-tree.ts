import { Rational } from "@/lib/scoring/rational";
import type { Scheme } from "@/lib/scoring/types";
import { validateScheme } from "@/lib/scoring/validate";

// Single source of truth for "what would this student's node score be", shared by the
// spreadsheet exporter. It mirrors calculate() step by step (children first, then cap,
// conversion, deduction and floor) so the exported formulas can be reconciled against
// the scoring engine instead of being trusted on their own.

export type NodeScore = { id: string; name: string; value: Rational | null };

export function scoreTree(
  scheme: Scheme,
  input: { values: Record<string, string>; deductions: Record<string, string> },
): Map<string, NodeScore> {
  const { nodes, children, root } = validateScheme(scheme);
  const deductions = new Map<string, Rational>();
  for (const project of scheme.deductions) {
    const amount = Rational.from(input.deductions[project.id] ?? "0");
    const current = deductions.get(project.nodeId) ?? Rational.from("0");
    deductions.set(project.nodeId, current.add(amount.mul(Rational.from(project.coefficient))));
  }
  const scores = new Map<string, NodeScore>();
  const visit = (id: string): Rational | null => {
    const node = nodes.get(id)!;
    let value: Rational | null;
    if (node.kind === "SUM" || node.kind === "WEIGHTED") {
      const kids = (children.get(id) ?? []).slice().sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
      let total = Rational.from("0");
      let any = false;
      for (const child of kids) {
        const childValue = visit(child.id);
        if (childValue === null) continue;
        any = true;
        total = total.add(node.kind === "WEIGHTED" ? childValue.mul(Rational.from(child.weight)) : childValue);
      }
      value = any ? total : null;
    } else {
      const raw = input.values[id];
      value = raw === undefined || raw === "" ? null : Rational.from(raw);
    }
    if (value !== null) {
      if (node.cap !== null) {
        const cap = Rational.from(node.cap);
        if (value.compare(cap) > 0) value = cap;
      }
      if (node.normalize && node.rawMaximum && node.targetMaximum) {
        value = value.div(Rational.from(node.rawMaximum)).mul(Rational.from(node.targetMaximum));
      }
      const deduction = deductions.get(id);
      if (deduction) value = value.sub(deduction);
      if (node.floor !== null) {
        const floor = Rational.from(node.floor);
        if (value.compare(floor) < 0) value = floor;
      }
    }
    scores.set(id, { id, name: node.name, value });
    return value;
  };
  visit(root.id);
  return scores;
}
