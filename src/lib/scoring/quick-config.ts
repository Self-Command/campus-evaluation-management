import { Rational } from "./rational";
import { schoolScheme } from "./template";
import type { Scheme, ScoringNode } from "./types";

const HUNDRED = Rational.from("100");
const ZERO = Rational.from("0");

const IDS = {
	root: "total",
	foundation: "foundation",
	redCulture: "red_culture",
	academic: "academic",
	physical: "physical",
	development: "development",
	volunteering: "volunteering",
	humanities: "humanities",
	craftsmanship: "craftsmanship",
	deduction: "disciplinary_deduction",
} as const;

export type QuickSchemeSettings = {
	foundationWeight: string;
	developmentWeight: string;
	redCultureWeight: string;
	redCultureCap: string;
	academicWeight: string;
	physicalWeight: string;
	volunteeringCap: string;
	humanitiesCap: string;
	craftsmanshipCap: string;
	deductionCoefficient: string;
};

export type QuickSchemeLayout = {
	root: ScoringNode;
	foundation: ScoringNode;
	redCulture: ScoringNode;
	academic: ScoringNode;
	physical: ScoringNode;
	development: ScoringNode;
	volunteering: ScoringNode;
	humanities: ScoringNode;
	craftsmanship: ScoringNode;
	redCultureLeaves: ScoringNode[];
	volunteeringLeaves: ScoringNode[];
	humanitiesLeaves: ScoringNode[];
	craftsmanshipLeaves: ScoringNode[];
	deduction: Scheme["deductions"][number] | null;
};

function trimFixed(value: string) {
	const trimmed = value.replace(/\.?0+$/, "");
	return trimmed || "0";
}

export function percentageText(weight: string) {
	try {
		return trimFixed(Rational.from(weight).mul(HUNDRED).fixed(10));
	} catch {
		return "0";
	}
}

