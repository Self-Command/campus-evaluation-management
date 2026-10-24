import { expect, test } from "vitest";
import { schoolScheme } from "@/lib/scoring/template";
import { validateScheme } from "@/lib/scoring/validate";
import {
	applyQuickSettings,
	developmentCapTotal,
	quickSchemeLayout,
	quickSettingsIssues,
	schoolQuickSettings,
	settingsFromScheme,
} from "@/lib/scoring/quick-config";

test("学校模板完整映射为快速评分卡", () => {
	const scheme = schoolScheme();
	const layout = quickSchemeLayout(scheme);
	expect(layout).not.toBeNull();
	const settings = settingsFromScheme(layout!);
	expect(settings).toMatchObject({
		foundationWeight: "80",
		developmentWeight: "20",
		redCultureWeight: "10",
		redCultureCap: "100",
		academicWeight: "80",
		physicalWeight: "10",
		volunteeringCap: "30",
		humanitiesCap: "30",
		craftsmanshipCap: "40",
		deductionCoefficient: "100",
	});
	expect(developmentCapTotal(settings)).toBe("100");
	expect(quickSettingsIssues(layout!, settings)).toEqual([]);
});

test("快速调整只修改占比和最高分，保留稳定ID与高级规则", () => {
	const scheme = schoolScheme();
	const layout = quickSchemeLayout(scheme)!;
	const before = new Map(scheme.nodes.map((node) => [node.id, node]));
	const next = applyQuickSettings(scheme, layout, {
		...schoolQuickSettings(),
		foundationWeight: "70",
		developmentWeight: "30",
		redCultureWeight: "20",
		academicWeight: "70",
		physicalWeight: "10",
		volunteeringCap: "35",
		humanitiesCap: "30",
		craftsmanshipCap: "35",
		redCultureCap: "90",
		deductionCoefficient: "80",
	});
	expect(next.nodes.map((node) => node.id)).toEqual(
		scheme.nodes.map((node) => node.id),
	);
	expect(next.nodes.map((node) => node.parentId)).toEqual(
		scheme.nodes.map((node) => node.parentId),
	);
	expect(next.nodes.find((node) => node.id === "foundation")?.weight).toBe(
		"0.700000000000",
	);
	expect(next.nodes.find((node) => node.id === "red_culture")?.cap).toBe("90");
	expect(next.nodes.find((node) => node.id === "academic")?.name).toBe(
		before.get("academic")?.name,
	);
	expect(next.deductions[0].coefficient).toBe("0.800000000000");
	expect(() => validateScheme(next)).not.toThrow();
});

test("快速评分卡拒绝比例不完整、负数最高分和自定义结构", () => {
	const scheme = schoolScheme();
	const layout = quickSchemeLayout(scheme)!;
	const defaults = settingsFromScheme(layout);
	expect(
		quickSettingsIssues(layout, {
			...defaults,
			developmentWeight: "10",
		}),
	).toContain("基础性素质和发展性素质合计 90%，应等于 100%。");
	expect(
		quickSettingsIssues(layout, {
			...defaults,
			redCultureCap: "-1",
		}),
	).toContain("红色文化引领工程最高分不能为负数");
	expect(
		quickSettingsIssues(layout, {
			...defaults,
			academicWeight: "90",
		}),
	).toContain("红色文化、学业成绩、体育素质合计 110%，应等于 100%。");

	const custom = structuredClone(scheme);
	custom.nodes = custom.nodes.filter((node) => node.id !== "physical");
	expect(quickSchemeLayout(custom)).toBeNull();
});
