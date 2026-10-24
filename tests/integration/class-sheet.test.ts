import { expect, test } from "vitest";
import { calculate } from "@/lib/scoring/calculate";
import { scoreTree } from "@/lib/scoring/score-tree";
import { nodeSchema, type Scheme } from "@/lib/scoring/types";
import { buildClassSheet, classSheetValues, type ClassStudent } from "@/lib/xlsx/class-sheet";
import { buildMultiSheetWorkbook, buildWorkbook, type CellInput, type FormulaCell, type SheetSpec } from "@/lib/xlsx/workbook";
import { evaluateWorkbook } from "./formula-evaluator";

const scheme: Scheme = {
  nodes: [
    nodeSchema.parse({ id: "total", parentId: null, name: "综合测评成绩", kind: "WEIGHTED", order: 0 }),
    nodeSchema.parse({ id: "academic", parentId: "total", name: "学业成绩", kind: "SUM", order: 0, weight: "0.7" }),
    nodeSchema.parse({ id: "grade", parentId: "academic", name: "必修课", kind: "GRADE", order: 0, cap: "100", floor: "60", required: true }),
    nodeSchema.parse({ id: "activity", parentId: "total", name: "活动与成果", kind: "ACTIVITY", order: 1, weight: "0.3", cap: "50", normalize: true, rawMaximum: "100", targetMaximum: "20" }),
  ],
  deductions: [{ id: "discipline", nodeId: "grade", name: "纪律扣分", coefficient: "2" }],
};

const students: ClassStudent[] = [
  { login: "20260001", name: "张三", studentNumber: "20260001", values: { grade: "88", activity: "60" }, deductions: { discipline: "3" } },
  { login: "20260002", name: "李四", studentNumber: "20260002", values: { grade: "72", activity: "30" }, deductions: {} },
];

const shown = (cell: CellInput | undefined) => {
  if (cell === undefined || cell === null) return "";
  if (typeof cell === "string" || typeof cell === "number") return String(cell);
  if ("value" in cell) return cell.value === null ? "" : String(cell.value);
  return cell.formula;
};

const columnLetters = (index: number) => {
  let value = "";
  let current = index + 1;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    value = String.fromCharCode(65 + remainder) + value;
    current = Math.floor((current - 1) / 26);
  }
  return value;
};

const headerRows = (detail: SheetSpec) => detail.rows.slice(2, detail.freezeRows);
const headerTexts = (detail: SheetSpec) => headerRows(detail).flatMap((row) => row.map(shown));

const columnOf = (detail: SheetSpec, text: string) => {
  for (const row of headerRows(detail)) {
    const index = row.findIndex((cell) => shown(cell).includes(text));
    if (index >= 0) return index;
  }
  throw new Error(`找不到表头：${text}`);
};

const columnsEndingWith = (detail: SheetSpec, suffix: string) => {
  const found = new Set<number>();
  for (const row of headerRows(detail)) row.forEach((cell, index) => { if (shown(cell).endsWith(suffix)) found.add(index); });
  return [...found].sort((a, b) => a - b);
};

const dataRow = (detail: SheetSpec) => detail.freezeRows!;

test("列式班级表的数值与计分引擎、scoreTree 三方一致", () => {
  for (const student of students) {
    const emitted = classSheetValues({ scheme, student });
    const engine = calculate(scheme, { values: student.values, deductions: student.deductions });
    const tree = scoreTree(scheme, { values: student.values, deductions: student.deductions });
    for (const detail of engine.details) {
      expect(emitted.get(detail.id)?.fixed(), `${student.name} / ${detail.name} 与引擎不一致`).toBe(detail.score);
      expect(tree.get(detail.id)?.value?.fixed(), `${student.name} / ${detail.name} 与 scoreTree 不一致`).toBe(detail.score);
    }
  }
});

