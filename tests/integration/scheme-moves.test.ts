import { expect, test } from "vitest";
import { moveSchemeNode, schemeConfigurationIssues } from "@/lib/scoring/scheme-operations";
import { nodeSchema, type Scheme } from "@/lib/scoring/types";
import { calculate } from "@/lib/scoring/calculate";
import { validateScheme } from "@/lib/scoring/validate";

const scheme: Scheme = { nodes: [
  nodeSchema.parse({ id: "total", parentId: null, name: "总分", kind: "SUM", order: 0 }),
  nodeSchema.parse({ id: "A", parentId: "total", name: "大模块A", kind: "SUM", order: 0 }),
  nodeSchema.parse({ id: "B", parentId: "total", name: "大模块B", kind: "SUM", order: 1 }),
  nodeSchema.parse({ id: "a", parentId: "A", name: "A成绩", kind: "GRADE", order: 0, required: true }),
  nodeSchema.parse({ id: "b", parentId: "B", name: "B活动", kind: "ACTIVITY", order: 0 }),
], deductions: [] };
test("跨父级移动带走所有子级，稳定ID规则和原始数据不变，直接累加结果一致", () => {
  const baseline = structuredClone(scheme), input = { values: { a: "80", b: "4" }, deductions: {} };
  const moved = moveSchemeNode(scheme, "A", "B", "inside");
  expect(moved.nodes.find(node => node.id === "A")?.parentId).toBe("B");
  expect(moved.nodes.find(node => node.id === "a")?.parentId).toBe("A");
  expect(moved.nodes.map(node => node.id).sort()).toEqual(scheme.nodes.map(node => node.id).sort());
  expect(calculate(moved, input).total).toBe(calculate(scheme, input).total);
  expect(scheme).toEqual(baseline);
  const raised = moveSchemeNode(moved, "A", "B", "before");
  expect(raised.nodes.find(node => node.id === "A")?.parentId).toBe("total");
  expect(raised.nodes.find(node => node.id === "A")!.order).toBeLessThan(raised.nodes.find(node => node.id === "B")!.order);
});
test("拒绝根移动、自身和后代挂接及输入父级，不能制造循环或第二根", () => {
  expect(() => moveSchemeNode(scheme, "total", "B", "inside")).toThrow("不能移动");
  expect(() => moveSchemeNode(scheme, "A", "a", "inside")).toThrow("下级");
  expect(() => moveSchemeNode(scheme, "A", "A", "after")).toThrow("自身");
  expect(() => moveSchemeNode(scheme, "a", "b", "inside")).toThrow("汇总模块");
  expect(() => moveSchemeNode(scheme, "A", "total", "after")).toThrow("综合总分");
});
test("移动不自动修改比例；未补齐比例或空汇总时定位并阻止保存，原始0与缺失语义保留", () => {
  const weighted = structuredClone(scheme);
  weighted.nodes[0].kind = "WEIGHTED"; weighted.nodes[1].weight = "0.6"; weighted.nodes[2].weight = "0.4";
  const moved = moveSchemeNode(weighted, "A", "B", "inside");
  expect(moved.nodes.find(node => node.id === "A")!.weight).toBe("0.6");
  expect(moved.nodes.find(node => node.id === "B")!.weight).toBe("0.4");
  expect(schemeConfigurationIssues(moved).total.length).toBeGreaterThan(0);
  expect(() => validateScheme(moved)).toThrow("100%");
  const empty = moveSchemeNode(scheme, "a", "B", "inside");
  expect(schemeConfigurationIssues(empty).A.length).toBeGreaterThan(0);
  expect(() => validateScheme(empty)).toThrow("下级");
  expect(calculate(scheme, { values: { a: "0" }, deductions: {} }).complete).toBe(true);
  expect(calculate(scheme, { values: {}, deductions: {} }).complete).toBe(false);
});
