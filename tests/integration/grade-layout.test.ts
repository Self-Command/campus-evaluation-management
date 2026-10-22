import { expect, test } from "vitest";
import { gradeLayout } from "@/lib/xlsx/grade-layout";
import { nodeSchema } from "@/lib/scoring/types";

const scheme = {
  nodes: [
    nodeSchema.parse({ id: "total", parentId: null, name: "综合测评成绩", kind: "SUM", order: 0 }),
    nodeSchema.parse({ id: "academic", parentId: "total", name: "学业成绩", kind: "WEIGHTED", order: 0, weight: "1" }),
    nodeSchema.parse({ id: "grade", parentId: "academic", name: "必修课", kind: "GRADE", order: 0, weight: "0.6" }),
    nodeSchema.parse({ id: "grade2", parentId: "academic", name: "选修课", kind: "GRADE", order: 1, weight: "0.4" }),
    nodeSchema.parse({ id: "activity", parentId: "total", name: "活动与成果", kind: "ACTIVITY", order: 1 }),
  ],
  deductions: [],
};

test("模块树按前序展开，行列号从第 2 行起且父子关系完整", () => {
  const layout = gradeLayout(scheme);
  expect(layout.rows.map((row) => row.node.id)).toEqual(["total", "academic", "grade", "grade2", "activity"]);
  expect(layout.rows.map((row) => row.depth)).toEqual([0, 1, 2, 2, 1]);
  expect(layout.rows.map((row) => row.scoreRow)).toEqual([2, 3, 4, 5, 6]);
  expect(layout.rows.map((row) => row.paramRow)).toEqual([2, 3, 4, 5, 6]);
  const academic = layout.byId.get("academic")!;
  expect(academic.children.map((row) => row.node.id)).toEqual(["grade", "grade2"]);
  expect(layout.root.node.id).toBe("total");
});

test("同级顺序按 order，深层模块也有稳定的行列号", () => {
  const deeper = {
    nodes: [
      nodeSchema.parse({ id: "root", parentId: null, name: "总分", kind: "SUM", order: 0 }),
      nodeSchema.parse({ id: "b", parentId: "root", name: "第二", kind: "GRADE", order: 5 }),
      nodeSchema.parse({ id: "a", parentId: "root", name: "第一", kind: "ACTIVITY", order: 1 }),
    ],
    deductions: [],
  };
  const layout = gradeLayout(deeper);
  expect(layout.rows.map((row) => row.node.id)).toEqual(["root", "a", "b"]);
  expect(layout.rows[2].scoreRow).toBe(4);
});