test("班级表按模块树生成多层表头，用户只看到模块、实际分和比例分", () => {
  const { detail, rules } = buildClassSheet({ title: "综合测评成绩明细表", batchLabel: "第 1 次发布", scheme, students });
  expect(shown(detail.rows[0][0])).toBe("综合测评成绩明细表");
  expect(shown(detail.rows[1][0])).toContain("第 1 次发布");
  expect(shown(detail.rows[1][0])).toContain("黄色单元格为录入项");
  expect(shown(detail.rows[1][0])).toContain("白色单元格由公式自动计算");

  const headers = headerRows(detail).map((row) => row.map(shown));
  expect(headers).toHaveLength(3);
  expect(headers[0]).toContain("学业成绩");
  expect(headers[0]).toContain("活动与成果（不超过50分，原始满分100分折算为20分）");
  expect(headers[0]).toContain("活动与成果×30%");
  expect(headers[0]).toContain("扣分前总分");
  expect(headers[0]).toContain("扣分项");
  expect(headers[0]).toContain("结果与确认");
  expect(headers[1]).toContain("必修课（不超过100分，最低60分）");
  expect(headers[1]).toContain("学业成绩实际分合计");
  expect(headers[1]).toContain("学业成绩×70%");
  expect(headers[1]).toContain("纪律扣分（登记值）");
  expect(headers[1]).toContain("扣分合计（已乘扣分系数）");
  expect(headers[1]).toContain("必填项状态");
  expect(headers[1]).toContain("综合测评总分（扣分后）");
  expect(headers[0].slice(0, 3)).toEqual(["序号", "姓名", "学号"]);

  const text = headerTexts(detail).join("|");
  expect(text).not.toContain("得分");
  expect(text).not.toContain("原始分");
  expect(text).not.toContain("封顶");
  expect(text).not.toContain("计入分");
  expect(text).not.toContain("计分方式");
  expect(rules.columns.map((column) => column.header)).toEqual([
    "名称",
    "项目类型",
    "所属上级",
    "合计上限（封顶）",
    "原始满分",
    "折算满分",
    "合计最低分",
    "权重（乘数）",
    "扣分系数",
    "必填项",
  ]);
  expect(shown(rules.rows.at(-3)?.[0])).toContain("不含计算公式");
  expect(shown(rules.rows.at(-2)?.[0])).toContain("权重汇总项");
  expect(shown(rules.rows.at(-2)?.[0])).toContain("100%");

  expect(detail.merges).toContain("D3:F3");
  expect(detail.merges).toContain("D4:D5");
  expect(detail.merges).toContain("E4:E5");
  expect(detail.merges).toContain("F4:F5");
  expect(detail.merges).toContain("G3:G5");
  expect(detail.merges).toContain("H3:H5");
  expect(detail.merges).toContain("A3:A5");
  expect(detail.freezeRows).toBe(5);
  expect(detail.rows).toHaveLength(7);
  expect(shown(detail.rows[5][0])).toBe("1");
  expect(shown(detail.rows[6][0])).toBe("2");
  expect(rules.name).toBe("评分规则");
  expect(detail.protected).toBeFalsy();
  expect(buildWorkbook(detail).subarray(0, 2).toString()).toBe("PK");
  expect(buildMultiSheetWorkbook([detail, rules]).subarray(0, 2).toString()).toBe("PK");
});

