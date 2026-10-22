import type { Scheme } from "@/lib/scoring/types";
import { validateScheme } from "@/lib/scoring/validate";
import type { SheetSpec, CellInput } from "@/lib/xlsx/workbook";
import { gradeLayout, PARAM_COLUMNS, SCORE_COLUMNS } from "@/lib/xlsx/grade-layout";

// Builds the two sheets of a formula grade workbook for one student. Leaf scores stay
// editable numeric inputs; every derived value is a real spreadsheet formula that
// references the parameter sheet, so changing an input recalculates ancestors only.
// Missing inputs stay blank instead of becoming zero.

export type StudentIdentity = { login: string; name: string; college: string; major: string; className: string };

export type GradeSheetsInput = {
  termName: string;
  schemeRevision: number;
  batchLabel: string;
  student: StudentIdentity;
  scheme: Scheme;
  /** Leaf node id -> raw value already formatted as a decimal string. */
  values: Record<string, string>;
  /** Deduction project id -> amount as a decimal string (not yet multiplied by the coefficient). */
  deductions: Record<string, string>;
};

const number = (value: string | undefined) => {
  if (value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export function buildGradeSheets(input: GradeSheetsInput): { score: SheetSpec; params: SheetSpec } {
  const { scheme, nodes } = validateScheme(input.scheme);
  const layout = gradeLayout(input.scheme);
  const projectStart = layout.rows.length + 2;
  const projectRow = new Map(scheme.deductions.map((project, index) => [project.id, projectStart + index]));
  const deductionRefs = new Map<string, string[]>();
  for (const project of scheme.deductions) {
    const refs = deductionRefs.get(project.nodeId) ?? [];
    refs.push(`F${projectRow.get(project.id)}`);
    deductionRefs.set(project.nodeId, refs);
  }

  const S = SCORE_COLUMNS;
  const P = PARAM_COLUMNS;
  const scoreRows: CellInput[][] = [];
  const paramRows: CellInput[][] = [];

  for (const row of layout.rows) {
    const { node, scoreRow: r, paramRow: p } = row;
    const leaf = node.kind === "GRADE" || node.kind === "ACTIVITY";
    const childScores = row.children.map((child) => `${S.score}${child.scoreRow}`);

    let subtotal: CellInput;
    if (leaf) {
      subtotal = { formula: `IF(${S.input}${r}="","",${S.input}${r})` };
    } else if (node.kind === "WEIGHTED") {
      const terms = row.children.map(
        (child) => `IF(${S.score}${child.scoreRow}="",0,${S.score}${child.scoreRow})*${P.weight}${child.paramRow}`,
      );
      subtotal = { formula: childScores.length ? `IF(COUNT(${childScores.join(",")})=0,"",${terms.join("+")})` : '""' };
    } else {
      subtotal = { formula: childScores.length ? `IF(COUNT(${childScores.join(",")})=0,"",SUM(${childScores.join(",")}))` : '""' };
    }

    const capped: CellInput = node.cap !== null ? { formula: `IF(${S.subtotal}${r}="","",MIN(${S.subtotal}${r},${P.cap}${p}))` } : { formula: `${S.subtotal}${r}` };
    const normalized: CellInput = node.normalize
      ? { formula: `IF(${S.capped}${r}="","",${S.capped}${r}/${P.rawMaximum}${p}*${P.targetMaximum}${p})` }
      : { formula: `${S.capped}${r}` };
    const deducted: CellInput = (deductionRefs.get(node.id)?.length ?? 0) > 0
      ? { formula: `IF(${S.normalized}${r}="","",${S.normalized}${r}-${P.deductionTotal}${p})` }
      : { formula: `${S.normalized}${r}` };
    const scored: CellInput = node.floor !== null
      ? { formula: `IF(${S.deduction}${r}="","",MAX(${S.deduction}${r},${P.floor}${p}))` }
      : { formula: `${S.deduction}${r}` };

    scoreRows.push([
      `${"    ".repeat(row.depth)}${node.name}`,
      node.kind === "GRADE" ? "成绩输入" : node.kind === "ACTIVITY" ? "活动得分" : node.kind === "WEIGHTED" ? "比例汇总" : "汇总",
      leaf ? number(input.values[node.id]) : null,
      subtotal,
      capped,
      normalized,
      deducted,
      scored,
    ]);

    const refs = deductionRefs.get(node.id) ?? [];
    paramRows.push([
      node.name,
      number(node.cap ?? undefined),
      node.normalize ? number(node.rawMaximum ?? undefined) : null,
      node.normalize ? number(node.targetMaximum ?? undefined) : null,
      node.floor !== null ? number(node.floor) : null,
      refs.length ? { formula: `SUM(${refs.join(",")})` } : 0,
      node.parentId && nodes.get(node.parentId)?.kind === "WEIGHTED" ? number(node.weight) : null,
    ]);
  }

  for (const project of scheme.deductions) {
    paramRows.push([
      `扣分项目：${project.name}`,
      null,
      null,
      null,
      null,
      number(input.deductions[project.id]) ?? 0,
      number(project.coefficient),
    ]);
  }

  const meta = `${input.termName} · 评分方案第 ${input.schemeRevision} 版 · ${input.batchLabel} · 导出时间 ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
  return {
    score: {
      name: "成绩",
      freezeRows: 2,
      columns: [
        { header: meta, width: 120 },
        { header: `${input.student.name}（${input.student.login}）· ${input.student.college} ${input.student.major} ${input.student.className}`, width: 60 },
      ],
      rows: [
        ["模块", "计分方式", "输入分", "小计", "封顶后", "折算后", "扣分后", "计入分"],
        ...scoreRows,
      ],
    },
    params: {
      name: "参数",
      freezeRows: 1,
      columns: [
        { header: "模块 / 扣分项目", width: 28 },
        { header: "封顶", width: 10 },
        { header: "原始满分", width: 12 },
        { header: "目标满分", width: 12 },
        { header: "最低计入分", width: 12 },
        { header: "扣分合计 / 扣分值", width: 16 },
        { header: "占上级权重 / 系数", width: 16 },
      ],
      rows: paramRows,
    },
  };
}
