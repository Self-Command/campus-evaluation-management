"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "cn";

import { Badge } from "@/components/ui/badge";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	buildScoreTree,
	explanationFor,
	isZeroBranch,
	nodeDescription,
	scoreText,
	type NodeResult,
	type ResultExplanation,
} from "./result-types";

function ScoreDetail({
	node,
	detail,
}: {
	node: NodeResult;
	detail: ResultExplanation;
}) {
	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap items-start justify-between gap-2">
				<div className="min-w-0">
					<h3 className="font-medium text-base leading-snug">{node.name}</h3>
					<p className="mt-1 text-muted-foreground text-sm">{detail.lead}</p>
				</div>
				<Badge variant={node.complete ? "outline" : "secondary"}>
					{node.complete ? "已录入" : "未录入"}
				</Badge>
			</div>

			{detail.parts.length > 0 && (
				<div className="flex flex-col gap-2">
					<p className="font-medium text-muted-foreground text-xs">
						这一项由这些分数组成
					</p>
					<ul className="divide-y rounded-lg border">
						{detail.parts.map((part) => (
							<li
								className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
								key={part.name}
							>
								<span className="min-w-0 break-words">{part.name}</span>
								<span
									className={cn(
										"shrink-0 tabular-nums",
										part.missing && "text-muted-foreground",
									)}
								>
									{part.value}
								</span>
							</li>
						))}
					</ul>
				</div>
			)}

			{detail.steps.length > 0 ? (
				<div className="flex flex-col gap-1.5">
					<p className="font-medium text-muted-foreground text-xs">怎么算的</p>
					<ol className="flex list-decimal flex-col gap-1 pl-5 text-sm">
						{detail.steps.map((step) => (
							<li key={step}>{step}</li>
						))}
					</ol>
				</div>
			) : (
				node.complete && (
					<p className="text-muted-foreground text-sm">
						没有封顶、折算或扣分，直接按录入分数计算。
					</p>
				)
			)}

			{detail.relation && (
				<p className="border-t pt-3 text-sm">{detail.relation}</p>
			)}
			{!node.complete && (
				<p className="text-muted-foreground text-sm">
					补齐后会自动重新计算总分。
				</p>
			)}
		</div>
	);
}