test("班级表公式真实求值：各项合计、比例分、扣分前合计与总分联动", () => {
  const { detail, rules } = buildClassSheet({ title: "综合测评成绩明细表", batchLabel: "第 1 次发布", scheme, students });
  const totalColumn = columnOf(detail, "综合测评总分（扣分后）");
  const statusColumn = columnOf(detail, "必填项状态");
  const gradeColumn = columnOf(detail, "必修课");
  const activityColumn = columnOf(detail, "活动与成果");
  const subtotalColumn = columnOf(detail, "学业成绩实际分合计");
  const preTotalColumn = columnOf(detail, "扣分前总分");
  const deductionTotalColumn = columnOf(detail, "扣分合计（已乘扣分系数）");
  const totalRow = detail.rows[dataRow(detail)];
  const row = dataRow(detail) + 1;
  const address = (column: number) => `${columnLetters(column)}${row}`;

  // 所有计算列都是公式，不存在只写死数值的计算单元格。
  for (const [label, column] of [
    ["学业成绩实际分合计", subtotalColumn],
    ["扣分前总分", preTotalColumn],
    ["扣分合计", deductionTotalColumn],
    ["综合测评总分（扣分后）", totalColumn],
  ] as const) {
    expect((totalRow[column] as FormulaCell).formula, `${label}缺少公式`).toBeTruthy();
  }
  expect((totalRow[subtotalColumn] as FormulaCell).formula).toContain("评分规则");
  expect((totalRow[deductionTotalColumn] as FormulaCell).formula).toContain("评分规则");
  expect((totalRow[columnOf(detail, "学业成绩×70%")] as FormulaCell).formula).toContain("评分规则");

  let workbook = evaluateWorkbook([detail, rules]);
  expect(workbook.cell(address(subtotalColumn), "成绩明细")).toBe(82);
  expect(workbook.cell(address(preTotalColumn), "成绩明细")).toBeCloseTo(60.4, 10);
  expect(workbook.cell(address(deductionTotalColumn), "成绩明细")).toBe(6);
  expect(workbook.cell(address(totalColumn), "成绩明细")).toBeCloseTo(60.4, 10);
  expect(workbook.cell(address(statusColumn), "成绩明细")).toBe("必填齐全");

  const totalCell = totalRow[totalColumn] as FormulaCell;
  expect(totalCell.cached).toBeCloseTo(60.4, 6);
  expect(typeof (totalRow[gradeColumn] as { value: number }).value).toBe("number");
  expect((totalRow[gradeColumn] as { value: number }).value).toBe(88);
  expect((totalRow[activityColumn] as { value: number }).value).toBe(60);

  // 修改得分后，公式重算而不是沿用缓存值。
  detail.rows[dataRow(detail)][gradeColumn] = { value: 100, style: "input" };
  workbook = evaluateWorkbook([detail, rules]);
  expect(workbook.cell(address(totalColumn), "成绩明细")).toBeCloseTo(68.8, 10);

  // 修改“评分规则”中的权重后，比例列、扣分前合计与总分同步变化；权重调整后仍保持合计 100%。
  detail.rows[dataRow(detail)][gradeColumn] = { value: 88, style: "input" };
  const academicRuleRow = rules.rows.findIndex((cells) => shown(cells[0]) === "学业成绩");
  const activityRuleRow = rules.rows.findIndex((cells) => shown(cells[0]) === "活动与成果");
  expect(academicRuleRow).toBeGreaterThanOrEqual(0);
  expect(activityRuleRow).toBeGreaterThanOrEqual(0);
  rules.rows[academicRuleRow][7] = { value: 0.5, style: "input" };
  rules.rows[activityRuleRow][7] = { value: 0.5, style: "input" };
  workbook = evaluateWorkbook([detail, rules]);
  expect(workbook.cell(address(totalColumn), "成绩明细")).toBeCloseTo(46, 10);
});

test("必填项缺失以 0 填写并标记必填缺项，明确零分仍按零分计算", () => {
  const strict: Scheme = {
    nodes: [
      nodeSchema.parse({ id: "total", parentId: null, name: "总分", kind: "SUM", order: 0 }),
      nodeSchema.parse({ id: "grade", parentId: "total", name: "学业成绩", kind: "GRADE", required: true, maximum: "100", order: 0 }),
      nodeSchema.parse({ id: "activity", parentId: "total", name: "活动成果", kind: "ACTIVITY", maximum: "100", order: 1 }),
    ],
    deductions: [],
  };
  const { detail, rules } = buildClassSheet({
    title: "缺录核对",
    batchLabel: "未发布 · 录入阶段",
    scheme: strict,
    students: [
      { login: "zero", name: "零分", studentNumber: "01", values: { grade: "0", activity: "0" }, deductions: {} },
      { login: "missing", name: "缺录", studentNumber: "02", values: { activity: "0" }, deductions: {} },
    ],
  });
  const totalColumn = columnOf(detail, "综合测评总分（扣分后）");
  const statusColumn = columnOf(detail, "必填项状态");
  const gradeColumn = columnOf(detail, "学业成绩");
  const workbook = evaluateWorkbook([detail, rules]);
  const row = dataRow(detail) + 1;

  expect(workbook.cell(`${columnLetters(totalColumn)}${row}`, "成绩明细")).toBe(0);
  expect(workbook.cell(`${columnLetters(statusColumn)}${row}`, "成绩明细")).toBe("必填齐全");
  expect(workbook.cell(`${columnLetters(totalColumn)}${row + 1}`, "成绩明细")).toBe(0);
  expect(workbook.cell(`${columnLetters(statusColumn)}${row + 1}`, "成绩明细")).toBe("必填缺项");
  expect((detail.rows[dataRow(detail) + 1][gradeColumn] as { value: unknown }).value).toBe(0);
  expect((detail.rows[dataRow(detail) + 1][totalColumn] as FormulaCell).cached).toBe(0);
  expect(headerTexts(detail).join("|")).not.toContain("原始分");
});

