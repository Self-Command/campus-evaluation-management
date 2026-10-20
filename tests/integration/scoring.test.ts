import { expect, test } from "vitest";
import { calculate } from "@/lib/scoring/calculate";
import { validateScheme } from "@/lib/scoring/validate";
import { schoolScheme } from "@/lib/scoring/template";
import { nodeSchema } from "@/lib/scoring/types";
import { Rational } from "@/lib/scoring/rational";
const school = schoolScheme();
const score = (values: Record<string, string>, deductions: Record<string, string> = {}) => calculate(school, { values: { academic: "0", physical: "0", ...values }, deductions });
test("学校固定边界与完整性", () => {
  expect(score({}).total).toBe("0.00");
  expect(score({ social_practice: "10" }).total).toBe("2.00");
  expect(score({ social_practice: "50" }).total).toBe("6.00");
  expect(score({ basic_literacy: "50" }).total).toBe("6.00");
  expect(score({ professional: "50" }).total).toBe("8.00");
  expect(score({ ideology: "150" }).total).toBe("8.00");
  expect(score({}, { disciplinary_deduction: "5" }).total).toBe("-5.00");
  const full = { academic: "100", physical: "100", ideology: "100", social_practice: "30", basic_literacy: "30", professional: "40" };
  expect(score(full).total).toBe("100.00");
  expect(score(full, { disciplinary_deduction: "3" }).total).toBe("97.00");
  expect(score({ academic: "90", physical: "70", ideology: "80", social_practice: "18", basic_literacy: "24", professional: "20" }).total).toBe("82.00");
  const missing = calculate(school, { values: {}, deductions: {} });
  expect(missing.total).toBeNull(); expect(missing.missing.map(v => v.id).sort()).toEqual(["academic", "physical"]);
});
test("1000组独立整数控制公式对照", () => {
  let seed = 123456789;
  const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % 201; };
  for (let i = 0; i < 1000; i++) {
    const red = next(), academic = next() % 101, physical = next() % 101;
    const volunteer = next(), humanities = next(), craft = next(), deduction = next() % 10;
    const cents = Math.min(red, 100) * 8 + academic * 64 + physical * 8 + (Math.min(volunteer, 30) + Math.min(humanities, 30) + Math.min(craft, 40)) * 20 - deduction * 100;
    expect(score({ ideology: String(red), academic: String(academic), physical: String(physical), social_practice: String(volunteer), basic_literacy: String(humanities), professional: String(craft) }, { disciplinary_deduction: String(deduction) }).total).toBe((cents / 100).toFixed(2));
  }
});
test("另一配置遵循封顶折算扣分下限顺序，中间精确", () => {
  const scheme = { nodes: [nodeSchema.parse({ id: "root", parentId: null, name: "任意学校", order: 0, kind: "GRADE", normalize: true, cap: "3", rawMaximum: "3", targetMaximum: "10", maximum: "100", floor: "1" })], deductions: [{ id: "d", name: "扣分", nodeId: "root", coefficient: "2" }] };
  expect(calculate(scheme, { values: { root: "6" }, deductions: { d: "1" } }).total).toBe("8.00");
  expect(calculate(scheme, { values: { root: "1" }, deductions: { d: "0" } }).total).toBe("3.33");
  expect(calculate(scheme, { values: { root: "0" }, deductions: { d: "5" } }).total).toBe("1.00");
  expect(Rational.from("1.005").fixed()).toBe("1.01");
  expect(Rational.from("-1.005").fixed()).toBe("-1.01");
  expect(Rational.from("1").div(Rational.from("3")).mul(Rational.from("3")).fixed(12)).toBe("1.000000000000");
});
test("1500层迭代计算与结构、输入错误拒绝", () => {
  const nodes = Array.from({ length: 1500 }, (_, i) => nodeSchema.parse({ id: String(i), parentId: i ? String(i - 1) : null, name: `模块${i}`, order: 0, kind: i === 1499 ? "GRADE" : "SUM" }));
  expect(calculate({ nodes, deductions: [] }, { values: { "1499": "42" }, deductions: {} }).total).toBe("42.00");
  const invalid = structuredClone(school); invalid.nodes.find(n => n.id === "academic")!.weight = "0.7";
  expect(() => validateScheme(invalid)).toThrow("100%");
  const cycle = structuredClone(school); cycle.nodes.find(n => n.id === "foundation")!.parentId = "red_culture";
  expect(() => validateScheme(cycle)).toThrow();
  expect(() => score({ academic: "101" })).toThrow("范围");
  expect(() => score({ total: "1" })).toThrow("目标无效");
});