export function ScoreBreakdown({ details }: { details: NodeResult[] }) {
	const tree = useMemo(() => buildScoreTree(details), [details]);
	const [selectedId, setSelectedId] = useState("");
	const [expanded, setExpanded] = useState<Set<string>>(
		() =>
			new Set(
				tree.topLevel
					.filter((node) => (tree.childrenOf.get(node.id)?.length ?? 0) > 0)
					.map((node) => node.id),
			),
	);
	const [zeroOpen, setZeroOpen] = useState<Set<string>>(new Set());

	const selected =
		tree.byId.get(selectedId) ?? tree.topLevel[0] ?? tree.roots[0] ?? null;
	const selectedChildren = selected
		? (tree.childrenOf.get(selected.id) ?? [])
		: [];
	const selectedParent =
		selected?.parentId ? tree.byId.get(selected.parentId) : undefined;
	const detail =
		selected && explanationFor(selected, selectedParent, selectedChildren);

	function toggleExpanded(id: string) {
		setExpanded((current) => {
			const next = new Set(current);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

	function toggleZero(key: string) {
		setZeroOpen((current) => {
			const next = new Set(current);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	}

	function rows(nodes: NodeResult[], depth: number, zeroMode = false): ReactNode {
		const zero = zeroMode
			? []
			: nodes.filter((node) => isZeroBranch(node, tree.childrenOf));
		const active = zeroMode
			? nodes
			: nodes.filter((node) => !isZeroBranch(node, tree.childrenOf));
		const groupKey = `${depth}:${nodes[0]?.parentId ?? "root"}`;

		return (
			<div
				className={cn(
					"flex flex-col",
					depth > 0 &&
						depth <= 2 &&
						"ml-4 border-border/70 border-l pl-2 sm:ml-6 sm:pl-3",
				)}
			>
				{active.map((node) => {
					const children = tree.childrenOf.get(node.id) ?? [];
					const selectedRow = selected?.id === node.id;
					const isExpanded = expanded.has(node.id);
					return (
						<div className="flex flex-col" key={node.id}>
							<button
								aria-current={selectedRow ? "true" : undefined}
								aria-expanded={children.length > 0 ? isExpanded : undefined}
								className={cn(
									"group relative flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
									selectedRow && "bg-muted/60",
									selectedRow &&
										"before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-primary",
								)}
								data-depth={depth}
								data-node-id={node.id}
								data-selected={selectedRow ? "true" : undefined}
								onClick={() => {
									setSelectedId(node.id);
									if (children.length > 0 && depth > 0) toggleExpanded(node.id);
								}}
								type="button"
							>
								<span className="min-w-0 flex-1">
									<span className="block truncate font-medium text-sm">
										{node.name}
									</span>
									<span className="mt-0.5 block truncate text-muted-foreground text-xs">
										{nodeDescription(node, children.length)}
									</span>
								</span>
								<span
									className={cn(
										"shrink-0 text-sm tabular-nums",
										!node.complete && "text-muted-foreground",
									)}
								>
									{node.complete ? `${scoreText(node.score)} 分` : "未录入"}
								</span>
								{children.length > 0 ? (
									<ChevronDown
										aria-hidden="true"
										className={cn(
											"size-4 shrink-0 text-muted-foreground transition-transform",
											isExpanded && "rotate-180",
										)}
									/>
								) : (
									<span aria-hidden="true" className="size-4 shrink-0" />
								)}
							</button>
							{children.length > 0 &&
								isExpanded &&
								rows(children, depth + 1)}
							{selectedRow && detail && (
								<div
								className="border-t bg-muted/30 px-4 py-4 xl:hidden"
								data-testid="score-detail-inline"
							>
									<ScoreDetail detail={detail} node={selected} />
								</div>
							)}
						</div>
					);
				})}

				{zero.length > 0 && (
					<div className="flex flex-col">
						<button
							aria-expanded={zeroOpen.has(groupKey)}
							className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
							onClick={() => toggleZero(groupKey)}
							type="button"
						>
							<span className="min-w-0 flex-1">
								<span className="flex flex-wrap items-center gap-2 font-medium text-sm">
									未得分项
									<Badge variant="outline">{zero.length} 项</Badge>
								</span>
								<span className="mt-0.5 block text-muted-foreground text-xs">
									已完整录入，这些项目没有得分
								</span>
							</span>
							<span className="shrink-0 text-muted-foreground text-sm tabular-nums">
								0.00 分
							</span>
							<ChevronDown
								aria-hidden="true"
								className={cn(
									"size-4 shrink-0 text-muted-foreground transition-transform",
									zeroOpen.has(groupKey) && "rotate-180",
								)}
							/>
						</button>
						{zeroOpen.has(groupKey) && rows(zero, depth + 1, true)}
					</div>
				)}
			</div>
		);
	}

	return (
		<section
			aria-label="得分构成"
			className="flex scroll-mt-20 flex-col gap-4"
			id="score-breakdown"
		>
			<div className="flex flex-col gap-1">
				<h2 className="font-heading font-medium text-base">得分构成</h2>
				<p className="text-muted-foreground text-sm">
					总分由下面几项组成。点任意一项，可以看这项的分数和算法。
				</p>
			</div>

			{tree.topLevel.length === 0 ? (
				<p className="rounded-xl border border-dashed p-6 text-center text-muted-foreground text-sm">
					本周期还没有可展示的计分项。
				</p>
			) : (
				<div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_23rem] xl:items-start">
					<Card className="gap-0 overflow-hidden py-0">
						{rows(tree.topLevel, 0)}
					</Card>

					{selected && detail && (
						<aside className="hidden xl:block" data-testid="score-detail-aside">
							<div className="sticky top-16">
								<Card>
									<CardHeader>
										<CardTitle className="text-base">这一项怎么算</CardTitle>
									</CardHeader>
									<CardContent>
										<ScoreDetail detail={detail} node={selected} />
									</CardContent>
								</Card>
							</div>
						</aside>
					)}
				</div>
			)}
		</section>
	);
}