test("根节点为单一输入项时，表头、扣分和总分仍完整生成", () => {
  const single: Scheme = {
    nodes: [nodeSchema.parse({ id: "total", parentId: null, name: "综合成绩", kind: "GRADE", order: 0, required: true, cap: "90" })],
    deductions: [{ id: "punish", nodeId: "total", name: "违纪扣分", coefficient: "2" }],
  };
  const student: ClassStudent = { login: "single", name: "单项", studentNumber: "single", values: { total: "95" }, deductions: { punish: "1" } };
  const { detail, rules } = buildClassSheet({ title: "单项成绩明细表", batchLabel: "未发布 · 录入阶段", scheme: single, students: [student] });
  expect(headerRows(detail)).toHaveLength(2);
  expect(headerTexts(detail).join("|")).toContain("综合成绩（不超过90分）");
  expect(headerTexts(detail).join("|")).toContain("违纪扣分（登记值）");
  expect(headerTexts(detail).join("|")).toContain("扣分合计（已乘扣分系数）");
  expect(headerTexts(detail).join("|")).toContain("综合测评总分（扣分后）");
  expect(detail.print).toMatchObject({ orientation: "landscape", fitToWidth: 1, repeatRows: "1:4" });
  expect(detail.freezeColumns).toBe(3);

  const totalColumn = columnOf(detail, "综合测评总分（扣分后）");
  const workbook = evaluateWorkbook([detail, rules]);
  expect(workbook.cell(`${columnLetters(totalColumn)}5`, "成绩明细")).toBe(88);
  expect(classSheetValues({ scheme: single, student }).get("total")?.fixed()).toBe("88.00");
});

test("正式发布快照保留公式与规则表，并锁定输入与参数", () => {
  const strict: Scheme = {
    nodes: [
      nodeSchema.parse({ id: "total", parentId: null, name: "总分", kind: "SUM", order: 0 }),
      nodeSchema.parse({ id: "grade", parentId: "total", name: "学业成绩", kind: "GRADE", required: true, maximum: "100", order: 0 }),
      nodeSchema.parse({ id: "activity", parentId: "total", name: "活动成果", kind: "ACTIVITY", maximum: "100", order: 1 }),
    ],
    deductions: [{ id: "discipline", nodeId: "grade", name: "纪律扣分", coefficient: "2" }],
  };
  const { detail, rules } = buildClassSheet({
    title: "发布快照",
    termName: "2026 秋",
    batchLabel: "第 2 次发布（2026-10-22）· 正式发布快照",
    mode: "published",
    scheme: strict,
    students: [{ login: "missing", name: "缺录", studentNumber: "missing", values: { activity: "0" }, deductions: {} }],
  });
  const headerText = headerTexts(detail).join("|");
  expect(headerText).not.toContain("必填项状态");
  expect(headerText).toContain("综合测评总分（扣分后）");
  expect(headerText).toContain("扣分前总分");
  expect(shown(detail.rows[1][0])).toContain("正式发布快照");
  expect(shown(detail.rows[1][0])).toContain("录入内容已锁定");
  const gradeColumn = columnOf(detail, "学业成绩");
  const totalColumn = columnOf(detail, "综合测评总分（扣分后）");
  const preTotalColumn = columnOf(detail, "扣分前总分");
  const deductionColumn = columnOf(detail, "纪律扣分");
  const data = detail.rows[dataRow(detail)];
  expect((data[gradeColumn] as { value: number; style: string }).value).toBe(0);
  expect((data[gradeColumn] as { value: number; style: string }).style).toBe("inputReadonly");
  expect((data[deductionColumn] as { value: number; style: string }).style).toBe("inputReadonly");
  expect((data[preTotalColumn] as FormulaCell).formula).toBeTruthy();
  expect((data[totalColumn] as FormulaCell).formula).toBeTruthy();
  expect((data[totalColumn] as FormulaCell).cached).toBe(0);
  expect(detail.protected).toBe(true);
  expect(rules.protected).toBe(true);
  const deductionRuleRow = rules.rows.findIndex((cells) => shown(cells[0]) === "纪律扣分");
  expect(deductionRuleRow).toBeGreaterThanOrEqual(0);
  expect((rules.rows[deductionRuleRow][8] as { style: string }).style).toBe("inputReadonly");
  const workbook = evaluateWorkbook([detail, rules]);
  expect(workbook.cell(`${columnLetters(totalColumn)}${dataRow(detail) + 1}`, "成绩明细")).toBe(0);
  const files = buildMultiSheetWorkbook([detail, rules]);
  expect(files.subarray(0, 2).toString()).toBe("PK");
  expect(detail.print).toMatchObject({ orientation: "landscape", fitToWidth: 1, repeatRows: "1:4" });
  expect(detail.freezeColumns).toBe(3);
});