function childrenOf(scheme: Scheme, parentId: string) {
	return scheme.nodes
		.filter((node) => node.parentId === parentId)
		.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

function sameIds(nodes: ScoringNode[], ids: readonly string[]) {
	return (
		nodes.length === ids.length &&
		nodes.every((node) => ids.includes(node.id))
	);
}

/**
 * The quick card is intentionally limited to the school template's known shape.
 * Any custom structure stays in the advanced editor instead of being hidden or
 * silently overwritten.
 */
export function quickSchemeLayout(scheme: Scheme): QuickSchemeLayout | null {
	const byId = new Map(scheme.nodes.map((node) => [node.id, node]));
	const get = (id: string) => byId.get(id);
	const root = scheme.nodes.find((node) => node.parentId === null);
	const foundation = get(IDS.foundation);
	const redCulture = get(IDS.redCulture);
	const academic = get(IDS.academic);
	const physical = get(IDS.physical);
	const development = get(IDS.development);
	const volunteering = get(IDS.volunteering);
	const humanities = get(IDS.humanities);
	const craftsmanship = get(IDS.craftsmanship);
	if (
		!root ||
		root.id !== IDS.root ||
		root.kind !== "WEIGHTED" ||
		!foundation ||
		foundation.kind !== "WEIGHTED" ||
		foundation.parentId !== root.id ||
		!redCulture ||
		redCulture.kind !== "SUM" ||
		redCulture.parentId !== foundation.id ||
		!academic ||
		academic.kind !== "GRADE" ||
		academic.parentId !== foundation.id ||
		!physical ||
		physical.kind !== "GRADE" ||
		physical.parentId !== foundation.id ||
		!development ||
		development.kind !== "SUM" ||
		development.parentId !== root.id ||
		!volunteering ||
		volunteering.kind !== "SUM" ||
		volunteering.parentId !== development.id ||
		!humanities ||
		humanities.kind !== "SUM" ||
		humanities.parentId !== development.id ||
		!craftsmanship ||
		craftsmanship.kind !== "SUM" ||
		craftsmanship.parentId !== development.id
	)
		return null;

	if (
		!sameIds(childrenOf(scheme, root.id), [
			IDS.foundation,
			IDS.development,
		]) ||
		!sameIds(childrenOf(scheme, foundation.id), [
			IDS.redCulture,
			IDS.academic,
			IDS.physical,
		]) ||
		!sameIds(childrenOf(scheme, development.id), [
			IDS.volunteering,
			IDS.humanities,
			IDS.craftsmanship,
		])
	)
		return null;

	const deduction =
		scheme.deductions.find(
			(item) => item.id === IDS.deduction && item.nodeId === root.id,
		) ?? null;
	// Do not hide extra deduction projects in the quick card.
	if (scheme.deductions.length > (deduction ? 1 : 0)) return null;

	const redCultureLeaves = childrenOf(scheme, redCulture.id);
	if (redCultureLeaves.length === 0) return null;
	if (
		!redCultureLeaves.every((node) =>
			["ACTIVITY", "GRADE"].includes(node.kind),
		)
	)
		return null;
	for (const project of [volunteering, humanities, craftsmanship]) {
		const leaves = childrenOf(scheme, project.id);
		if (
			leaves.length === 0 ||
			!leaves.every((node) => ["ACTIVITY", "GRADE"].includes(node.kind))
		)
			return null;
	}

	return {
		root,
		foundation,
		redCulture,
		academic,
		physical,
		development,
		volunteering,
		humanities,
		craftsmanship,
		redCultureLeaves,
		volunteeringLeaves: childrenOf(scheme, volunteering.id),
		humanitiesLeaves: childrenOf(scheme, humanities.id),
		craftsmanshipLeaves: childrenOf(scheme, craftsmanship.id),
		deduction,
	};
}

export function settingsFromScheme(layout: QuickSchemeLayout): QuickSchemeSettings {
	return {
		foundationWeight: percentageText(layout.foundation.weight),
		developmentWeight: percentageText(layout.development.weight),
		redCultureWeight: percentageText(layout.redCulture.weight),
		redCultureCap: layout.redCulture.cap ?? "",
		academicWeight: percentageText(layout.academic.weight),
		physicalWeight: percentageText(layout.physical.weight),
		volunteeringCap: layout.volunteering.cap ?? "",
		humanitiesCap: layout.humanities.cap ?? "",
		craftsmanshipCap: layout.craftsmanship.cap ?? "",
		deductionCoefficient: layout.deduction
			? percentageText(layout.deduction.coefficient)
			: "",
	};
}

export function schoolQuickSettings() {
	const layout = quickSchemeLayout(schoolScheme());
	if (!layout) throw new Error("学校评分模板结构不完整");
	return settingsFromScheme(layout);
}

function parsePercent(value: string, label: string) {
	const text = value.trim();
	if (!text) throw new Error(`${label}不能为空`);
	const parsed = Rational.from(text);
	if (parsed.compare(ZERO) < 0 || parsed.compare(HUNDRED) > 0)
		throw new Error(`${label}需在 0 到 100 之间`);
	return parsed;
}

function parseCap(value: string, label: string) {
	const text = value.trim();
	if (!text) return null;
	const parsed = Rational.from(text);
	if (parsed.compare(ZERO) < 0) throw new Error(`${label}不能为负数`);
	return text;
}

function percentWeight(value: string, label: string) {
	return parsePercent(value, label).div(HUNDRED).fixed(12);
}

/** Only the values shown on the quick card change; IDs and advanced rules stay intact. */
export function applyQuickSettings(
	scheme: Scheme,
	layout: QuickSchemeLayout,
	settings: QuickSchemeSettings,
): Scheme {
	const weights = new Map<string, string>([
		[layout.foundation.id, percentWeight(settings.foundationWeight, "基础性素质占比")],
		[layout.development.id, percentWeight(settings.developmentWeight, "发展性素质占比")],
		[layout.redCulture.id, percentWeight(settings.redCultureWeight, "红色文化引领工程占比")],
		[layout.academic.id, percentWeight(settings.academicWeight, "学业成绩占比")],
		[layout.physical.id, percentWeight(settings.physicalWeight, "体育素质占比")],
	]);
	const caps = new Map<string, string | null>([
		[layout.redCulture.id, parseCap(settings.redCultureCap, "红色文化引领工程最高分")],
		[layout.volunteering.id, parseCap(settings.volunteeringCap, "志愿服务实践工程最高分")],
		[layout.humanities.id, parseCap(settings.humanitiesCap, "人文素质提升工程最高分")],
		[layout.craftsmanship.id, parseCap(settings.craftsmanshipCap, "卓越工匠培养工程最高分")],
	]);
	const deductionCoefficient = layout.deduction
		? percentWeight(settings.deductionCoefficient, "扣分比例")
		: null;

	return {
		...scheme,
		nodes: scheme.nodes.map((node) => {
			const weight = weights.get(node.id);
			const cap = caps.get(node.id);
			return {
				...node,
				...(weight ? { weight } : {}),
				...(caps.has(node.id) ? { cap: cap ?? null } : {}),
			};
		}),
		deductions: scheme.deductions.map((item) =>
			layout.deduction && item.id === layout.deduction.id
				? { ...item, coefficient: deductionCoefficient! }
				: item,
		),
	};
}

export function quickSettingsIssues(
	layout: QuickSchemeLayout,
	settings: QuickSchemeSettings,
) {
	const issues: string[] = [];
	const percent = (value: string, label: string) => {
		try {
			return parsePercent(value, label);
		} catch (error) {
			issues.push((error as Error).message);
			return null;
		}
	};
	const cap = (value: string, label: string) => {
		try {
			return parseCap(value, label);
		} catch (error) {
			issues.push((error as Error).message);
			return null;
		}
	};

	const foundation = percent(settings.foundationWeight, "基础性素质占比");
	const development = percent(settings.developmentWeight, "发展性素质占比");
	const redCulture = percent(settings.redCultureWeight, "红色文化引领工程占比");
	const academic = percent(settings.academicWeight, "学业成绩占比");
	const physical = percent(settings.physicalWeight, "体育素质占比");
	if (
		foundation &&
		development &&
		foundation.add(development).compare(HUNDRED) !== 0
	)
		issues.push(
			`基础性素质和发展性素质合计 ${trimFixed(foundation.add(development).fixed(10))}%，应等于 100%。`,
		);
	if (
		redCulture &&
		academic &&
		physical &&
		redCulture.add(academic).add(physical).compare(HUNDRED) !== 0
	)
		issues.push(
			`红色文化、学业成绩、体育素质合计 ${trimFixed(redCulture.add(academic).add(physical).fixed(10))}%，应等于 100%。`,
		);

	cap(settings.redCultureCap, "红色文化引领工程最高分");
	cap(settings.volunteeringCap, "志愿服务实践工程最高分");
	cap(settings.humanitiesCap, "人文素质提升工程最高分");
	cap(settings.craftsmanshipCap, "卓越工匠培养工程最高分");
	if (layout.deduction)
		percent(settings.deductionCoefficient, "扣分比例");

	return issues;
}

export function developmentCapTotal(settings: QuickSchemeSettings) {
	const values = [
		settings.volunteeringCap,
		settings.humanitiesCap,
		settings.craftsmanshipCap,
	];
	if (values.some((value) => !value.trim())) return null;
	try {
		return trimFixed(
			values
				.map((value) => Rational.from(value.trim()))
				.reduce((sum, value) => sum.add(value), ZERO)
				.fixed(10),
		);
	} catch {
		return null;
	}
}
