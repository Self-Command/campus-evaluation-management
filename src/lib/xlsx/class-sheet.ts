import { exportDateTimeText } from "@/lib/business-labels";
import { Rational } from "@/lib/scoring/rational";
import type { Scheme, ScoringNode } from "@/lib/scoring/types";
import { validateScheme } from "@/lib/scoring/validate";
import { bandStyle } from "@/lib/xlsx/theme";
import type { CellInput, CellStyle, PrintSetup, SheetSpec } from "@/lib/xlsx/workbook";

// School-style class sheet: one row per student. The header is generated from the real
// module tree, so any module count, depth or weighting configured in the scheme keeps a
// complete multi-level header. Leaf score columns are inputs; every subtotal, weighted
// share, pre-deduction total and final total is an Excel formula whose coefficients come
// from the generated rules sheet. Published workbooks keep the formulas and protect the
// sheets instead of replacing them with frozen numbers. Every band is chosen by module
// order, never by module name.

export type ClassStudent = {
  login: string;
  name: string;
  studentNumber: string;
  college?: string;
  major?: string;
  className?: string;
  values: Record<string, string>;
  /** Deduction project id -> raw amount. */
  deductions: Record<string, string>;
};

type BuildInput = {
  title: string;
  termName?: string;
  batchLabel: string;
  scheme: Scheme;
  students: ClassStudent[];
  /** Show college / major / class columns (needed for multi-class and college exports). */
  showOrganization?: boolean;
  /** Published workbooks are protected snapshots: formulas stay visible, inputs are locked. */
  mode?: "live" | "published";
};

type Column =
  | { kind: "input"; nodeId: string; width: number }
  | { kind: "subtotal"; nodeId: string; width: number }
  | { kind: "ratio"; nodeId: string; coefficientNodeId: string; width: number }
  | { kind: "deduction"; projectId: string; width: number }
  | { kind: "deductionTotal"; width: number }
  | { kind: "preTotal"; width: number }
  | { kind: "status"; width: number }
  | { kind: "total"; width: number }
  | { kind: "signature"; width: number };

type DisplayBlock = {
  node: ScoringNode;
  depth: number;
  start: number;
  end: number;
  inputColumn?: number;
  subtotalColumn?: number;
  ratioColumn?: number;
  ratioCoefficientNodeId?: string;
  children: DisplayBlock[];
};