test("统一明细表包含学院、专业、班级列，并按学院、专业、班级、学号排序", () => {
  const unsorted: ClassStudent[] = [
    { login: "20260004", name: "张三", studentNumber: "20260004", college: "B学院", major: "B专业", className: "B班", values: { grade: "80", activity: "10" }, deductions: {} },
    { login: "20260002", name: "李四", studentNumber: "20260002", college: "A学院", major: "B专业", className: "B班", values: { grade: "90", activity: "20" }, deductions: {} },
    { login: "20260003", name: "王五", studentNumber: "20260003", college: "A学院", major: "A专业", className: "B班", values: { grade: "70", activity: "30" }, deductions: {} },
    { login: "20260001", name: "赵六", studentNumber: "20260001", college: "A学院", major: "A专业", className: "A班", values: { grade: "60", activity: "40" }, deductions: {} },
  ];
  const { detail } = buildClassSheet({
    title: "统一明细表",
    batchLabel: "未发布 · 录入阶段",
    scheme,
    showOrganization: true,
    students: unsorted,
  });
  expect(detail.freezeColumns).toBe(6);
  expect(detail.merges).toContain("A3:A5");
  expect(detail.merges).toContain("F3:F5");
  expect(detail.rows[2].slice(0, 6).map(shown)).toEqual(["序号", "姓名", "学号", "学院", "专业", "班级"]);
  const data = detail.rows.slice(detail.freezeRows).map((row) => row.slice(0, 6).map(shown));
  expect(data.map((row) => row[1])).toEqual(["赵六", "王五", "李四", "张三"]);
  expect(data.map((row) => row[3])).toEqual(["A学院", "A学院", "A学院", "B学院"]);
  expect(data.map((row) => row[4])).toEqual(["A专业", "A专业", "B专业", "B专业"]);
  expect(data.map((row) => row[5])).toEqual(["A班", "B班", "B班", "B班"]);
});

