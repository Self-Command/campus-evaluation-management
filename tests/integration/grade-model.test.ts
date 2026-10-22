import { expect, test } from "vitest";
import { buildGradeSheets } from "@/lib/xlsx/grade-model";
import { nodeSchema } from "@/lib/scoring/types";
import { buildWorkbook } from "@/lib/xlsx/workbook";

const scheme = {
  nodes: [
    nodeSchema.parse({ id: "total", parentId: null, name: "综合测评成绩", kind: "SUM", order: 0 }),
    nodeSchema.parse({ id: "grade", parentId: "total", name: "学业成绩", kind: "GRADE", order: 0, weight: "0.7", cap: "100", floor: "60" }),
    nodeSchema.parse({ id: "activity", parentId: "total", name: "活动与成果", kind: "ACTIVITY", order: 1, weight: "0.3" }),
  ],
  deductions: [{ id: "discipline", nodeId: "grade", name: "纪律扣分", coefficient: "2" }],
};

test("生成的公式工作簿含输入、固定引用与派生公式", () => {
  const { score, params } = buildGradeSheets({
    termName: "2026 秋",
    schemeRevision: 3,
    batchLabel: "第 1 次发布",
    student: { login: "20260001", name: "张三", college: "经济学院", major: "经济学", className: "经济一班" },
    scheme,
    values: { grade: "88", activity: "12" },
    deductions: { discipline: "2" },
  });

  expect(score.rows).toHaveLength(4); // 表头 + 三个模块
  expect(score.columns[0].header).toContain("评分方案第 3 版");
  // 第 1 行是总分，第 2 行是学业成绩（叶子）
  const grade = score.rows[2];
  const formula = (cell: unknown) => (cell as { formula: string }).formula;
  expect(grade[2]).toBe(88);
  expect(formula(grade[3])).toContain('IF(C3="","",C3)');
  expect(formula(grade[4])).toContain("MIN(D3,B3)");
  expect(formula(grade[6])).toContain("F3");
  expect(formula(grade[7])).toContain("MAX(G3,E3)");
  expect(formula(score.rows[1][3])).toContain("SUM(H3,H4)");

  expect(params.rows).toHaveLength(5); // 表头 + 三个模块 + 一条扣分项目
  expect(params.rows[1][5]).toBe(0); // 总分无扣分
  expect(formula(params.rows[2][5])).toContain("SUM(F5)");
  expect(params.rows[3][5]).toBe(0);
  expect(params.rows[4][5]).toBe(2); // 扣分项目金额是输入
  expect(params.rows[4][6]).toBe(2); // 系数是输入
  expect(params.rows[2][6]).toBe(0.7); // 占上级权重

  expect(buildWorkbook(score).subarray(0, 2).toString()).toBe("PK");
});
