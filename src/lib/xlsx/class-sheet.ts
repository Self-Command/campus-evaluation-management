import { Rational } from "@/lib/scoring/rational";
import type { Scheme } from "@/lib/scoring/types";
import { validateScheme } from "@/lib/scoring/validate";
import type { CellInput, SheetSpec } from "@/lib/xlsx/workbook";

// School-style class sheet: one row per student, one column per module, a band row with
// the top-level module names. Every derived value is a spreadsheet formula built from the
// same recursion as lib/scoring/score-tree.ts, and the accompanying numeric result is kept
// so tests can prove the two agree before the workbook is offered to users.

export type ClassStudent = {
  login: string;
  name: string;
  studentNumber: string;
  values: Record<string, string>;
  /** Deduction project id -> amount. */
  deductions: Record<string, string>;
};

type Emitted = { formula: string; value: Rational | null };

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
const percentText = (weight: string) => {
  const text = Rational.from(weight).mul(Rational.from("100")).fixed(2).replace(/\.?0+$/, "");
  return `${text || "0"}%`;
};

function transform(
  node: { cap: string | null; normalize: boolean; rawMaximum: string | null; targetMaximum: string | null; floor: string | null },
  base: Emitted,
  deduction: Rational,
): Emitted {
  let { formula, value } = base;
  if (node.cap !== null) {
    formula = `MIN(${formula},${node.cap})`;
    if (value) {
      const cap = Rational.from(node.cap);
      if (value.compare(cap) > 0) value = cap;
    }
  }
  if (node.normalize && node.rawMaximum && node.targetMaximum) {
    formula = `${formula}/${node.rawMaximum}*${node.targetMaximum}`;
    if (value) value = value.div(Rational.from(node.rawMaximum)).mul(Rational.from(node.targetMaximum));
  }
  if (deduction.compare(Rational.from("0")) > 0) {
    formula = `${formula}-${deduction.fixed(6)}`;
    if (value) value = value.sub(deduction);
  }
  if (node.floor !== null) {
    formula = `MAX(${formula},${node.floor})`;
    if (value) {
      const floor = Rational.from(node.floor);
      if (value.compare(floor) < 0) value = floor;
    }
  }
  return { formula, value };
}