test("多级模块嵌套：大模块、子模块、得分项和每级比例分都有正确层级与公式", () => {
  const nested: Scheme = {
    nodes: [
      nodeSchema.parse({ id: "total", parentId: null, name: "综合素质测评", kind: "WEIGHTED", order: 0 }),
      nodeSchema.parse({ id: "base", parentId: "total", name: "基础性素质", kind: "WEIGHTED", order: 0, weight: "0.8" }),
      nodeSchema.parse({ id: "red", parentId: "base", name: "红色文化引领工程", kind: "SUM", order: 0, weight: "0.1", cap: "100" }),
      nodeSchema.parse({ id: "thought", parentId: "red", name: "思想引领活动", kind: "GRADE", order: 0, required: true, maximum: "100" }),
      nodeSchema.parse({ id: "training", parentId: "red", name: "培训学习经历", kind: "GRADE", order: 1, maximum: "100" }),
      nodeSchema.parse({ id: "academic", parentId: "base", name: "学业成绩", kind: "SUM", order: 1, weight: "0.8" }),
      nodeSchema.parse({ id: "course", parentId: "academic", name: "必修课", kind: "GRADE", order: 0, required: true, maximum: "100" }),
      nodeSchema.parse({ id: "sports", parentId: "base", name: "体育素质", kind: "SUM", order: 2, weight: "0.1" }),
      nodeSchema.parse({ id: "fitness", parentId: "sports", name: "体测成绩", kind: "GRADE", order: 0, required: true, maximum: "100" }),
      nodeSchema.parse({ id: "development", parentId: "total", name: "发展性素质", kind: "WEIGHTED", order: 1, weight: "0.2" }),
      nodeSchema.parse({ id: "volunteer", parentId: "development", name: "志愿服务实践工程", kind: "SUM", order: 0, weight: "0.5", cap: "30" }),
      nodeSchema.parse({ id: "practice", parentId: "volunteer", name: "社会实践", kind: "ACTIVITY", order: 0, maximum: "100" }),
      nodeSchema.parse({ id: "humanities", parentId: "development", name: "人文素质提升工程", kind: "SUM", order: 1, weight: "0.5", cap: "30" }),
      nodeSchema.parse({ id: "quality", parentId: "humanities", name: "人文素养", kind: "GRADE", order: 0, required: true, maximum: "100" }),
    ],
    deductions: [],
  };
  const nestedStudents: ClassStudent[] = [
    { login: "nested", name: "王五", studentNumber: "nested", values: { thought: "90", training: "80", course: "70", fitness: "60", practice: "20", quality: "80" }, deductions: {} },
  ];
  const { detail, rules } = buildClassSheet({ title: "多级模块成绩明细表", batchLabel: "第 1 次发布", scheme: nested, students: nestedStudents });
  const headers = headerRows(detail).map((row) => row.map(shown));
  expect(headers).toHaveLength(4);
  expect(headers[0]).toContain("基础性素质");
  expect(headers[0]).toContain("发展性素质");
  expect(headers[0]).not.toContain("基础性素质×80%");
  expect(headers[1]).toContain("红色文化引领工程（模块合计不超过100分）");
  expect(headers[1]).toContain("学业成绩");
  expect(headers[1]).toContain("体育素质");
  expect(headers[1]).toContain("基础性素质比例分合计");
  expect(headers[1]).toContain("基础性素质×80%");
  expect(headers[1]).toContain("发展性素质比例分合计");
  expect(headers[1]).toContain("发展性素质×20%");
  expect(headers[2]).toContain("思想引领活动");
  expect(headers[2]).toContain("培训学习经历");
  expect(headers[2]).toContain("红色文化引领工程实际分合计");
  expect(headers[2]).toContain("红色文化引领工程×10%");
  expect(headerTexts(detail).join("|")).not.toContain("得分");
  expect(headerTexts(detail).join("|")).not.toContain("原始分");
  expect(detail.merges).toContain("D3:O3");
  expect(detail.merges).toContain("D4:G4");
  expect(detail.merges).toContain("A3:A6");
  expect(detail.freezeRows).toBe(6);

  const totalColumn = columnOf(detail, "综合测评总分（扣分后）");
  const workbook = evaluateWorkbook([detail, rules]);
  const row = dataRow(detail) + 1;
  const expected = Number(calculate(nested, { values: nestedStudents[0].values, deductions: {} }).total);
  expect(workbook.cell(`${columnLetters(totalColumn)}${row}`, "成绩明细")).toBeCloseTo(expected, 10);
});

