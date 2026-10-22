import { expect, test } from "vitest";
import { calculate } from "@/lib/scoring/calculate";
import { scoreTree } from "@/lib/scoring/score-tree";
import { nodeSchema, type Scheme } from "@/lib/scoring/types";

const scheme: Scheme = {
  nodes: [
    nodeSchema.parse({ id: "total", parentId: null, name: "综合测评成绩", kind: "WEIGHTED", order: 0 }),
    nodeSchema.parse({ id: "academic", parentId: "total", name: "学业成绩", kind: "SUM", order: 0, weight: "0.7" }),
    nodeSchema.parse({ id: "grade", parentId: "academic", name: "必修课", kind: "GRADE", order: 0, cap: "100", floor: "60", required: true }),
    nodeSchema.parse({ id: "activity", parentId: "total", name: "活动与成果", kind: "ACTIVITY", order: 1, weight: "0.3", cap: "50", normalize: true, rawMaximum: "100", targetMaximum: "20" }),
  ],
  deductions: [{ id: "discipline", nodeId: "grade", name: "纪律扣分", coefficient: "2" }],
};

test("scoreTree 的每个模块分值与 calculate() 完全一致", () => {
  const input = { values: { grade: "88", activity: "60" }, deductions: { discipline: "3" } };
  const expected = calculate(scheme, input);
  const actual = scoreTree(scheme, input);
  for (const detail of expected.details) {
    const mine = actual.get(detail.id);
    expect(mine, `缺少模块 ${detail.id}`).toBeTruthy();
    expect(mine!.value?.fixed(), `模块 ${detail.name} 不一致`).toBe(detail.score);
  }
});

test("叶子同时触发封顶、折算、扣分与最低分时仍与系统一致", () => {
  // 活动分 60 先封顶 50，再按 100→20 折算为 10；必修 88 封顶 100 后扣 3×2=6 → 82。
  const input = { values: { grade: "88", activity: "60" }, deductions: { discipline: "3" } };
  const expected = calculate(scheme, input);
  const actual = scoreTree(scheme, input);
  expect(actual.get("activity")!.value!.fixed()).toBe(expected.details.find((detail) => detail.id === "activity")!.score);
  expect(actual.get("activity")!.value!.fixed()).toBe("10.00");
  expect(actual.get("grade")!.value!.fixed()).toBe("82.00");
  // 总分 = 82×0.7 + 10×0.3 = 57.4 + 3 = 60.40
  expect(actual.get("total")!.value!.fixed()).toBe("60.40");
});

test("缺录的叶子不产生 0，父模块在无任何有效子项时为空", () => {
  const input = { values: {}, deductions: {} };
  const actual = scoreTree(scheme, input);
  expect(actual.get("grade")!.value).toBeNull();
  expect(actual.get("activity")!.value).toBeNull();
  expect(actual.get("total")!.value).toBeNull();
});
