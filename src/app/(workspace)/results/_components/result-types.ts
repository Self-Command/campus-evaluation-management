export type NodeKind = "SUM" | "WEIGHTED" | "ACTIVITY" | "GRADE";

export type NodeResult = {
	id: string;
	name: string;
	parentId: string | null;
	kind?: NodeKind;
	weight?: string;
	order?: number;
	complete: boolean;
	gross?: string;
	capped?: string;
	normalized?: string;
	deduction?: string;
	beforeFloor?: string;
	score?: string;
	parentContribution: string;
	normalization?: { rawMaximum: string | null; targetMaximum: string | null } | null;
};

export type EvidenceFile = { id: string; name: string };

export type Participation = {
	id: string;
	activityId: string;
	name: string;
	nodeId?: string;
	points: string;
	approvedSourceCount?: number;
	activityDate?: string;
	approvedAt?: string;
	sources?: {
		id: string;
		reviewReason?: string | null;
		evidence: { evidenceId: string; name?: string }[];
	}[];
	activityEvidence?: EvidenceFile[];
};

export type Claim = {
	id: string;
	activityId?: string | null;
	name: string;
	nodeId?: string;
	points: string;
	occurredOn?: string;
	reviewedAt?: string | null;
	scoredAt?: string | null;
	note?: string | null;
	reviewReason?: string | null;
	evidenceIds?: string[];
	evidenceFiles?: EvidenceFile[];
};

export type Grade = {
	id: string;
	nodeId: string;
	name: string;
	value: string;
	revision: number;
	updatedAt?: string;
};

export type Deduction = {
	id: string;
	name: string;
	nodeName: string;
	amount: string;
	coefficient: string;
	applied?: string;
	reason: string;
	revision?: number;
	updatedAt?: string;
};

export type ResultData = {
	term: {
		id: string;
		name: string;
		phase: string;
		revision: number;
		inputRevision: number;
	};
	student: {
		id: string;
		name: string;
		login: string;
		profile?: { college: string; major: string; className: string };
	};
	result: {
		total: string | null;
		provisionalTotal: string;
		complete: boolean;
		missing: { id: string; name: string }[];
		details: NodeResult[];
	};
	participations: Participation[];
	claims?: Claim[];
	grades?: Grade[];
	deductions: Deduction[];
	publication?: {
		id: string;
		sequence: number;
		publishedAt: string;
		checkingEndsAt: string;
		requireConfirmation: boolean;
	};
	resultHash?: string;
	confirmation?: { confirmedAt?: string; createdAt?: string } | null;
	rank?: number | null;
	population?: number;
};

export type ScoreTree = {
	details: NodeResult[];
	byId: Map<string, NodeResult>;
	childrenOf: Map<string, NodeResult[]>;
	roots: NodeResult[];
	root?: NodeResult;
	topLevel: NodeResult[];
};

export type ResultExplanation = {
	lead: string;
	parts: { name: string; value: string; missing: boolean }[];
	steps: string[];
	relation: string;
};

function stageDiffers(a?: string, b?: string) {
	if (a === undefined || b === undefined) return false;
	return Math.abs(Number(a) - Number(b)) > 1e-9;
}

export function scoreText(value?: string | null) {
	if (value === undefined || value === null || value === "") return "—";
	const number = Number(value);
	return Number.isFinite(number) ? number.toFixed(2) : "—";
}

export function percentText(weight?: string) {
	const number = Number(weight);
	if (!Number.isFinite(number)) return "—";
	const percent = number * 100;
	return Number.isInteger(percent)
		? String(percent)
		: percent.toFixed(2).replace(/\.?0+$/, "");
}