test("普通汇总大模块按比例分配时，子模块显示实际占比且汇总不重复计分", () => {
  const official: Scheme = {
    nodes: [
      nodeSchema.parse({ id: "total", parentId: null, name: "综合素质测评", kind: "WEIGHTED", order: 0 }),
      nodeSchema.parse({ id: "base", parentId: "total", name: "基础性素质", kind: "WEIGHTED", order: 0, weight: "0.8" }),
      nodeSchema.parse({ id: "red", parentId: "base", name: "红色文化引领工程", kind: "SUM", order: 0, weight: "0.1", cap: "100" }),
      nodeSchema.parse({ id: "thought", parentId: "red", name: "思想引领", kind: "GRADE", order: 0, required: true, maximum: "100" }),
      nodeSchema.parse({ id: "training", parentId: "red", name: "培训学习", kind: "GRADE", order: 1, maximum: "100" }),
      nodeSchema.parse({ id: "academic", parentId: "base", name: "学业成绩", kind: "SUM", order: 1, weight: "0.8" }),
      nodeSchema.parse({ id: "course", parentId: "academic", name: "必修课", kind: "GRADE", order: 0, required: true, maximum: "100" }),
      nodeSchema.parse({ id: "sports", parentId: "base", name: "体育素质", kind: "SUM", order: 2, weight: "0.1" }),
      nodeSchema.parse({ id: "fitness", parentId: "sports", name: "体测成绩", kind: "GRADE", order: 0, required: true, maximum: "100" }),
      nodeSchema.parse({ id: "development", parentId: "total", name: "发展性素质", kind: "SUM", order: 1, weight: "0.2" }),
      nodeSchema.parse({ id: "volunteer", parentId: "development", name: "志愿服务实践工程", kind: "SUM", order: 0, cap: "30" }),
      nodeSchema.parse({ id: "practice", parentId: "volunteer", name: "社会实践", kind: "ACTIVITY", order: 0 }),
      nodeSchema.parse({ id: "humanities", parentId: "development", name: "人文素质提升工程", kind: "SUM", order: 1, cap: "30" }),
      nodeSchema.parse({ id: "quality", parentId: "humanities", name: "人文素养", kind: "GRADE", order: 0, maximum: "100" }),
      nodeSchema.parse({ id: "innovation", parentId: "development", name: "创新实践工程", kind: "SUM", order: 2, cap: "20" }),
      nodeSchema.parse({ id: "research", parentId: "innovation", name: "科研训练", kind: "ACTIVITY", order: 0 }),
    ],
    deductions: [{ id: "discipline", nodeId: "total", name: "违纪扣分", coefficient: "1" }],
  };
  const student: ClassStudent = {
    login: "official",
    name: "赵六",
    studentNumber: "official",
    values: { thought: "90", training: "80", course: "85", fitness: "95", practice: "20", quality: "80", research: "15" },
    deductions: { discipline: "2" },
  };
  const { detail, rules } = buildClassSheet({ title: "综合素质测评成绩明细表", batchLabel: "未发布 · 录入阶段", scheme: official, students: [student] });
  const headers = headerRows(detail).map((row) => row.map(shown));
  expect(headers[0]).toContain("基础性素质");
  expect(headers[0]).toContain("发展性素质");
  expect(headers[0]).toContain("扣分前总分");
  expect(headers[1]).toContain("红色文化引领工程（模块合计不超过100分）");
  expect(headers[1]).toContain("学业成绩");
  expect(headers[1]).toContain("体育素质");
  expect(headers[1]).toContain("基础性素质比例分合计");
  expect(headers[1]).toContain("基础性素质×80%");
  expect(headers[1]).toContain("志愿服务实践工程（模块合计不超过30分）");
  expect(headers[1]).toContain("人文素质提升工程（模块合计不超过30分）");
  expect(headers[1]).toContain("创新实践工程（模块合计不超过20分）");
  expect(headers[1]).toContain("发展性素质实际分合计");
  expect(headers[1]).toContain("发展性素质×20%");

  const workbook = evaluateWorkbook([detail, rules]);
  const row = dataRow(detail) + 1;
  const value = (column: number) => workbook.cell(`${columnLetters(column)}${row}`, "成绩明细");
  // 实际分合计按模块树顺序：红土地、学业、体育、三项发展模块、发展性素质；
  // 基础性素质是按占比汇总，使用“比例分合计”。
  const subtotalColumns = columnsEndingWith(detail, "实际分合计");
  expect(subtotalColumns).toHaveLength(7);
  expect(subtotalColumns.map(value)).toEqual([100, 85, 95, 20, 30, 15, 65]);
  const ratioSubtotalColumns = columnsEndingWith(detail, "比例分合计");
  expect(ratioSubtotalColumns).toHaveLength(1);
  expect(value(ratioSubtotalColumns[0])).toBeCloseTo(87.5, 10);
  expect(value(columnOf(detail, "扣分前总分"))).toBeCloseTo(83, 10);
  expect(value(columnOf(detail, "扣分合计"))).toBe(2);
  expect(value(columnOf(detail, "综合测评总分（扣分后）"))).toBeCloseTo(81, 10);

  // 发展性素质是合计项，下级比例列展示同一 20% 占比的分配，不重复计分。
  const ratio20 = columnsEndingWith(detail, "×20%");
  expect(ratio20).toHaveLength(4);
  const ratioValues = ratio20.map(value);
  expect(ratioValues).toEqual([4, 6, 3, 13]);
  expect(ratioValues.slice(0, 3).reduce<number>((sum, item) => sum + Number(item), 0)).toBe(Number(ratioValues[3]));
  expect(Number(calculate(official, { values: student.values, deductions: student.deductions }).total)).toBeCloseTo(81, 10);
});