export function buildClassSheet(input: { title: string; batchLabel: string; scheme: Scheme; students: ClassStudent[] }): SheetSpec {
  const { scheme, nodes, children, root } = validateScheme(input.scheme);
  const order: string[] = [];
  const depth = new Map<string, number>();
  const walk = (id: string, level: number) => {
    order.push(id);
    depth.set(id, level);
    for (const child of [...(children.get(id) ?? [])].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))) walk(child.id, level + 1);
  };
  walk(root.id, 0);

  const fixed = 3;
  const columnOf = new Map(order.map((id, index) => [id, fixed + index]));
  const sortedChildren = (id: string) => [...(children.get(id) ?? [])].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const deductionOf = (student: ClassStudent, nodeId: string) =>
    scheme.deductions
      .filter((project) => project.nodeId === nodeId)
      .reduce((sum, project) => sum.add(Rational.from(student.deductions[project.id] ?? "0").mul(Rational.from(project.coefficient))), Rational.from("0"));

  const band: string[] = ["", "", ""];
  const header: string[] = ["序号", "姓名", "学号"];
  for (const id of order) {
    const node = nodes.get(id)!;
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    band.push(depth.get(id) === 0 ? node.name : depth.get(id) === 1 && parent?.kind === "WEIGHTED" ? `${node.name}×${percentText(node.weight)}` : "");
    const hints: string[] = [];
    if (parent?.kind === "WEIGHTED") hints.push(percentText(node.weight));
    if (node.cap !== null) hints.push(`不超过 ${node.cap} 分`);
    if (node.normalize) hints.push(`${node.rawMaximum} 分折算为 ${node.targetMaximum} 分`);
    header.push(`${node.name}${hints.length ? `（${hints.join("，")}）` : ""}`);
  }
  band.push("合计", "签字");
  header.push("合计", "学生本人签字确认");

  const rows: CellInput[][] = [band, header];
  input.students.forEach((student, index) => {
    const rowNumber = index + 3;
    const emit = (id: string): Emitted => {
      const node = nodes.get(id)!;
      const deduction = deductionOf(student, id);
      if (node.kind === "GRADE" || node.kind === "ACTIVITY") {
        const cell = `${columnName(columnOf.get(id)!)}${rowNumber}`;
        const raw = student.values[id];
        const parsed = raw === undefined || raw === "" ? null : Rational.from(raw);
        return transform(node, { formula: `IF(${cell}="","",${cell})`, value: parsed }, deduction);
      }
      const kids = sortedChildren(id);
      const built = kids.map((child) => emit(child.id));
      if (built.every((item) => item.value === null)) return transform(node, { formula: '""', value: null }, deduction);
      const formulas = built.map((item) => item.formula);
      const combined =
        node.kind === "WEIGHTED"
          ? formulas.map((formula, position) => `IF(${formula}="",0,${formula})*${kids[position].weight}`).join("+")
          : `SUM(${formulas.join(",")})`;
      const value = kids.reduce((sum, child, position) => {
        const childValue = built[position].value;
        if (childValue === null) return sum;
        return sum.add(node.kind === "WEIGHTED" ? childValue.mul(Rational.from(child.weight)) : childValue);
      }, Rational.from("0"));
      return transform(node, { formula: combined, value }, deduction);
    };
    const cells: CellInput[] = [index + 1, student.name, student.studentNumber];
    for (const id of order) cells.push({ formula: emit(id).formula });
    const total = emit(root.id);
    cells.push({ formula: total.formula });
    cells.push("");
    rows.push(cells);
  });

  return {
    name: "成绩明细",
    freezeRows: 2,
    columns: [
      { header: input.title, width: 10 },
      { header: input.batchLabel, width: 12 },
      { header: `共 ${input.students.length} 人`, width: 12 },
      ...order.map((id) => ({ header: nodes.get(id)!.name, width: 14 })),
      { header: "合计", width: 10 },
      { header: "签字", width: 16 },
    ],
    rows,
  };
}

/** Numeric mirror of one student's emitted tree, used by tests to reconcile with scoreTree. */
export function classSheetValues(input: { scheme: Scheme; student: ClassStudent }) {
  const { nodes, children, root } = validateScheme(input.scheme);
  const sortedChildren = (id: string) => [...(children.get(id) ?? [])].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const deductionOf = (nodeId: string) =>
    input.scheme.deductions
      .filter((project) => project.nodeId === nodeId)
      .reduce((sum, project) => sum.add(Rational.from(input.student.deductions[project.id] ?? "0").mul(Rational.from(project.coefficient))), Rational.from("0"));
  const values = new Map<string, Rational | null>();
  const visit = (id: string): Rational | null => {
    const node = nodes.get(id)!;
    let value: Rational | null;
    if (node.kind === "GRADE" || node.kind === "ACTIVITY") {
      const raw = input.student.values[id];
      value = raw === undefined || raw === "" ? null : Rational.from(raw);
    } else {
      const kids = sortedChildren(id);
      let total = Rational.from("0");
      let any = false;
      for (const child of kids) {
        const childValue = visit(child.id);
        if (childValue === null) continue;
        any = true;
        total = total.add(node.kind === "WEIGHTED" ? childValue.mul(Rational.from(child.weight)) : childValue);
      }
      value = any ? total : null;
    }
    const deduction = deductionOf(id);
    if (value) {
      if (node.cap !== null) {
        const cap = Rational.from(node.cap);
        if (value.compare(cap) > 0) value = cap;
      }
      if (node.normalize && node.rawMaximum && node.targetMaximum) value = value.div(Rational.from(node.rawMaximum)).mul(Rational.from(node.targetMaximum));
      if (deduction.compare(Rational.from("0")) > 0) value = value.sub(deduction);
      if (node.floor !== null) {
        const floor = Rational.from(node.floor);
        if (value.compare(floor) < 0) value = floor;
      }
    }
    values.set(id, value);
    return value;
  };
  visit(root.id);
  return values;
}