const columnName = (index: number) => {
  let name = "";
  let current = index + 1;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    current = Math.floor((current - 1) / 26);
  }
  return name;
};
const reference = (col: number, row: number) => `${columnName(col)}${row}`;
const percentText = (weight: string) => {
  const text = Rational.from(weight).mul(Rational.from("100")).fixed(2).replace(/\.?0+$/, "");
  return `${text || "0"}%`;
};
const numeric = (value: string | undefined) => {
  if (value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const collator = new Intl.Collator("zh-Hans-CN", { numeric: true, sensitivity: "base" });
const organizationOrder = (a: ClassStudent, b: ClassStudent) =>
  collator.compare(a.college ?? "", b.college ?? "") ||
  collator.compare(a.major ?? "", b.major ?? "") ||
  collator.compare(a.className ?? "", b.className ?? "") ||
  collator.compare(a.studentNumber || a.login, b.studentNumber || b.login) ||
  collator.compare(a.name, b.name) ||
  collator.compare(a.login, b.login);
const cached = (value: Rational | null | undefined) => (value ? Number(value.fixed(6)) : 0);
const formulaCell = (formula: string, value: Rational | null | undefined, style: CellStyle = "formula"): CellInput => ({
  formula,
  cached: cached(value),
  style,
});
const textCell = (value: string): CellInput => ({ value, style: "text" });
const styledCell = (value: string | number | null, style: CellStyle): CellInput => ({ value, style });

const KIND_LABEL: Record<ScoringNode["kind"], string> = {
  GRADE: "成绩项",
  ACTIVITY: "活动项",
  SUM: "合计项",
  WEIGHTED: "权重汇总项",
};

function sortedChildren(schemeNodes: Map<string, ScoringNode>, children: Map<string, ScoringNode[]>, id: string) {
  return [...(children.get(id) ?? [])].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/** Score limits belong to the module total, never to the multiplier caption. */
function scoreHints(node: ScoringNode, group: boolean) {
  const scope = group ? "模块合计" : "";
  const hints: string[] = [];
  if (node.cap !== null) hints.push(`${scope}不超过${node.cap}分`);
  if (node.floor !== null) hints.push(`${scope}最低${node.floor}分`);
  if (node.normalize && node.rawMaximum && node.targetMaximum) hints.push(`原始满分${node.rawMaximum}分折算为${node.targetMaximum}分`);
  return hints;
}

function leafCaption(node: ScoringNode) {
  const hints = scoreHints(node, false);
  return `${node.name}${hints.length ? `（${hints.join("，")}）` : ""}`;
}

function groupCaption(node: ScoringNode) {
  const hints = scoreHints(node, true);
  return `${node.name}${hints.length ? `（${hints.join("，")}）` : ""}`;
}

/** The multiplier sits only on the ratio column and always names the multiplied module. */
function ratioCaption(node: ScoringNode, weight: string) {
  const percent = percentText(weight);
  return percent === "100%" ? `${node.name}比例分` : `${node.name}×${percent}`;
}

export function buildRulesSheet(scheme: Scheme, order: ScoringNode[], mode: "live" | "published" = "live") {
  const validated = validateScheme(scheme);
  const published = mode === "published";
  const parameterCell = (value: number | null): CellInput => value === null
    ? textCell("—")
    : { value, style: published ? "inputReadonly" : "input" };
  const requiredText = (node: ScoringNode) =>
    node.kind === "GRADE" || node.kind === "ACTIVITY" ? (node.required ? "是" : "否") : "—";
  const nodeRows = new Map<string, number>();
  order.forEach((node, index) => nodeRows.set(node.id, index + 2));
  const projectRows = new Map<string, number>();
  scheme.deductions.forEach((project, index) => projectRows.set(project.id, order.length + index + 2));
  const rows: CellInput[][] = [
    ...order.map((node) => [
      textCell(node.name),
      textCell(KIND_LABEL[node.kind]),
      textCell(node.parentId ? validated.nodes.get(node.parentId)?.name ?? "—" : "—"),
      parameterCell(node.cap === null ? null : Number(node.cap)),
      parameterCell(node.normalize ? Number(node.rawMaximum ?? 0) : null),
      parameterCell(node.normalize ? Number(node.targetMaximum ?? 0) : null),
      parameterCell(node.floor === null ? null : Number(node.floor)),
      parameterCell(node.parentId && validated.nodes.get(node.parentId)?.kind === "WEIGHTED" ? Number(node.weight) : null),
      textCell("—"),
      textCell(requiredText(node)),
    ]),
    ...scheme.deductions.map((project) => [
      textCell(project.name),
      textCell("扣分项"),
      textCell(validated.nodes.get(project.nodeId)?.name ?? "—"),
      textCell("—"),
      textCell("—"),
      textCell("—"),
      textCell("—"),
      textCell("—"),
      parameterCell(Number(project.coefficient)),
      textCell("—"),
    ]),
  ];
  const firstNoteRow = 2 + rows.length;
  const lastRow = firstNoteRow + 2;
  const print: PrintSetup = {
    orientation: "landscape",
    paperSize: 9,
    fitToWidth: 1,
    fitToHeight: 0,
    repeatRows: "1:1",
    printArea: `A1:J${lastRow}`,
    margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.25 },
    footer: "&C第 &P 页，共 &N 页",
  };
  const sheet: SheetSpec = {
    name: "评分规则",
    autoHeader: true,
    headerStyle: "fixedHeader",
    freezeRows: 1,
    columns: [
      { header: "名称", width: 28 },
      { header: "项目类型", width: 13 },
      { header: "所属上级", width: 20 },
      { header: "合计上限（封顶）", width: 15 },
      { header: "原始满分", width: 12 },
      { header: "折算满分", width: 12 },
      { header: "合计最低分", width: 12 },
      { header: "权重（乘数）", width: 13 },
      { header: "扣分系数", width: 11 },
      { header: "必填项", width: 10 },
    ],
    merges: [`A${firstNoteRow}:J${firstNoteRow}`, `A${firstNoteRow + 1}:J${firstNoteRow + 1}`, `A${lastRow}:J${lastRow}`],
    outlines: [{ range: `A1:J${lastRow}`, weight: "thick" }],
    rowHeights: { 1: 32, [firstNoteRow]: 40, [firstNoteRow + 1]: 52, [lastRow]: 40 },
    protected: published,
    rows: [
      ...rows,
      [{
        value: published
          ? "本表为正式发布时的参数快照，参数已锁定，不含计算公式；成绩明细表保留公式，并按锁定参数显示发布时结果。"
          : "本表为评分参数说明，不含计算公式。黄色单元格为可修改参数；修改后，成绩明细表中的公式会按新参数重算。",
        style: "note",
      }, null, null, null, null, null, null, null, null, null],
      [{
        value: "权重（乘数）只对“权重汇总项”的直接下级生效，同一“权重汇总项”下直接下级权重合计必须为 100%；“合计项”下级权重不参与计分。成绩明细表中“合计项”下级旁的比例列只展示上级占比的分配，不重复计入总分。扣分系数只作用于对应扣分项，扣分按所属模块计入。",
        style: "note",
      }, null, null, null, null, null, null, null, null, null],
      [{
        value: "类型说明：成绩项：直接录入成绩；活动项：按审核通过的活动记录累计；合计项：直接相加下级结果；权重汇总项：按下级权重加权汇总；扣分项：登记值×扣分系数。非适用项显示“—”。",
        style: "note",
      }, null, null, null, null, null, null, null, null, null],
    ],
    print,
  };
  return { sheet, nodeRows, projectRows };
}

/**
 * Build the complete class/college workbook. Input cells always carry a number (0 when
 * no score was entered), so no score column is ever blank. Every calculated cell is a
 * formula with a cached value, including in published snapshots, where both sheets are
 * protected and the input cells are locked.
 */
export function buildClassSheet(input: BuildInput): { detail: SheetSpec; rules: SheetSpec } {
  const mode = input.mode ?? "live";
  const published = mode === "published";
  // Every export, whatever its scope, uses the same organization order.
  const students = [...input.students].sort(organizationOrder);
  const { nodes, children, root } = validateScheme(input.scheme);
  const order: ScoringNode[] = [];
  const walk = (node: ScoringNode) => {
    order.push(node);
    for (const child of sortedChildren(nodes, children, node.id)) walk(child);
  };
  walk(root);
  const { sheet: rules, nodeRows, projectRows } = buildRulesSheet(input.scheme, order, mode);
  const rule = (row: number, col: string) => `'评分规则'!$${col}$${row}`;

  const showOrganization = !!input.showOrganization;
  const fixedLabels = showOrganization
    ? ["序号", "姓名", "学号", "学院", "专业", "班级"]
    : ["序号", "姓名", "学号"];
  const fixedColumns = fixedLabels.length;
  const columns: Column[] = [];
  const inputColumn = new Map<string, number>();
  const subtotalColumn = new Map<string, number>();
  const ratioColumn = new Map<string, number>();
  const ratioCoefficientNode = new Map<string, string>();
  const blockByNode = new Map<string, DisplayBlock>();
  const direct = sortedChildren(nodes, children, root.id);
  const rootIsLeaf = direct.length === 0;
  const topBlocks: DisplayBlock[] = [];

  const appendBlock = (node: ScoringNode, depth: number, parent: ScoringNode | undefined): DisplayBlock => {
    const kids = sortedChildren(nodes, children, node.id);
    const block: DisplayBlock = {
      node,
      depth,
      start: columns.length,
      end: columns.length,
      children: [],
    };
    if (kids.length === 0) {
      block.inputColumn = columns.length;
      inputColumn.set(node.id, columns.length);
      columns.push({ kind: "input", nodeId: node.id, width: node.kind === "ACTIVITY" ? 18 : 16 });
    } else {
      block.children = kids.map((child) => appendBlock(child, depth + 1, node));
      block.subtotalColumn = columns.length;
      subtotalColumn.set(node.id, columns.length);
      columns.push({ kind: "subtotal", nodeId: node.id, width: 14 });
    }
    // A normal grouping module can carry the weighted share of a whole area. In that
    // case its child modules show how that share is distributed, without inventing a
    // weight that the scoring engine does not use.
    const allocatedByParent = !!parent
      && parent.kind !== "WEIGHTED"
      && kids.length > 0
      && Rational.from(parent.weight).compare(Rational.from("1")) !== 0
      && parent.parentId !== null
      && nodes.get(parent.parentId)?.kind === "WEIGHTED";
    const coefficientNodeId = parent?.kind === "WEIGHTED" ? node.id : allocatedByParent ? parent.id : null;
    if (coefficientNodeId) {
      block.ratioColumn = columns.length;
      block.ratioCoefficientNodeId = coefficientNodeId;
      ratioColumn.set(node.id, columns.length);
      ratioCoefficientNode.set(node.id, coefficientNodeId);
      columns.push({ kind: "ratio", nodeId: node.id, coefficientNodeId, width: 14 });
    }
    block.end = columns.length - 1;
    blockByNode.set(node.id, block);
    return block;
  };

  if (rootIsLeaf) {
    const block: DisplayBlock = {
      node: root,
      depth: 0,
      start: columns.length,
      end: columns.length,
      inputColumn: columns.length,
      children: [],
    };
    inputColumn.set(root.id, columns.length);
    columns.push({ kind: "input", nodeId: root.id, width: 18 });
    blockByNode.set(root.id, block);
    topBlocks.push(block);
  } else {
    for (const child of direct) topBlocks.push(appendBlock(child, 0, root));
  }

  const preTotalIndex = rootIsLeaf ? undefined : columns.length;
  if (preTotalIndex !== undefined) columns.push({ kind: "preTotal", width: 16 });
  const deductionColumnIndex = new Map<string, number>();
  const deductionStart = columns.length;
  for (const project of input.scheme.deductions) {
    deductionColumnIndex.set(project.id, columns.length);
    columns.push({ kind: "deduction", projectId: project.id, width: 15 });
  }
  const hasDeductionBlock = input.scheme.deductions.length > 0;
  if (hasDeductionBlock) columns.push({ kind: "deductionTotal", width: 13 });
  if (!published) columns.push({ kind: "status", width: 11 });
  columns.push({ kind: "total", width: 16 });
  columns.push({ kind: "signature", width: 20 });

  const maxDepth = (() => {
    let depth = 0;
    const visit = (block: DisplayBlock) => {
      depth = Math.max(depth, block.depth);
      for (const child of block.children) visit(child);
    };
    for (const block of topBlocks) visit(block);
    return depth;
  })();
  const headerTop = 3;
  const leafRow = headerTop + maxDepth + 1;
  const headerRowCount = leafRow - headerTop + 1;
  const lastColumn = fixedColumns + columns.length - 1;
  const lastRow = leafRow + students.length;
  const merges: string[] = [`A1:${columnName(lastColumn)}1`, `A2:${columnName(lastColumn)}2`];
  const mergeSet = new Set(merges);
  const addMerge = (row1: number, column1: number, row2: number, column2: number) => {
    if (row1 === row2 && column1 === column2) return;
    const range = `${columnName(column1)}${row1}:${columnName(column2)}${row2}`;
    if (!mergeSet.has(range)) {
      mergeSet.add(range);
      merges.push(range);
    }
  };
  const headerRows: CellInput[][] = Array.from({ length: headerRowCount }, () =>
    Array.from({ length: lastColumn + 1 }, () => ({ value: null, style: "grid" })),
  );
  const setHeader = (row: number, column: number, value: string, style: CellStyle) => {
    headerRows[row - headerTop][column] = styledCell(value, style);
  };

  fixedLabels.forEach((label, column) => {
    setHeader(headerTop, column, label, "fixedHeader");
    addMerge(headerTop, column, leafRow, column);
  });

  const renderBlock = (block: DisplayBlock, band: number) => {
    const { node, depth, start, end } = block;
    const groupRow = headerTop + depth;
    const coefficientNode = block.ratioCoefficientNodeId ? nodes.get(block.ratioCoefficientNodeId) : undefined;
    // The actual-score column only says what it is. The multiplier belongs to the ratio
    // column, and every ratio/weighted column names the module it multiplies.
    const captionEnd = block.inputColumn !== undefined ? block.inputColumn : end;
    const caption = block.inputColumn !== undefined ? leafCaption(node) : groupCaption(node);
    setHeader(groupRow, fixedColumns + start, caption, bandStyle(band, "group"));
    addMerge(groupRow, fixedColumns + start, groupRow, fixedColumns + captionEnd);

    const detailRow = Math.min(groupRow + 1, leafRow);
    const ratioLabel = ratioCaption(node, coefficientNode?.weight ?? "1");
    if (block.inputColumn !== undefined) {
      addMerge(groupRow, fixedColumns + block.inputColumn, leafRow, fixedColumns + block.inputColumn);
      if (block.ratioColumn !== undefined) {
        setHeader(groupRow, fixedColumns + block.ratioColumn, ratioLabel, bandStyle(band));
        addMerge(groupRow, fixedColumns + block.ratioColumn, leafRow, fixedColumns + block.ratioColumn);
      }
    }
    if (block.subtotalColumn !== undefined) {
      const subtotalLabel = `${node.name}${node.kind === "WEIGHTED" ? "比例分合计" : "实际分合计"}`;
      setHeader(detailRow, fixedColumns + block.subtotalColumn, subtotalLabel, bandStyle(band));
      addMerge(detailRow, fixedColumns + block.subtotalColumn, leafRow, fixedColumns + block.subtotalColumn);
    }
    if (block.ratioColumn !== undefined && block.inputColumn === undefined) {
      setHeader(detailRow, fixedColumns + block.ratioColumn, ratioLabel, bandStyle(band));
      addMerge(detailRow, fixedColumns + block.ratioColumn, leafRow, fixedColumns + block.ratioColumn);
    }
    block.children.forEach((child) => renderBlock(child, band));
  };
  topBlocks.forEach((block, index) => renderBlock(block, index));

  if (preTotalIndex !== undefined) {
    setHeader(headerTop, fixedColumns + preTotalIndex, "扣分前总分", "resultHeader");
    addMerge(headerTop, fixedColumns + preTotalIndex, leafRow, fixedColumns + preTotalIndex);
  }

  if (hasDeductionBlock) {
    const deductionEnd = deductionStart + input.scheme.deductions.length;
    setHeader(headerTop, fixedColumns + deductionStart, "扣分项", "deductionHeader");
    addMerge(headerTop, fixedColumns + deductionStart, headerTop, fixedColumns + deductionEnd);
    const detailRow = Math.min(headerTop + 1, leafRow);
    input.scheme.deductions.forEach((project) => {
      const index = deductionColumnIndex.get(project.id)!;
      setHeader(detailRow, fixedColumns + index, `${project.name}（登记值）`, "deductionHeader");
      addMerge(detailRow, fixedColumns + index, leafRow, fixedColumns + index);
    });
    const totalIndex = deductionStart + input.scheme.deductions.length;
    const hasCoefficient = input.scheme.deductions.some((project) => Rational.from(project.coefficient).compare(Rational.from("1")) !== 0);
    setHeader(detailRow, fixedColumns + totalIndex, hasCoefficient ? "扣分合计（已乘扣分系数）" : "扣分合计", "deductionHeader");
    addMerge(detailRow, fixedColumns + totalIndex, leafRow, fixedColumns + totalIndex);
  }

  const resultStart = fixedColumns + columns.findIndex((column) => column.kind === "status" || column.kind === "total");
  setHeader(headerTop, resultStart, "结果与确认", "resultHeader");
  addMerge(headerTop, resultStart, headerTop, lastColumn);
  const resultDetailRow = Math.min(headerTop + 1, leafRow);
  const resultLabels: Record<string, string> = {
    status: "必填项状态",
    total: "综合测评总分（扣分后）",
    signature: "学生本人签字确认",
  };
  columns.forEach((column, index) => {
    if (column.kind === "status" || column.kind === "total" || column.kind === "signature") {
      setHeader(resultDetailRow, fixedColumns + index, resultLabels[column.kind], "resultHeader");
      addMerge(resultDetailRow, fixedColumns + index, leafRow, fixedColumns + index);
    }
  });

  const requiredLeaves = order.filter((node) => (node.kind === "GRADE" || node.kind === "ACTIVITY") && node.required);
  const valueMap = new Map(students.map((student) => [student, classSheetValues({ scheme: input.scheme, student })]));

  const sumIfAny = (cells: string[]) => cells.length
    ? `IF(COUNT(${cells.join(",")})=0,"",SUM(${cells.join(",")}))`
    : '""';

  const transform = (node: ScoringNode, base: string, row: number): string => {
    let expr = base;
    const guard = (value: string) => `IF((${value})="","",`;
    if (node.cap !== null) expr = `${guard(expr)}MIN((${expr}),${rule(nodeRows.get(node.id)!, "D")}))`;
    if (node.normalize && node.rawMaximum && node.targetMaximum) {
      expr = `${guard(expr)}((${expr})/${rule(nodeRows.get(node.id)!, "E")}*${rule(nodeRows.get(node.id)!, "F")}))`;
    }
    const deductions = input.scheme.deductions.filter((project) => project.nodeId === node.id);
    if (deductions.length) {
      const effective = deductions.map((project) => `${rule(projectRows.get(project.id)!, "I")}*N(${deductionRawReference(project.id, row)})`).join("+");
      expr = `${guard(expr)}((${expr})-(${effective})))`;
    }
    if (node.floor !== null) expr = `${guard(expr)}MAX((${expr}),${rule(nodeRows.get(node.id)!, "G")}))`;
    return expr;
  };

  const scoreExpr = (node: ScoringNode, row: number): string => {
    const kids = sortedChildren(nodes, children, node.id);
    if (kids.length === 0) {
      return transform(node, reference(fixedColumns + inputColumn.get(node.id)!, row), row);
    }
    if (node.kind === "WEIGHTED") {
      const terms = kids.map((child) => reference(fixedColumns + blockByNode.get(child.id)!.ratioColumn!, row));
      return transform(node, sumIfAny(terms), row);
    }
    const terms = kids.map((child) => {
      const childBlock = blockByNode.get(child.id)!;
      return childBlock.subtotalColumn !== undefined
        ? reference(fixedColumns + childBlock.subtotalColumn, row)
        : scoreExpr(child, row);
    });
    return transform(node, sumIfAny(terms), row);
  };

  const deductionRawReference = (projectId: string, row: number) => {
    const index = deductionColumnIndex.get(projectId);
    return index === undefined ? "0" : reference(fixedColumns + index, row);
  };

  const deductionTotalFormula = (row: number) => input.scheme.deductions.length
    ? input.scheme.deductions.map((project) => `${rule(projectRows.get(project.id)!, "I")}*N(${deductionRawReference(project.id, row)})`).join("+")
    : "0";

  const rootContributionExpr = (row: number) => {
    if (rootIsLeaf) return scoreExpr(root, row);
    if (root.kind === "WEIGHTED") {
      return sumIfAny(direct.map((child) => reference(fixedColumns + blockByNode.get(child.id)!.ratioColumn!, row)));
    }
    return sumIfAny(direct.map((child) => {
      const block = blockByNode.get(child.id)!;
      return block.subtotalColumn !== undefined
        ? reference(fixedColumns + block.subtotalColumn, row)
        : scoreExpr(child, row);
    }));
  };

  // Combined score before the final deduction. Root cap/normalization is applied here;
  // root-level deductions and the floor are applied once in the final total.
  const preTotalExpr = (row: number) => {
    if (preTotalIndex === undefined) return undefined;
    let expr = rootContributionExpr(row);
    const guard = (value: string) => `IF((${value})="","",`;
    if (root.cap !== null) expr = `${guard(expr)}MIN((${expr}),${rule(nodeRows.get(root.id)!, "D")}))`;
    if (root.normalize && root.rawMaximum && root.targetMaximum) {
      expr = `${guard(expr)}((${expr})/${rule(nodeRows.get(root.id)!, "E")}*${rule(nodeRows.get(root.id)!, "F")}))`;
    }
    return expr;
  };

  const preTotalValue = (mirror: Map<string, Rational>) => {
    if (preTotalIndex === undefined) return undefined;
    let value = direct.reduce(
      (sum, child) => sum.add(root.kind === "WEIGHTED" ? mirror.get(child.id)!.mul(Rational.from(child.weight)) : mirror.get(child.id)!),
      Rational.from("0"),
    );
    if (root.cap !== null) {
      const cap = Rational.from(root.cap);
      if (value.compare(cap) > 0) value = cap;
    }
    if (root.normalize && root.rawMaximum && root.targetMaximum) {
      value = value.div(Rational.from(root.rawMaximum)).mul(Rational.from(root.targetMaximum));
    }
    return value;
  };

  const totalFormula = (row: number) => {
    if (rootIsLeaf) {
      const core = scoreExpr(root, row);
      return `IF((${core})="",0,${core})`;
    }
    const preRef = reference(fixedColumns + preTotalIndex!, row);
    const rootDeductions = input.scheme.deductions.filter((project) => project.nodeId === root.id);
    let expr = preRef;
    if (rootDeductions.length) {
      const terms = rootDeductions.map((project) => `${rule(projectRows.get(project.id)!, "I")}*N(${deductionRawReference(project.id, row)})`).join("+");
      expr = `IF((${preRef})="","",(${preRef})-(${terms}))`;
    }
    if (root.floor !== null) expr = `IF((${expr})="","",MAX((${expr}),${rule(nodeRows.get(root.id)!, "G")}))`;
    return `IF((${expr})="",0,${expr})`;
  };

  const ratioFormula = (node: ScoringNode, row: number) => {
    const block = blockByNode.get(node.id)!;
    const coefficientNode = nodes.get(ratioCoefficientNode.get(node.id)!)!;
    const base = block.subtotalColumn !== undefined
      ? reference(fixedColumns + block.subtotalColumn, row)
      : scoreExpr(node, row);
    return `IF((${base})="","",(${base})*${rule(nodeRows.get(coefficientNode.id)!, "H")})`;
  };

  const stamp = exportDateTimeText();
  const prefix = input.termName ? `${input.termName} · ` : "";
  const meta = published
    ? `${prefix}${input.batchLabel} · 导出时间 ${stamp} · 正式发布快照，录入内容已锁定，保留计算公式，白色单元格显示发布时结果`
    : `${prefix}${input.batchLabel} · 导出时间 ${stamp} · 黄色单元格为录入项，白色单元格由公式自动计算；未录入的必填项按 0 参与计算并标记为“必填缺项”，填写 0 表示确无该项分数`;
  const inputStyle: CellStyle = published ? "inputReadonly" : "input";
  const inputValue = (value: string | undefined) => ({ value: numeric(value) ?? 0, style: inputStyle });

  const rows: CellInput[][] = [
    [styledCell(input.title, "title")],
    [styledCell(meta, "meta")],
    ...headerRows,
  ];
  students.forEach((student, index) => {
    const row = leafRow + 1 + index;
    const mirror = valueMap.get(student)!;
    const missing = requiredLeaves.filter((node) => student.values[node.id] === undefined || student.values[node.id] === "");
    const cells: CellInput[] = [
      { value: index + 1, style: "text" },
      textCell(student.name),
      textCell(student.studentNumber),
      ...(showOrganization ? [textCell(student.college ?? ""), textCell(student.major ?? ""), textCell(student.className ?? "")] : []),
    ];
    for (const column of columns) {
      if (column.kind === "input") {
        cells.push(inputValue(student.values[column.nodeId]));
      } else if (column.kind === "subtotal") {
        cells.push(formulaCell(scoreExpr(nodes.get(column.nodeId)!, row), mirror.get(column.nodeId), "formula"));
      } else if (column.kind === "ratio") {
        const node = nodes.get(column.nodeId)!;
        const coefficientNode = nodes.get(column.coefficientNodeId)!;
        const value = mirror.get(node.id)!.mul(Rational.from(coefficientNode.weight));
        cells.push(formulaCell(ratioFormula(node, row), value, "formula"));
      } else if (column.kind === "deduction") {
        cells.push(inputValue(student.deductions[column.projectId]));
      } else if (column.kind === "deductionTotal") {
        const value = input.scheme.deductions.reduce(
          (sum, project) => sum.add(Rational.from(student.deductions[project.id] ?? "0").mul(Rational.from(project.coefficient))),
          Rational.from("0"),
        );
        cells.push(formulaCell(deductionTotalFormula(row), value, "formula"));
      } else if (column.kind === "preTotal") {
        cells.push(formulaCell(preTotalExpr(row)!, preTotalValue(mirror), "formula"));
      } else if (column.kind === "status") {
        cells.push({ value: missing.length ? "必填缺项" : "必填齐全", style: "status" });
      } else if (column.kind === "total") {
        cells.push(formulaCell(totalFormula(row), mirror.get(root.id), "total"));
      } else {
        cells.push({ value: null, style: "signature" });
      }
    }
    rows.push(cells);
  });

  const rowHeights: Record<number, number> = { 1: 38, 2: 32 };
  for (let row = headerTop; row <= leafRow; row += 1) rowHeights[row] = row === leafRow ? 52 : 40;
  for (let row = leafRow + 1; row <= lastRow; row += 1) rowHeights[row] = 30;

  const outlineRanges: SheetSpec["outlines"] = [
    { range: `A1:${columnName(lastColumn)}${lastRow}`, weight: "thick" },
  ];
  if (students.length) {
    outlineRanges.push({ range: `A${leafRow + 1}:${columnName(fixedColumns - 1)}${lastRow}`, weight: "medium" });
    for (const block of topBlocks) {
      const start = fixedColumns + block.start;
      const end = fixedColumns + block.end;
      outlineRanges.push({ range: `${columnName(start)}${leafRow + 1}:${columnName(end)}${lastRow}`, weight: "medium" });
    }
    if (hasDeductionBlock) {
      outlineRanges.push({
        range: `${columnName(fixedColumns + deductionStart)}${leafRow + 1}:${columnName(fixedColumns + deductionStart + input.scheme.deductions.length)}${lastRow}`,
        weight: "medium",
      });
    }
    outlineRanges.push({ range: `${columnName(resultStart)}${leafRow + 1}:${columnName(lastColumn)}${lastRow}`, weight: "medium" });
  }

  const print: PrintSetup = {
    orientation: "landscape",
    paperSize: lastColumn >= 14 ? 8 : 9,
    fitToWidth: 1,
    fitToHeight: 0,
    repeatRows: `1:${leafRow}`,
    repeatColumns: `A:${columnName(fixedColumns - 1)}`,
    printArea: `A1:${columnName(lastColumn)}${lastRow}`,
    margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.55, header: 0.2, footer: 0.25 },
    footer: "&C第 &P 页，共 &N 页",
  };

  const detail: SheetSpec = {
    name: "成绩明细",
    autoHeader: false,
    freezeRows: leafRow,
    freezeColumns: fixedColumns,
    columns: [
      { width: 6 },
      { width: 12 },
      { width: 16 },
      ...(showOrganization ? [{ width: 18 }, { width: 18 }, { width: 16 }] : []),
      ...columns.map((column) => ({ width: column.width })),
    ],
    merges,
    rowHeights,
    outlines: outlineRanges,
    print,
    protected: published,
    rows,
  };
  return { detail, rules };
}

/** Numeric mirror of one student's emitted tree, used by tests and cached formula values. */
export function classSheetValues(input: { scheme: Scheme; student: ClassStudent }) {
  const { nodes, children, root } = validateScheme(input.scheme);
  const sorted = (id: string) => [...(children.get(id) ?? [])].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const deductionOf = (nodeId: string) =>
    input.scheme.deductions
      .filter((project) => project.nodeId === nodeId)
      .reduce((sum, project) => sum.add(Rational.from(input.student.deductions[project.id] ?? "0").mul(Rational.from(project.coefficient))), Rational.from("0"));
  const values = new Map<string, Rational>();
  const visit = (id: string): Rational => {
    const node = nodes.get(id)!;
    let value: Rational;
    if (node.kind === "GRADE" || node.kind === "ACTIVITY") {
      const raw = input.student.values[id];
      value = raw === undefined || raw === "" ? Rational.from("0") : Rational.from(raw);
    } else {
      const kids = sorted(id);
      let total = Rational.from("0");
      for (const child of kids) {
        const childValue = visit(child.id);
        total = total.add(node.kind === "WEIGHTED" ? childValue.mul(Rational.from(child.weight)) : childValue);
      }
      value = total;
    }
    if (node.cap !== null) {
      const cap = Rational.from(node.cap);
      if (value.compare(cap) > 0) value = cap;
    }
    if (node.normalize && node.rawMaximum && node.targetMaximum) value = value.div(Rational.from(node.rawMaximum)).mul(Rational.from(node.targetMaximum));
    const deduction = deductionOf(id);
    if (deduction.compare(Rational.from("0")) > 0) value = value.sub(deduction);
    if (node.floor !== null) {
      const floor = Rational.from(node.floor);
      if (value.compare(floor) < 0) value = floor;
    }
    values.set(id, value);
    return value;
  };
  visit(root.id);
  return values;
}