test("评分配置任意调整后，表头、比例、公式与结果仍按新配置生成", () => {
  const mutated: Scheme = {
    nodes: [
      nodeSchema.parse({ id: "total", parentId: null, name: "综合素质测评", kind: "WEIGHTED", order: 0 }),
      nodeSchema.parse({ id: "base", parentId: "total", name: "基础性素质", kind: "SUM", order: 0, weight: "0.6" }),
      nodeSchema.parse({ id: "red", parentId: "base", name: "红色文化引领工程", kind: "SUM", order: 0, weight: "0.1", cap: "100" }),
      nodeSchema.parse({ id: "thought", parentId: "red", name: "思想引领", kind: "GRADE", order: 0, required: true, maximum: "100" }),
      nodeSchema.parse({ id: "academic", parentId: "base", name: "学业成绩", kind: "SUM", order: 1, weight: "0.9" }),
      nodeSchema.parse({ id: "course", parentId: "academic", name: "必修课", kind: "GRADE", order: 0, required: true, maximum: "100" }),
      nodeSchema.parse({ id: "development", parentId: "total", name: "发展性素质", kind: "SUM", order: 1, weight: "0.3" }),
      nodeSchema.parse({ id: "volunteer", parentId: "development", name: "志愿服务实践工程", kind: "SUM", order: 0, cap: "40" }),
      nodeSchema.parse({ id: "practice", parentId: "volunteer", name: "社会实践", kind: "ACTIVITY", order: 0 }),
      nodeSchema.parse({ id: "innovation", parentId: "development", name: "创新实践工程", kind: "SUM", order: 1, cap: "20" }),
      nodeSchema.parse({ id: "research", parentId: "innovation", name: "科研训练", kind: "ACTIVITY", order: 0 }),
      nodeSchema.parse({ id: "competition", parentId: "development", name: "创新竞赛工程", kind: "SUM", order: 2, cap: "10" }),
      nodeSchema.parse({ id: "contest", parentId: "competition", name: "学科竞赛", kind: "ACTIVITY", order: 0 }),
      nodeSchema.parse({ id: "extra", parentId: "total", name: "额外成果", kind: "ACTIVITY", order: 2, weight: "0.1" }),
    ],
    deductions: [{ id: "discipline", nodeId: "total", name: "违纪扣分", coefficient: "1.5" }],
  };
  const student: ClassStudent = {
    login: "mutated",
    name: "孙七",
    studentNumber: "mutated",
    values: { thought: "95", course: "70", practice: "35", research: "18", contest: "8", extra: "10" },
    deductions: { discipline: "2" },
  };
  const { detail, rules } = buildClassSheet({ title: "调整后成绩明细表", batchLabel: "未发布 · 录入阶段", scheme: mutated, students: [student] });
  const headers = headerRows(detail).map((row) => row.map(shown));
  expect(headers[0]).toContain("基础性素质");
  expect(headers[0]).toContain("发展性素质");
  expect(headers[0]).toContain("额外成果");
  expect(headers[0]).toContain("额外成果×10%");
  expect(headers[1]).toContain("志愿服务实践工程（模块合计不超过40分）");
  expect(headers[1]).toContain("创新实践工程（模块合计不超过20分）");
  expect(headers[1]).toContain("创新竞赛工程（模块合计不超过10分）");
  expect(headers[1]).toContain("基础性素质实际分合计");
  expect(headers[1]).toContain("基础性素质×60%");
  expect(headers[1]).toContain("发展性素质实际分合计");
  expect(headers[1]).toContain("发展性素质×30%");
  expect(columnsEndingWith(detail, "×30%")).toHaveLength(4);
  expect(headerTexts(detail).join("|")).not.toContain("体育素质");

  const workbook = evaluateWorkbook([detail, rules]);
  const row = dataRow(detail) + 1;
  const total = workbook.cell(`${columnLetters(columnOf(detail, "综合测评总分（扣分后）"))}${row}`, "成绩明细");
  const expected = calculate(mutated, { values: student.values, deductions: student.deductions });
  expect(Number(expected.total)).toBeCloseTo(Number(total), 10);
  expect(Number(total)).toBeGreaterThan(0);
  expect(workbook.cell(`${columnLetters(columnOf(detail, "扣分合计（已乘扣分系数）"))}${row}`, "成绩明细")).toBe(3);
});
