import { validateScheme } from "@/lib/scoring/validate";
import type { Scheme, ScoringNode } from "@/lib/scoring/types";

// Row layout shared by the workbook builder and the formula generator. Keeping the
// mapping in one place means every formula references the same 参数 row for a module
// and the layout can be unit tested without building a workbook.

export type LayoutRow = {
  node: ScoringNode;
  depth: number;
  /** 1-based row in the 成绩 sheet (row 1 is the header). */
  scoreRow: number;
  /** 1-based row in the 参数 sheet (row 1 is the header). */
  paramRow: number;
  children: LayoutRow[];
};

export type GradeLayout = {
  rows: LayoutRow[];
  byId: Map<string, LayoutRow>;
  root: LayoutRow;
};

export function gradeLayout(scheme: Scheme): GradeLayout {
  const { nodes, children, root } = validateScheme(scheme);
  const byId = new Map<string, LayoutRow>();
  const rows: LayoutRow[] = [];
  let index = 0;
  const build = (node: ScoringNode, depth: number): LayoutRow => {
    const row: LayoutRow = { node, depth, scoreRow: index + 2, paramRow: index + 2, children: [] };
    index += 1;
    rows.push(row);
    byId.set(node.id, row);
    row.children = (children.get(node.id) ?? [])
      .slice()
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
      .map((child) => build(child, depth + 1));
    return row;
  };
  const rootRow = build(root, 0);
  // All modules must be reachable from the root; validateScheme already rejects cycles.
  if (rows.length !== nodes.size) throw new Error("评分模块存在游离项，无法导出");
  return { rows, byId, root: rootRow };
}

/** Column letters used by the 成绩 sheet; formulas below rely on these positions. */
export const SCORE_COLUMNS = {
  name: "A",
  kind: "B",
  input: "C",
  subtotal: "D",
  capped: "E",
  normalized: "F",
  deduction: "G",
  score: "H",
} as const;

/** Column letters used by the 参数 sheet. */
export const PARAM_COLUMNS = {
  name: "A",
  cap: "B",
  rawMaximum: "C",
  targetMaximum: "D",
  floor: "E",
  deductionTotal: "F",
  weight: "G",
} as const;
