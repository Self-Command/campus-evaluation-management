"use client";
// Selected template users directory with invoice field groups and profile rule details.
import { useUnsavedChanges } from "@/components/dashboard/use-unsaved-changes";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, ChevronRight, FlaskConical } from "lucide-react";
import { nodeSchema, type Scheme, type ScoringNode } from "@/lib/scoring/types";
import type { ColumnDef } from "@tanstack/react-table";
import type { DataTableFeatures } from "@/lib/data-table-features";
import { TemplateDirectory } from "@/components/dashboard/template-directory";
import { validateScheme } from "@/lib/scoring/validate";
import { useRemote } from "@/components/dashboard/use-remote";
import { RemoteState } from "@/components/dashboard/remote-state";
import {
	Collapsible,
	CollapsibleTrigger,
	CollapsibleContent,
} from "@/components/ui/collapsible";
import {
	moveSchemeNode,
	descendantsOf,
	schemeConfigurationIssues,
	type MovePlacement,
} from "@/lib/scoring/scheme-operations";
import { ChevronDown, GripVertical } from "lucide-react";
import {
	Table,
	TableHeader,
	TableHead,
	TableRow,
	TableBody,
	TableCell,
} from "@/components/ui/table";
import { Rational } from "@/lib/scoring/rational";
import { Button, buttonVariants } from "@/components/ui/button";
import {
	Card,
	CardHeader,
	CardTitle,
	CardDescription,
	CardContent,
	CardFooter,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
	Field,
	FieldGroup,
	FieldLabel,
	FieldDescription,
} from "@/components/ui/field";
import {
	NativeSelect,
	NativeSelectOption,
} from "@/components/ui/native-select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Feedback, requestJson } from "@/components/dashboard/feedback";
import { phaseLabels } from "@/lib/business-labels";
import { CorrectionReview } from "@/components/dashboard/correction-review";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogDescription,
} from "@/components/ui/dialog";
const kinds = {
	SUM: "汇总",
	WEIGHTED: "比例汇总",
	ACTIVITY: "活动得分",
	GRADE: "成绩输入",
};
type Preview = {
	total: string | null;
	provisionalTotal: string;
	missing: { id: string; name: string }[];
	details?: {
		id: string;
		name: string;
		gross?: string;
		capped?: string;
		normalized?: string;
		deduction?: string;
		score?: string;
		parentContribution: string;
	}[];
};
export function SchemeEditor({
	term,
	admin,
	returnHref = "/terms",
}: {
	term: {
		id: string;
		name: string;
		phase: string;
		revision: number;
		disposition?: string;
		scheme: Scheme;
	};
	admin: boolean;
	returnHref?: string;
}) {
	const router = useRouter();
	const management = useRemote<{ nodeUsage: Record<string, number> }>(
		admin ? `/api/terms/${term.id}` : null,
	);
	const [scheme, setScheme] = useState(term.scheme);
	const [selected, setSelected] = useState(
		scheme.nodes.find((n) => n.parentId === null)!.id,
	);
	const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
	// Long-press drag: the whole module row is the handle, so no extra move
	// buttons are shown in the list.
	const [drag, setDrag] = useState<{
		id: string;
		name: string;
		x: number;
		y: number;
	} | null>(null);
	const [dropHint, setDropHint] = useState<{
		targetId: string;
		placement: MovePlacement;
	} | null>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const press = useRef<{
		id: string;
		name: string;
		x: number;
		y: number;
		pointerId: number;
		timer: number;
	} | null>(null);
	const hint = useRef<{ targetId: string; placement: MovePlacement } | null>(
		null,
	);
	const marked = useRef<HTMLElement | null>(null);
	const [weightInputs, setWeightInputs] = useState<Record<string, string>>({});
	const [dirty, setDirty] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [success, setSuccess] = useState("");
	const [preview, setPreview] = useState<Preview | null>(null);
	const [mobileEdit, setMobileEdit] = useState(false);
	const [correctionMode, setCorrectionMode] = useState(false);
	const [correctOpen, setCorrectOpen] = useState(false);
	const [correctBusy, setCorrectBusy] = useState(false);
	useEffect(() => {
		const listener = (e: BeforeUnloadEvent) => {
			if (dirty) e.preventDefault();
		};
		window.addEventListener("beforeunload", listener);
		return () => window.removeEventListener("beforeunload", listener);
	}, [dirty]);
	useUnsavedChanges(dirty);
	const editable =
		admin &&
		(!term.disposition || term.disposition === "NORMAL") &&
		(term.phase === "CONFIGURATION" ||
			(term.phase === "ACTIVE" && correctionMode));
	const node = scheme.nodes.find((n) => n.id === selected) || scheme.nodes[0];
	function change(next: Scheme) {
		setScheme(next);
		setDirty(true);
		setPreview(null);
		setSuccess("");
	}
	function update(key: keyof ScoringNode, value: unknown) {
		change({
			...scheme,
			nodes: scheme.nodes.map((n) =>
				n.id === node.id
					? {
							...n,
							[key]: value,
							...(key === "kind" && value !== "GRADE"
								? { required: false }
								: {}),
						}
					: n,
			),
		});
	}
	async function save(activate = false) {
		if (busy) return;
		if (!checkScheme()) return;
		if (activate && dirty) {
			setError("请先保存评分方案，再开启申报。");
			return;
		}
		if (
			activate &&
			!window.confirm(
				"开启后评分方案将生效，当前配置不能直接修改。确认开启申报？",
			)
		)
			return;
		setBusy(true);
		setError("");
		try {
			await requestJson(`/api/terms/${term.id}/scheme`, {
				action: activate ? "activate" : "save",
				revision: term.revision,
				scheme,
			});
			setDirty(false);
			setSuccess(activate ? "已开启申报与审核。" : "评分方案已保存。");
			router.refresh();
		} catch (err) {
			setError((err as Error).message);
		} finally {
			setBusy(false);
		}
	}
	const children = new Map<string | null, ScoringNode[]>();
	for (const item of scheme.nodes) {
		const group = children.get(item.parentId) || [];
		group.push(item);
		children.set(item.parentId, group);
	}
	for (const group of children.values())
		group.sort((a, b) => a.order - b.order);
	const visible: { node: ScoringNode; depth: number }[] = [];
	const stack = (children.get(null) || [])
		.slice()
		.reverse()
		.map((item) => ({ node: item, depth: 0 }));
	const seen = new Set<string>();
	while (stack.length) {
		const item = stack.pop()!;
		if (seen.has(item.node.id)) continue;
		seen.add(item.node.id);
		visible.push(item);
		for (const child of (collapsed.has(item.node.id)
			? []
			: children.get(item.node.id) || []
		)
			.slice()
			.reverse())
			stack.push({ node: child, depth: item.depth + 1 });
	}

	const root = scheme.nodes.find((n) => n.parentId === null)!;
	const configuration = schemeConfigurationIssues(scheme);
	for (const [id, value] of Object.entries(weightInputs)) {
		const item = scheme.nodes.find((n) => n.id === id);
		if (item && !/^\d{1,3}(?:\.\d{1,10})?$/.test(value)) {
			configuration[id] = [
				...(configuration[id] || []),
				"比例须为有效百分比，最多10位小数",
			];
			if (item.parentId)
				configuration[item.parentId] = [
					...(configuration[item.parentId] || []),
					`${item.name}的比例尚未填写完整`,
				];
		}
	}
	function toggle(id: string) {
		setCollapsed((previous) => {
			const next = new Set(previous);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}
	function checkScheme() {
		try {
			for (const [id, value] of Object.entries(weightInputs)) {
				if (scheme.nodes.some((n) => n.id === id)) {
					if (!/^\d{1,3}(?:\.\d{1,10})?$/.test(value))
						throw new Error(
							`${scheme.nodes.find((n) => n.id === id)!.name}：请输入有效百分比，最多10位小数`,
						);
				}
			}
			validateScheme(scheme);
			setError("");
			return true;
		} catch (err) {
			const message = (err as Error).message;
			setError(`评分方案尚未通过检查：${message}`);
			const first = scheme.nodes.find((n) => message.includes(n.name));
			if (first) {
				setSelected(first.id);
				setMobileEdit(true);
			}
			return false;
		}
	}
	function addModule(parentId: string) {
		const parent = scheme.nodes.find((n) => n.id === parentId)!;
		let nodes = scheme.nodes;
		if (!["SUM", "WEIGHTED"].includes(parent.kind)) {
			const message =
				parent.parentId === null
					? "添加大模块会将综合总分改为直接累加。现有规则只进入本次草稿，正式生效须完整校验；已有计分输入须通过更正影响核对。继续？"
					: `「${parent.name}」当前是最底层输入项。添加下级会把它改为汇总模块，这一级不再直接录入分数。继续？`;
			if (!window.confirm(message)) return;
			nodes = nodes.map((n) =>
				n.id === parentId
					? { ...n, kind: "SUM" as const, required: false }
					: n,
			);
		}
		const id = crypto.randomUUID();
		change({
			...scheme,
			nodes: [
				...nodes,
				nodeSchema.parse({
					id,
					parentId,
					name: parentId === root.id ? "新大模块" : "新子模块",
					kind: "ACTIVITY",
					order: (children.get(parentId) || []).length,
				}),
			],
		});
		setCollapsed((previous) => {
			const next = new Set(previous);
			next.delete(parentId);
			return next;
		});
		setSelected(id);
		setMobileEdit(true);
	}
	function performMove(
		sourceId: string,
		targetId: string,
		place: MovePlacement,
	) {
		try {
			change(moveSchemeNode(scheme, sourceId, targetId, place));
			setError("");
			setSuccess("模块位置已调整。请核对受影响父级的比例合计，再保存方案。");
		} catch (err) {
			setError((err as Error).message);
		} finally {
			clearDrag();
		}
	}
	const MARK_BEFORE = "[&>td]:border-t-2 [&>td]:border-primary border-t-2 border-primary";
	const MARK_AFTER = "[&>td]:border-b-2 [&>td]:border-primary border-b-2 border-primary";
	const MARK_INSIDE = "bg-primary/10";
	function markRow(row: HTMLElement | null, place: MovePlacement | null) {
		const classes = [...MARK_BEFORE.split(" "), ...MARK_AFTER.split(" "), ...MARK_INSIDE.split(" ")];
		if (marked.current) {
			marked.current.classList.remove(...classes);
			marked.current = null;
		}
		if (!row || !place) return;
		row.classList.add(...(place === "before" ? MARK_BEFORE : place === "after" ? MARK_AFTER : MARK_INSIDE).split(" "));
		marked.current = row;
	}
	function clearDrag() {
		const pointerId = press.current?.pointerId;
		if (pointerId !== undefined && listRef.current?.hasPointerCapture?.(pointerId))
			listRef.current.releasePointerCapture(pointerId);
		if (press.current) window.clearTimeout(press.current.timer);
		press.current = null;
		hint.current = null;
		markRow(null, null);
		setDrag(null);
		setDropHint(null);
		document.body.style.cursor = "";
	}
	function hitTest(x: number, y: number, sourceId: string): { targetId: string; placement: MovePlacement } | null {
		const under = document.elementFromPoint(x, y) as HTMLElement | null;
		const holder = under?.closest("[data-node-id]") as HTMLElement | null;
		const targetId = holder?.getAttribute("data-node-id");
		if (!holder || !targetId || targetId === sourceId) return null;
		if (descendantsOf(scheme.nodes, sourceId).has(targetId)) return null;
		const target = scheme.nodes.find((n) => n.id === targetId);
		if (!target) return null;
		const rect = (holder.closest("tr") ?? holder).getBoundingClientRect();
		if (!rect.height) return null;
		const ratio = (y - rect.top) / rect.height;
		// A group module can always receive a drop; a leaf only reorders.
		const canReceive = ["SUM", "WEIGHTED"].includes(target.kind);
		let placement: MovePlacement =
			ratio < 0.3
				? "before"
				: ratio > 0.7
					? "after"
					: canReceive
						? "inside"
						: ratio < 0.5
							? "before"
							: "after";
		if (placement !== "inside" && target.parentId === null)
			placement = canReceive ? "inside" : "after";
		if (placement !== "inside" && target.parentId === null) return null;
		return { targetId, placement };
	}
	function onModulePointerDown(event: React.PointerEvent<HTMLDivElement>) {
		if (!editable || event.button !== 0 || drag) return;
		const element = event.target as HTMLElement;
		if (element.closest("button,a,input,select,textarea,label,[role=button]")) return;
		const holder = element.closest("[data-node-id]") as HTMLElement | null;
		const id = holder?.getAttribute("data-node-id");
		const item = id ? scheme.nodes.find((n) => n.id === id) : undefined;
		if (!holder || !item || item.parentId === null) return;
		const { clientX: x, clientY: y } = event;
		press.current = {
			id: item.id,
			name: item.name,
			x,
			y,
			pointerId: event.pointerId,
			timer: window.setTimeout(() => {
				const current = press.current;
				if (!current) return;
				listRef.current?.setPointerCapture(current.pointerId);
				setError("");
				setSuccess("");
				setDrag({ id: current.id, name: current.name, x: current.x, y: current.y });
				document.body.style.cursor = "grabbing";
			}, 180),
		};
	}
	function onModulePointerMove(event: React.PointerEvent<HTMLDivElement>) {
		if (!drag) {
			const current = press.current;
			if (!current) return;
			const moved =
				Math.abs(event.clientX - current.x) > 6 ||
				Math.abs(event.clientY - current.y) > 6;
			if (!moved) return;
			window.clearTimeout(current.timer);
			// A mouse drag starts as soon as it moves; touch keeps the long press so
			// that scrolling the list still works.
			if (event.pointerType === "mouse") {
				listRef.current?.setPointerCapture(current.pointerId);
				setDrag({
					id: current.id,
					name: current.name,
					x: event.clientX,
					y: event.clientY,
				});
				document.body.style.cursor = "grabbing";
			} else {
				press.current = null;
			}
			return;
		}
		event.preventDefault();
		const next = hitTest(event.clientX, event.clientY, drag.id);
		hint.current = next;
		setDropHint(next);
		markRow(next ? ((document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null)?.closest("tr") ?? null) : null, next?.placement ?? null);
		setDrag({ ...drag, x: event.clientX, y: event.clientY });
	}
	function onModulePointerUp() {
		if (!drag) {
			if (press.current) window.clearTimeout(press.current.timer);
			press.current = null;
			return;
		}
		const source = drag.id;
		const target = hint.current;
		if (target) performMove(source, target.targetId, target.placement);
		else clearDrag();
	}
	function summary(n: ScoringNode) {
		return `${kinds[n.kind]} · ${n.parentId && scheme.nodes.find((p) => p.id === n.parentId)?.kind === "WEIGHTED" ? `占上级 ${percentage(n.weight)}%` : "直接计入"} · 封顶 ${n.cap ?? "不限"}${n.normalize ? ` · ${n.rawMaximum}→${n.targetMaximum} 折算` : ""}${n.floor !== null ? ` · 最低 ${n.floor}` : ""}${n.required ? " · 必填" : ""}`;
	}
	function percentage(value: string) {
		try {
			return Rational.from(value).mul(Rational.from("100")).fixed();
		} catch {
			return "格式错误";
		}
	}
	function ruleDetails(n: ScoringNode) {
		return [
			["模块名称", n.name],
			["计分方式", kinds[n.kind]],
			["占上级比例", `${percentage(n.weight)}%`],
			["分数范围", `${n.minimum} 至 ${n.maximum}`],
			["封顶分", n.cap ?? "不限制"],
			["最低计入分", n.floor ?? "不限制"],
			[
				"满分折算",
				n.normalize
					? `${n.rawMaximum} 分折算为 ${n.targetMaximum} 分`
					: "保留原分",
			],
			["缺失输入", n.required ? "必须提供，否则结果不完整" : "按零分计入"],
			["同级顺序", String(n.order)],
		];
	}
	// Native HTML5 drag: every non-root row is draggable, dropping on the upper or
	// lower edge reorders among siblings (including out of a parent), and dropping
	// in the middle nests the dragged module (and its subtree) inside the target.
	useEffect(() => {
		const root = listRef.current;
		if (!root) return;
		for (const row of Array.from(root.querySelectorAll<HTMLElement>("tr"))) {
			const id = row.querySelector("[data-node-id]")?.getAttribute("data-node-id");
			const item = id ? scheme.nodes.find((n) => n.id === id) : undefined;
			row.draggable = !!editable && !!item && item.parentId !== null;
			if (id) row.dataset.nodeId = id;
			else delete row.dataset.nodeId;
		}
		for (const holder of Array.from(root.querySelectorAll<HTMLElement>("[data-node-id]"))) {
			const id = holder.getAttribute("data-node-id")!;
			const item = scheme.nodes.find((n) => n.id === id);
			holder.draggable = !!editable && !!item && item.parentId !== null;
		}
		const rowOf = (target: EventTarget | null) =>
			(target as HTMLElement | null)?.closest<HTMLElement>("[data-node-id]") ?? null;
		const onDragStart = (event: DragEvent) => {
			const holder = rowOf(event.target);
			const id = holder?.getAttribute("data-node-id");
			const item = id ? scheme.nodes.find((n) => n.id === id) : undefined;
			if (!id || !item || item.parentId === null) {
				event.preventDefault();
				return;
			}
			event.dataTransfer?.setData("text/plain", id);
			if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
			setError("");
			setSuccess("");
			setDrag({ id, name: item.name, x: event.clientX, y: event.clientY });
		};
		const onDragOver = (event: DragEvent) => {
			if (!drag) return;
			event.preventDefault();
			const next = hitTest(event.clientX, event.clientY, drag.id);
			hint.current = next;
			setDropHint(next);
			if (event.dataTransfer) event.dataTransfer.dropEffect = next ? "move" : "none";
			const under = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
			markRow(under?.closest("tr") ?? null, next?.placement ?? null);
		};
		const onDrop = (event: DragEvent) => {
			if (!drag) return;
			event.preventDefault();
			const next = hitTest(event.clientX, event.clientY, drag.id);
			if (next) performMove(drag.id, next.targetId, next.placement);
			else clearDrag();
		};
		const onDragEnd = () => clearDrag();
		root.addEventListener("dragstart", onDragStart);
		root.addEventListener("dragover", onDragOver);
		root.addEventListener("drop", onDrop);
		root.addEventListener("dragend", onDragEnd);
		return () => {
			root.removeEventListener("dragstart", onDragStart);
			root.removeEventListener("dragover", onDragOver);
			root.removeEventListener("drop", onDrop);
			root.removeEventListener("dragend", onDragEnd);
		};
	}, [drag, editable, scheme]);
	function rowActions(n: ScoringNode) {
		return (
			<div className="flex flex-wrap gap-1">
				<Button
					variant="ghost"
					size="sm"
					onClick={() => {
						setSelected(n.id);
						setMobileEdit(true);
					}}
				>
					{editable ? "设置" : "规则明细"}
				</Button>
				{editable && (
					<Button variant="ghost" size="sm" onClick={() => addModule(n.id)}>
						添加下级
					</Button>
				)}
			</div>
		);
	}
	const columns: ColumnDef<
		DataTableFeatures,
		{ node: ScoringNode; depth: number }
	>[] = [
		{
			id: "name",
			header: "模块 / 层级",
			cell: ({ row }) => {
				const n = row.original.node;
				return (
					<div
						data-node-id={n.id}
						className={`flex min-w-44 items-center gap-2 ${
							editable && n.parentId !== null
								? "cursor-grab select-none active:cursor-grabbing"
								: ""
						}`}
						style={{ paddingLeft: Math.min(row.original.depth, 8) * 12 }}
					>
						{editable && n.parentId !== null && (
							<GripVertical
								aria-hidden
								className="size-4 shrink-0 text-muted-foreground"
							/>
						)}
						{(children.get(n.id)?.length || 0) > 0 && (
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label={
									collapsed.has(n.id) ? `展开${n.name}` : `折叠${n.name}`
								}
								onClick={() => toggle(n.id)}
							>
								{collapsed.has(n.id) ? <ChevronRight /> : <ChevronDown />}
							</Button>
						)}
						<span className="font-medium">{n.name}</span>
						{n.parentId === null && <Badge variant="outline">系统总分</Badge>}
					</div>
				);
			},
		},
		{
			id: "kind",
			header: "来源 / 汇总",
			cell: ({ row }) => kinds[row.original.node.kind],
		},
		{
			id: "weight",
			header: "占上级比例",
			cell: ({ row }) =>
				row.original.node.parentId &&
				scheme.nodes.find((n) => n.id === row.original.node.parentId)?.kind ===
					"WEIGHTED"
					? `${percentage(row.original.node.weight)}%`
					: "—",
		},
		{
			id: "rules",
			header: "封顶 / 折算 / 必填",
			cell: ({ row }) => summary(row.original.node),
		},
		{
			id: "status",
			header: "配置状态",
			cell: ({ row }) => (
				<div className="flex flex-col gap-1">
					{configuration[row.original.node.id]?.map((message) => (
						<Button
							key={message}
							variant="ghost"
							size="sm"
							onClick={() => {
								setSelected(row.original.node.id);
								setMobileEdit(true);
							}}
						>
							{message}
						</Button>
					)) || <Badge variant="outline">已填写</Badge>}
				</div>
			),
		},
		{
			id: "actions",
			header: "操作",
			cell: ({ row }) => rowActions(row.original.node),
		},
	];

	return (
		<>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex items-center gap-3">
					<Badge variant="outline">{phaseLabels[term.phase]}</Badge>
					<span className="text-xs text-muted-foreground">
						评分方案版本 {term.revision}
						{dirty ? " · 有未保存修改" : ""}
					</span>
				</div>
				<div className="flex flex-wrap gap-2">
					<Link
						href={returnHref}
						className={buttonVariants({ variant: "outline" })}
						onClick={(e) => {
							if (dirty && !window.confirm("放弃未保存修改并返回？"))
								e.preventDefault();
						}}
					>
						返回周期
					</Link>
					{admin &&
						(!term.disposition || term.disposition === "NORMAL") &&
						term.phase === "ACTIVE" &&
						!correctionMode && (
							<Button variant="outline" onClick={() => setCorrectionMode(true)}>
								更正评分方案
							</Button>
						)}
					{term.phase === "ACTIVE" && correctionMode && (
						<>
							<Button
								variant="outline"
								onClick={() => {
									if (
										!dirty ||
										window.confirm("放弃本次未提交的评分方案更正？")
									) {
										setScheme(term.scheme);
										setDirty(false);
										setCorrectionMode(false);
										setWeightInputs({});
										setError("");
										setPreview(null);
									}
								}}
							>
								取消更正
							</Button>
							<Button
								disabled={busy || !dirty}
								onClick={() => {
									if (checkScheme()) setCorrectOpen(true);
								}}
							>
								预览更正影响
							</Button>
						</>
					)}
					{editable && term.phase === "CONFIGURATION" && (
						<>
							<Button
								variant="outline"
								disabled={busy}
								onClick={() => void save(true)}
							>
								开启申报
							</Button>
							<Button disabled={busy} onClick={() => void save()}>
								{busy ? "正在保存…" : "保存方案"}
							</Button>
						</>
					)}
				</div>
			</div>
			<Feedback error={error} success={success} />
			{editable && <RemoteState {...management} />}
			<Dialog
				open={correctOpen}
				onOpenChange={(open) => {
					if (!correctBusy) setCorrectOpen(open);
				}}
			>
				<DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-5xl">
					<DialogHeader>
						<DialogTitle>评分方案更正</DialogTitle>
						<DialogDescription>
							核对全部学生更正前后的结果，再填写原因提交。原发布和存档保留。
						</DialogDescription>
					</DialogHeader>
					<CorrectionReview
						termId={term.id}
						revision={term.revision}
						payload={{ kind: "scheme", scheme }}
						onBusyChange={setCorrectBusy}
						onCommitted={() => {
							setCorrectOpen(false);
							setCorrectionMode(false);
							setDirty(false);
							setSuccess("评分方案已更正，请重新核对并发布结果。");
							router.refresh();
						}}
					>
						<FieldGroup>
							<Field>
								<FieldLabel>待更正方案</FieldLabel>
								<FieldDescription>
									共 {scheme.nodes.length} 个评分模块、
									{scheme.deductions.length}{" "}
									个扣分项目。请核对左侧编辑的规则，预览将检查全部计分输入与受影响学生。
								</FieldDescription>
							</Field>
						</FieldGroup>
					</CorrectionReview>
				</DialogContent>
			</Dialog>
			<Tabs defaultValue="structure">
				<TabsList className="h-auto flex-wrap justify-start">
					<TabsTrigger value="structure">模块与规则</TabsTrigger>
					<TabsTrigger value="deductions">扣分项目</TabsTrigger>
					{admin && (
						<TabsTrigger value="preview">
							<FlaskConical data-icon="inline-start" />
							评分试算
						</TabsTrigger>
					)}
				</TabsList>
				<TabsContent value="structure" className="mt-5">
					<div
						ref={listRef}
						className={drag ? "select-none [touch-action:none]" : undefined}
					>
					<TemplateDirectory
						title="评分模块与规则"
						description={
							editable
								? "按住模块任意位置约 0.2 秒即可拖动：放到模块上沿/下沿调整顺序，放到中间移入该模块；比例不会自动调整，保存前请核对。"
								: "展开大模块查看子模块，选择规则明细查阅各模块的计分方式、比例、封顶与折算规则。"
						}
						data={visible}
						columns={columns}
						actions={
							<>
								<Button
									variant="outline"
									onClick={() => setCollapsed(new Set())}
								>
									展开全部
								</Button>
								<Button
									variant="outline"
									onClick={() =>
										setCollapsed(new Set(scheme.nodes.map((n) => n.id)))
									}
								>
									折叠全部
								</Button>
								{editable && (
									<Button onClick={() => addModule(root.id)}>
										<Plus data-icon="inline-start" />
										添加大模块
									</Button>
								)}
							</>
						}
						mobile={({ node: item, depth }) => (
							<div
								data-node-id={item.id}
								className={`flex flex-col gap-3 ${
									editable && item.parentId !== null
										? "cursor-grab select-none active:cursor-grabbing"
										: ""
								}`}
							>
								<div className="flex items-center gap-2">
									{(children.get(item.id)?.length || 0) > 0 && (
										<Button
											variant="ghost"
											size="icon-sm"
											aria-label={
												collapsed.has(item.id)
													? `展开${item.name}`
													: `折叠${item.name}`
											}
											onClick={() => toggle(item.id)}
										>
											{collapsed.has(item.id) ? (
												<ChevronRight />
											) : (
												<ChevronDown />
											)}
										</Button>
									)}
									<p className="font-medium">
										{depth ? "↳ " : ""}
										{item.name}
									</p>
								</div>
								<p className="text-sm">{summary(item)}</p>
								<p className="text-xs text-muted-foreground">
									{configuration[item.id]?.join("；") || "配置已填写"}
								</p>
								{rowActions(item)}
							</div>
						)}
					/>
					{drag && (
						<div
							className="pointer-events-none fixed z-50 flex items-center gap-2 rounded-md border bg-popover px-3 py-1.5 text-sm shadow-lg"
							style={{ left: drag.x + 14, top: drag.y + 10 }}
						>
							<GripVertical aria-hidden className="size-3.5 text-muted-foreground" />
							{drag.name}
							<span className="text-muted-foreground">
								{dropHint
									? dropHint.placement === "inside"
										? "· 移入该模块"
										: dropHint.placement === "before"
											? "· 放到上面"
											: "· 放到下面"
									: "· 拖到目标模块"}
							</span>
						</div>
					)}
					</div>
					<Dialog
						open={mobileEdit}
						onOpenChange={(open) => {
							if (!busy && !correctBusy) setMobileEdit(open);
						}}
					>
						<DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
							<DialogHeader>
								<DialogTitle>
									{node.name} · {editable ? "模块设置" : "规则明细"}
								</DialogTitle>
								<DialogDescription>
									{node.parentId
										? `上级：${scheme.nodes.find((n) => n.id === node.parentId)?.name}`
										: "综合总分由系统维护"}
								</DialogDescription>
							</DialogHeader>
							<Feedback error={error} />
							{editable ? (
								<Card>
									<CardHeader>
										<CardTitle>{node.name}</CardTitle>
										<CardDescription>
											{kinds[node.kind]} ·{" "}
											{node.parentId
												? `上级：${scheme.nodes.find((n) => n.id === node.parentId)?.name}`
												: "综合总分"}
										</CardDescription>
									</CardHeader>
									<CardContent>
										<div className="mb-5 flex flex-col gap-1 rounded-lg border bg-muted/40 p-3">
											<p className="font-medium text-sm">这一项怎么填</p>
											<p className="text-muted-foreground text-sm">
												选「成绩输入」表示这一项直接录分；选「活动得分」表示按通过审核的活动和成果累计；选「汇总」或「比例汇总」表示这一项由下面的模块加起来。再填分数上限、折算等细节，填完返回列表，最后统一保存整套方案。
											</p>
										</div>
										<FieldGroup>
											<Field>
												<FieldLabel htmlFor="node-name">模块名称</FieldLabel>
												<Input
													id="node-name"
													value={node.name}
													readOnly={node.parentId === null}
													onChange={(e) => update("name", e.target.value)}
													maxLength={80}
												/>
											</Field>

											<Field>
												<FieldLabel htmlFor="node-kind">计分方式</FieldLabel>
												<NativeSelect
													id="node-kind"
													value={node.kind}
													disabled={!editable}
													onChange={(e) => {
														if (
															children.get(node.id)?.length &&
															["ACTIVITY", "GRADE"].includes(e.target.value)
														) {
															setError(
																"请先移走或删除下级模块，再设为最底层输入。",
															);
															return;
														}
														update("kind", e.target.value);
													}}
												>
													{Object.entries(kinds)
														.filter(
															([value]) =>
																node.parentId !== null ||
																["SUM", "WEIGHTED"].includes(value) ||
																value === node.kind,
														)
														.map(([value, label]) => (
															<NativeSelectOption key={value} value={value}>
																{label}
															</NativeSelectOption>
														))}
												</NativeSelect>
											</Field>
											{node.parentId &&
												scheme.nodes.find((n) => n.id === node.parentId)
													?.kind === "WEIGHTED" && (
													<Field>
														<FieldLabel htmlFor="node-weight">
															占上级比例（%）
														</FieldLabel>
														<Input
															id="node-weight"
															type="number"
															step="any"
															value={
																weightInputs[node.id] ?? percentage(node.weight)
															}
															onChange={(e) => {
																const value = e.target.value;
																setWeightInputs((previous) => ({
																	...previous,
																	[node.id]: value,
																}));
																setDirty(true);
																setPreview(null);
																if (/^\d{1,3}(?:\.\d{1,10})?$/.test(value)) {
																	update(
																		"weight",
																		Rational.from(value)
																			.div(Rational.from("100"))
																			.fixed(12),
																	);
																	setError("");
																} else
																	setError(
																		`${node.name}：请输入有效百分比，最多10位小数。`,
																	);
															}}
														/>
														<FieldDescription>
															同一上级的直接下级比例合计需为100%。
														</FieldDescription>
													</Field>
												)}
											<div className="grid gap-5 sm:grid-cols-2">
												{[
													["cap", "封顶分"],
													["floor", "最低计入分"],
												].map(([key, label]) => (
													<Field key={key}>
														<FieldLabel htmlFor={`node-${key}`}>
															{label}
														</FieldLabel>
														<Input
															id={`node-${key}`}
															value={String(node[key as "cap"] ?? "")}
															disabled={!editable}
															inputMode="decimal"
															placeholder="不限制"
															onChange={(e) =>
																update(
																	key as "cap",
																	e.target.value === "" ? null : e.target.value,
																)
															}
														/>
													</Field>
												))}
											</div>
											{["GRADE", "ACTIVITY"].includes(node.kind) && (
												<>
													<div className="grid gap-5 sm:grid-cols-2">
														{[
															["minimum", "最低分"],
															["maximum", "最高分"],
														].map(([key, label]) => (
															<Field key={key}>
																<FieldLabel htmlFor={`node-${key}`}>
																	{label}
																</FieldLabel>
																<Input
																	id={`node-${key}`}
																	value={node[key as "minimum"]}
																	disabled={!editable}
																	inputMode="decimal"
																	onChange={(e) =>
																		update(key as "minimum", e.target.value)
																	}
																/>
															</Field>
														))}
													</div>
													<Field>
														<FieldLabel htmlFor="node-required">
															缺失输入
														</FieldLabel>
														<NativeSelect
															id="node-required"
															value={String(node.required)}
															disabled={!editable}
															onChange={(e) =>
																update("required", e.target.value === "true")
															}
														>
															<NativeSelectOption value="false">
																未提供时按零分计入
															</NativeSelectOption>
															<NativeSelectOption value="true">
																必须提供，否则结果不完整
															</NativeSelectOption>
														</NativeSelect>
													</Field>
												</>
											)}
											<Collapsible
												key={node.id}
												defaultOpen={node.normalize}
												className="flex flex-col gap-4"
											>
												<CollapsibleTrigger
													render={
														<Button
															type="button"
															variant="outline"
															className="self-start"
														/>
													}
												>
													满分折算设置
													{node.normalize ? "（已启用）" : "（未启用）"}
													<ChevronDown data-icon="inline-end" />
												</CollapsibleTrigger>
												<CollapsibleContent className="flex flex-col gap-4">
													{" "}
													<Field>
														<FieldLabel htmlFor="node-normalize">
															满分折算
														</FieldLabel>
														<NativeSelect
															id="node-normalize"
															value={String(node.normalize)}
															disabled={!editable}
															onChange={(e) =>
																update("normalize", e.target.value === "true")
															}
														>
															<NativeSelectOption value="false">
																不折算，保留原分
															</NativeSelectOption>
															<NativeSelectOption value="true">
																按原始满分折算为目标满分
															</NativeSelectOption>
														</NativeSelect>
													</Field>
													{node.normalize && (
														<div className="grid gap-5 sm:grid-cols-2">
															{[
																["rawMaximum", "原始满分"],
																["targetMaximum", "目标满分"],
															].map(([key, label]) => (
																<Field key={key}>
																	<FieldLabel htmlFor={`node-${key}`}>
																		{label}
																	</FieldLabel>
																	<Input
																		id={`node-${key}`}
																		value={node[key as "rawMaximum"] || ""}
																		disabled={!editable}
																		inputMode="decimal"
																		onChange={(e) =>
																			update(
																				key as "rawMaximum",
																				e.target.value || null,
																			)
																		}
																	/>
																</Field>
															))}
														</div>
													)}
												</CollapsibleContent>
											</Collapsible>
										</FieldGroup>
									</CardContent>
									{editable && node.parentId && (
										<CardFooter className="border-t">
											<Button
												variant="outline"
												disabled={
													!management.data ||
													!!management.data.nodeUsage[node.id]
												}
												onClick={() => {
													if (
														!management.data ||
														management.data.nodeUsage[node.id]
													) {
														setError(
															"该模块已有业务引用，不能删除。请保留历史计分依据。",
														);
														return;
													}
													if (
														scheme.nodes.some((n) => n.parentId === node.id) ||
														scheme.deductions.some((d) => d.nodeId === node.id)
													) {
														setError("请先移除下级模块与关联扣分项目。");
														return;
													}
													if (!window.confirm(`删除评分模块“${node.name}”？`))
														return;
													change({
														...scheme,
														nodes: scheme.nodes.filter((n) => n.id !== node.id),
													});
													setSelected(node.parentId!);
													setMobileEdit(false);
												}}
											>
												<Trash2 data-icon="inline-start" />
												删除模块
											</Button>
											<FieldDescription>
												{management.data?.nodeUsage[node.id]
													? `已有 ${management.data.nodeUsage[node.id]} 条业务引用，不能删除。`
													: "有下级或业务引用的模块不能删除。"}
											</FieldDescription>
										</CardFooter>
									)}
								</Card>
							) : (
								<dl className="grid gap-6 sm:grid-cols-2">
									{ruleDetails(node).map(([label, value]) => (
										<div key={label} className="flex flex-col gap-1">
											<dt className="text-xs text-muted-foreground">{label}</dt>
											<dd className="break-words text-sm">{value}</dd>
										</div>
									))}
								</dl>
							)}
							{configuration[node.id]?.length ? (
								<Feedback error={configuration[node.id].join("；")} />
							) : null}
							<Button variant="outline" onClick={() => setMobileEdit(false)}>
								{editable ? "保留草稿并返回列表" : "完成查看"}
							</Button>
						</DialogContent>
					</Dialog>
				</TabsContent>
				<TabsContent value="deductions" className="mt-5">
					<Card>
						<CardHeader>
							<CardTitle>节点扣分</CardTitle>
							<CardDescription>
								扣分在模块汇总、封顶、折算后执行，再应用最低计入分。
							</CardDescription>
						</CardHeader>
						<CardContent className="flex flex-col gap-5">
							{scheme.deductions.length === 0 && (
								<p className="text-sm text-muted-foreground">
									当前方案尚未设置扣分项目。
								</p>
							)}
							{scheme.deductions.map((d, index) =>
								editable ? (
									<FieldGroup key={d.id} className="rounded-lg border p-4">
										<Field>
											<FieldLabel htmlFor={`ded-name-${index}`}>
												项目名称
											</FieldLabel>
											<Input
												id={`ded-name-${index}`}
												value={d.name}
												disabled={!editable}
												onChange={(e) =>
													change({
														...scheme,
														deductions: scheme.deductions.map((p) =>
															p.id === d.id
																? { ...p, name: e.target.value }
																: p,
														),
													})
												}
											/>
										</Field>
										<Field>
											<FieldLabel htmlFor={`ded-node-${index}`}>
												扣分模块
											</FieldLabel>
											<NativeSelect
												id={`ded-node-${index}`}
												value={d.nodeId}
												disabled={!editable}
												onChange={(e) =>
													change({
														...scheme,
														deductions: scheme.deductions.map((p) =>
															p.id === d.id
																? { ...p, nodeId: e.target.value }
																: p,
														),
													})
												}
											>
												{scheme.nodes.map((n) => (
													<NativeSelectOption key={n.id} value={n.id}>
														{n.name}
													</NativeSelectOption>
												))}
											</NativeSelect>
										</Field>
										<Field>
											<FieldLabel htmlFor={`ded-coef-${index}`}>
												扣分系数
											</FieldLabel>
											<Input
												id={`ded-coef-${index}`}
												value={d.coefficient}
												disabled={!editable}
												onChange={(e) =>
													change({
														...scheme,
														deductions: scheme.deductions.map((p) =>
															p.id === d.id
																? { ...p, coefficient: e.target.value }
																: p,
														),
													})
												}
											/>
										</Field>
										{editable && (
											<Button
												variant="outline"
												onClick={() =>
													change({
														...scheme,
														deductions: scheme.deductions.filter(
															(p) => p.id !== d.id,
														),
													})
												}
											>
												移除项目
											</Button>
										)}
									</FieldGroup>
								) : (
									<dl key={d.id} className="grid gap-5 sm:grid-cols-3">
										{[
											["扣分项目", d.name],
											[
												"扣分模块",
												scheme.nodes.find((n) => n.id === d.nodeId)?.name ||
													"模块不存在",
											],
											["扣分系数", d.coefficient],
										].map(([label, value]) => (
											<div key={label} className="flex flex-col gap-1">
												<dt className="text-xs text-muted-foreground">
													{label}
												</dt>
												<dd className="text-sm">{value}</dd>
											</div>
										))}
									</dl>
								),
							)}
							{editable && (
								<Button
									variant="outline"
									className="self-start"
									onClick={() =>
										change({
											...scheme,
											deductions: [
												...scheme.deductions,
												{
													id: crypto.randomUUID(),
													nodeId: scheme.nodes[0].id,
													name: "新扣分项目",
													coefficient: "1",
												},
											],
										})
									}
								>
									<Plus data-icon="inline-start" />
									添加扣分项目
								</Button>
							)}
						</CardContent>
					</Card>
				</TabsContent>
				{admin && (
					<TabsContent value="preview" className="mt-5">
						<Card>
							<CardHeader>
								<CardTitle>评分试算</CardTitle>
								<CardDescription>
									填入分数和扣分分值，核对当前方案；试算不会保存学生成绩。
								</CardDescription>
							</CardHeader>
							<CardContent>
								<form
									className="flex flex-col gap-5"
									onSubmit={async (e) => {
										e.preventDefault();
										if (busy || !checkScheme()) return;
										setBusy(true);
										const f = new FormData(e.currentTarget);
										setError("");
										try {
											const values = Object.fromEntries(
												scheme.nodes
													.filter(
														(n) =>
															["ACTIVITY", "GRADE"].includes(n.kind) &&
															f.get(`value-${n.id}`) !== "",
													)
													.map((n) => [n.id, String(f.get(`value-${n.id}`))]),
											);
											const deductions = Object.fromEntries(
												scheme.deductions
													.filter((d) => f.get(`ded-${d.id}`) !== "")
													.map((d) => [d.id, String(f.get(`ded-${d.id}`))]),
											);
											setPreview(
												await requestJson<Preview>(
													`/api/terms/${term.id}/scheme`,
													{
														action: "preview",
														scheme,
														input: { values, deductions },
													},
												),
											);
										} catch (err) {
											setError((err as Error).message);
										} finally {
											setBusy(false);
										}
									}}
								>
									<FieldGroup>
										<div className="grid gap-5 sm:grid-cols-2">
											{scheme.nodes
												.filter((n) => ["ACTIVITY", "GRADE"].includes(n.kind))
												.map((n) => (
													<Field key={n.id}>
														<FieldLabel htmlFor={`preview-${n.id}`}>
															{n.name}
														</FieldLabel>
														<Input
															id={`preview-${n.id}`}
															name={`value-${n.id}`}
															inputMode="decimal"
															placeholder={n.required ? "必须提供" : "缺省为0"}
														/>
													</Field>
												))}
											{scheme.deductions.map((d) => (
												<Field key={d.id}>
													<FieldLabel htmlFor={`preview-ded-${d.id}`}>
														{d.name}（扣分额）
													</FieldLabel>
													<Input
														id={`preview-ded-${d.id}`}
														name={`ded-${d.id}`}
														inputMode="decimal"
													/>
												</Field>
											))}
										</div>
									</FieldGroup>
									<Button type="submit" className="self-start" disabled={busy}>
										计算结果
									</Button>
									{preview && (
										<div className="rounded-lg border p-5">
											<p className="text-sm text-muted-foreground">
												{preview.total === null ? "暂计分" : "总分"}
											</p>
											<p className="mt-2 text-3xl font-semibold tabular-nums">
												{preview.total ?? preview.provisionalTotal}
											</p>
											{preview.details && (
												<>
													<div className="mt-5 hidden overflow-x-auto md:block">
														<Table>
															<TableHeader>
																<TableRow>
																	{[
																		"模块",
																		"原始汇总",
																		"封顶后",
																		"折算后",
																		"扣分",
																		"计入分",
																		"贡献分",
																	].map((label) => (
																		<TableHead key={label}>{label}</TableHead>
																	))}
																</TableRow>
															</TableHeader>
															<TableBody>
																{preview.details.map((item) => (
																	<TableRow key={item.id}>
																		<TableCell>{item.name}</TableCell>
																		{[
																			item.gross,
																			item.capped,
																			item.normalized,
																			item.deduction,
																			item.score,
																			item.parentContribution,
																		].map((value, index) => (
																			<TableCell
																				key={index}
																				className="tabular-nums"
																			>
																				{value}
																			</TableCell>
																		))}
																	</TableRow>
																))}
															</TableBody>
														</Table>
													</div>
													<div className="mt-4 flex flex-col divide-y md:hidden">
														{preview.details.map((item) => (
															<div
																key={item.id}
																className="flex flex-col gap-2 py-3"
															>
																<p className="font-medium text-sm">
																	{item.name}
																</p>
																<p className="text-sm tabular-nums">
																	汇总 {item.gross} · 扣分 {item.deduction} ·
																	计入 {item.score}
																</p>
																<p className="text-sm tabular-nums">
																	封顶后 {item.capped} · 折算后{" "}
																	{item.normalized} · 贡献{" "}
																	{item.parentContribution}
																</p>
															</div>
														))}
													</div>
												</>
											)}
											{preview.missing.length > 0 && (
												<p className="mt-3 text-sm">
													缺失：{preview.missing.map((n) => n.name).join("、")}
												</p>
											)}
										</div>
									)}
								</form>
							</CardContent>
						</Card>
					</TabsContent>
				)}
			</Tabs>
		</>
	);
}