export function dayText(value?: string | null) {
	if (!value) return "";
	if (/^\d{4}-\d{2}(-\d{2})?$/.test(value)) return value;
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return new Intl.DateTimeFormat("zh-CN", {
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(date);
}

export function nodeDescription(node: NodeResult, childCount: number) {
	if (!node.complete) return "还有成绩未录入";
	if (node.kind === "GRADE") return "辅导员录入、学院审核的成绩";
	if (node.kind === "ACTIVITY") return "已通过审核的活动和成果";
	if (childCount === 1) return "由下面 1 项构成";
	if (childCount > 1)
		return node.kind === "WEIGHTED"
			? `由下面 ${childCount} 项按比例相加`
			: `由下面 ${childCount} 项相加`;
	return "按录入分数直接计算";
}

export function explanationFor(
	item: NodeResult,
	parent: NodeResult | undefined,
	children: NodeResult[],
): ResultExplanation {
	const parts = children.map((child) => ({
		name: child.name,
		value: child.complete ? `${scoreText(child.score)} 分` : "未录入",
		missing: !child.complete,
	}));
	const steps: string[] = [];
	if (stageDiffers(item.capped, item.gross))
		steps.push(
			`原来算出 ${scoreText(item.gross)} 分，超过这一项的上限，按 ${scoreText(item.capped)} 分计算。`,
		);
	if (item.normalization) {
		const raw = item.normalization.rawMaximum;
		const target = item.normalization.targetMaximum;
		if (raw && target)
			steps.push(
				`满分 ${scoreText(raw)} 分按 ${scoreText(target)} 分折算，得到 ${scoreText(item.normalized)} 分。`,
			);
	}
	if (Number(item.deduction ?? 0) > 1e-9)
		steps.push(`再减去扣分 ${scoreText(item.deduction)} 分。`);
	if (stageDiffers(item.score, item.beforeFloor))
		steps.push(`这一项有最低分要求，按 ${scoreText(item.score)} 分计算。`);

	let lead: string;
	if (!item.complete) lead = "这一项还有成绩没录完，暂时不参与计算。";
	else if (item.kind === "GRADE") lead = "这一项是辅导员录入、学院审核后的成绩。";
	else if (item.kind === "ACTIVITY") lead = "这一项来自已通过审核的活动或成果。";
	else if (children.length)
		lead =
			item.kind === "WEIGHTED"
				? `这一项由下面 ${children.length} 项按比例相加。`
				: `这一项由下面 ${children.length} 项相加。`;
	else lead = "这一项按录入分数直接计算。";

	let relation = "";
	if (item.complete && parent) {
		const isTotal = parent.parentId === null;
		const parentName = isTotal ? "综合测评总成绩" : `「${parent.name}」`;
		if (parent.kind === "WEIGHTED")
			relation = `这一项占${parentName}的 ${percentText(item.weight)}%，折合 ${scoreText(item.parentContribution)} 分。`;
		else
			relation = `这 ${scoreText(item.score)} 分全部算进${parentName}。`;
	}

	return { lead, parts, steps, relation };
}

export function buildScoreTree(details: NodeResult[]): ScoreTree {
	const byId = new Map(details.map((item) => [item.id, item]));
	const childrenOf = new Map<string, NodeResult[]>();
	const roots: NodeResult[] = [];
	for (const item of details) {
		const parent = item.parentId ? byId.get(item.parentId) : undefined;
		if (parent)
			childrenOf.set(parent.id, [...(childrenOf.get(parent.id) ?? []), item]);
		else roots.push(item);
	}
	const byOrder = (a: NodeResult, b: NodeResult) =>
		(a.order ?? 0) - (b.order ?? 0) ||
		a.name.localeCompare(b.name, "zh-CN");
	for (const list of childrenOf.values()) list.sort(byOrder);
	roots.sort(byOrder);
	const root = roots.length === 1 ? roots[0] : undefined;
	return {
		details,
		byId,
		childrenOf,
		roots,
		root,
		topLevel: root ? (childrenOf.get(root.id) ?? []) : roots,
	};
}

function hasScoredDescendant(
	node: NodeResult,
	childrenOf: Map<string, NodeResult[]>,
): boolean {
	if (!node.complete) return true;
	const score = Number(node.score);
	if (!Number.isFinite(score) || Math.abs(score) > 1e-9) return true;
	return (childrenOf.get(node.id) ?? []).some((child) =>
		hasScoredDescendant(child, childrenOf),
	);
}

export function isZeroBranch(
	node: NodeResult,
	childrenOf: Map<string, NodeResult[]>,
) {
	if (!node.complete) return false;
	const score = Number(node.score);
	if (!Number.isFinite(score) || Math.abs(score) > 1e-9) return false;
	return !(childrenOf.get(node.id) ?? []).some((child) =>
		hasScoredDescendant(child, childrenOf),
	);
}

export function nodeName(
	byId: Map<string, NodeResult>,
	nodeId?: string,
	fallback = "",
) {
	return nodeId ? (byId.get(nodeId)?.name ?? fallback) : fallback;
}
