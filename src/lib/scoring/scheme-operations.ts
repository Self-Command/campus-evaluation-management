import type { Scheme, ScoringNode } from "./types";
import { nodeSchema } from "./types";
import { Rational } from "./rational";
import { validateScheme } from "./validate";

export type MovePlacement = "before" | "after" | "inside";
export function descendantsOf(nodes: ScoringNode[], id: string): Set<string> {
	const result = new Set<string>();
	const pending = [id];
	const children = new Map<string, string[]>();
	for (const node of nodes) {
		if (node.parentId) {
			const group = children.get(node.parentId) || [];
			group.push(node.id);
			children.set(node.parentId, group);
		}
	}
	while (pending.length) {
		const next = pending.pop()!;
		if (result.has(next)) continue;
		result.add(next);
		pending.push(...(children.get(next) || []));
	}
	return result;
}
/** Pure immutable move; weights and stable IDs are deliberately preserved. */
export function moveSchemeNode(
	scheme: Scheme,
	sourceId: string,
	targetId: string,
	placement: MovePlacement,
): Scheme {
	const source = scheme.nodes.find((n) => n.id === sourceId),
		target = scheme.nodes.find((n) => n.id === targetId);
	if (!source || !target) throw new Error("移动模块不存在，请重新选择。");
	if (source.parentId === null)
		throw new Error("综合总分由系统维护，不能移动。");
	if (descendantsOf(scheme.nodes, sourceId).has(targetId))
		throw new Error("不能移动到自身或下级模块。");
	if (placement === "inside" && !["SUM", "WEIGHTED"].includes(target.kind))
		throw new Error("只能移入汇总模块，输入模块不能接收下级。");
	const parentId = placement === "inside" ? target.id : target.parentId;
	if (parentId === null) throw new Error("不能在综合总分之前或之后放置模块。");
	if (
		!["SUM", "WEIGHTED"].includes(
			scheme.nodes.find((n) => n.id === parentId)?.kind || "",
		)
	)
		throw new Error("目标上级必须为汇总模块。");
	const peers = scheme.nodes
		.filter((n) => n.parentId === parentId && n.id !== sourceId)
		.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
	const index =
		placement === "inside"
			? peers.length
			: peers.findIndex((n) => n.id === targetId) +
				(placement === "after" ? 1 : 0);
	const ordered = [...peers.slice(0, index), source, ...peers.slice(index)];
	const orders = new Map(ordered.map((n, i) => [n.id, i]));
	const oldPeers = scheme.nodes
		.filter((n) => n.parentId === source.parentId && n.id !== sourceId)
		.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
	const oldOrders = new Map(oldPeers.map((n, i) => [n.id, i]));
	return {
		...scheme,
		nodes: scheme.nodes.map((n) =>
			n.id === sourceId
				? { ...n, parentId, order: orders.get(n.id)! }
				: orders.has(n.id)
					? { ...n, order: orders.get(n.id)! }
					: n.parentId === source.parentId
						? { ...n, order: oldOrders.get(n.id)! }
						: n,
		),
	};
}
export function schemeConfigurationIssues(
	scheme: Scheme,
): Record<string, string[]> {
	const issues: Record<string, string[]> = {};
	const childGroups = new Map<string, ScoringNode[]>();
	for (const node of scheme.nodes) {
		if (node.parentId) {
			const group = childGroups.get(node.parentId) || [];
			group.push(node);
			childGroups.set(node.parentId, group);
		}
	}
	for (const node of scheme.nodes) {
		const errors: string[] = [];
		const parsed = nodeSchema.safeParse(node);
		const fieldNames: Record<string, string> = {
			name: "模块名称",
			kind: "计分方式",
			weight: "比例",
			order: "同级顺序",
			cap: "封顶分",
			floor: "最低计入分",
			rawMaximum: "原始满分",
			targetMaximum: "目标满分",
			minimum: "原始分下限",
			maximum: "原始分上限",
		};
		if (!parsed.success)
			errors.push(
				...parsed.error.issues.map(
					(i) => `${fieldNames[String(i.path[0])] || "模块规则"}：${i.message}`,
				),
			);
		const children = childGroups.get(node.id) || [];
		if (["SUM", "WEIGHTED"].includes(node.kind) && !children.length)
			errors.push("汇总模块尚无下级");
		if (!["SUM", "WEIGHTED"].includes(node.kind) && children.length)
			errors.push("输入模块不能包含下级");
		if (node.kind === "WEIGHTED" && children.length) {
			try {
				const sum = children.reduce(
					(r, n) => r.add(Rational.from(n.weight)),
					Rational.from("0"),
				);
				if (sum.compare(Rational.from("1")) !== 0)
					errors.push(
						`下级比例合计 ${sum.mul(Rational.from("100")).fixed()}%，应为100%`,
					);
			} catch {
				errors.push("下级比例格式无效");
			}
		}
		if (errors.length) issues[node.id] = errors;
	}
	try {
		validateScheme(scheme);
	} catch (error) {
		const message = (error as Error).message;
		const target =
			scheme.nodes.find((n) => message.includes(n.name)) ||
			scheme.nodes.find((n) => n.parentId === null);
		if (target && !(issues[target.id] || []).includes(message))
			issues[target.id] = [...(issues[target.id] || []), message];
	}
	return issues;
}
