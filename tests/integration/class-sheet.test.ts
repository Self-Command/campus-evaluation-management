import { expect, test } from "vitest";
import { calculate } from "@/lib/scoring/calculate";
import { scoreTree } from "@/lib/scoring/score-tree";
import { nodeSchema, type Scheme } from "@/lib/scoring/types";
import { buildClassSheet, classSheetValues, type ClassStudent } from "@/lib/xlsx/class-sheet";
import { buildWorkbook } from "@/lib/xlsx/workbook";

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

test("班级表结构：分组表头、序号姓名学号、每模块一列、末尾合计与签字", () => {
  const sheet = buildClassSheet({ title: "综合测评成绩明细表", batchLabel: "第 1 次发布", scheme, students });
  expect(sheet.rows[0].slice(0, 3)).toEqual(["", "", ""]);
  expect(sheet.rows[0]).toContain("学业成绩×70%");
  expect(sheet.rows[1].slice(0, 3)).toEqual(["序号", "姓名", "学号"]);
  expect(sheet.rows[1].at(-2)).toBe("合计");
  expect(sheet.rows[1].at(-1)).toBe("学生本人签字确认");
  // 明细列头内联占比与上限，不暴露内部术语
  expect(String(sheet.rows[1][5])).toContain("不超过 100 分");
  expect(String(sheet.rows[1][6])).toContain("折算为");
  expect(JSON.stringify(sheet.rows[1])).not.toContain("封顶");
  // 两名学生各一行，序号连续
  expect(sheet.rows).toHaveLength(4);
  expect(sheet.rows[2][0]).toBe(1);
  expect(sheet.rows[3][0]).toBe(2);
  expect(buildWorkbook(sheet).subarray(0, 2).toString()).toBe("PK");
});
