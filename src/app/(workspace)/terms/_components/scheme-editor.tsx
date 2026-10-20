"use client";
// Complete invoice/invoice.tsx two-panel editor adapted to scoring directory and node properties.
import { useUnsavedChanges } from "@/components/dashboard/use-unsaved-changes";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, ChevronRight, FlaskConical } from "lucide-react";
import { nodeSchema, type Scheme, type ScoringNode } from "@/lib/scoring/types";
import { cn } from "cn";
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
	SUM: "直接累加",
	WEIGHTED: "比例汇总",
	ACTIVITY: "活动累计",
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
}: {
	term: {
		id: string;
		name: string;
		phase: string;
		revision: number;
		scheme: Scheme;
	};
	admin: boolean;
}) {
	const router = useRouter();
	const [scheme, setScheme] = useState(term.scheme);
	const [selected, setSelected] = useState(scheme.nodes[0].id);
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
				n.id === node.id ? { ...n, [key]: value } : n,
			),
		});
	}
	async function save(activate = false) {
		if (busy) return;
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
		for (const child of (children.get(item.node.id) || []).slice().reverse())
			stack.push({ node: child, depth: item.depth + 1 });
	}
	const descendants = new Set<string>();
	const descendantsPending = [node.id];
	while (descendantsPending.length) {
		const id = descendantsPending.pop()!;
		if (descendants.has(id)) continue;
		descendants.add(id);
		for (const child of children.get(id) || [])
			descendantsPending.push(child.id);
	}
	return (
		<>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex items-center gap-3">
					<Badge variant="outline">{phaseLabels[term.phase]}</Badge>
					<span className="text-xs text-muted-foreground">
						方案修订 {term.revision}
						{dirty ? " · 有未保存修改" : ""}
					</span>
				</div>
				<div className="flex flex-wrap gap-2">
					<Link
						href="/terms"
						className={buttonVariants({ variant: "outline" })}
						onClick={(e) => {
							if (dirty && !window.confirm("放弃未保存修改并返回？"))
								e.preventDefault();
						}}
					>
						返回周期
					</Link>
					{admin && term.phase === "ACTIVE" && !correctionMode && (
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
									}
								}}
							>
								取消更正
							</Button>
							<Button
								disabled={busy || !dirty}
								onClick={() => setCorrectOpen(true)}
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
							核对全量学生更正前后结果，再填写理由提交。原发布与结算快照保留。
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
					<div className="grid items-start gap-5 xl:grid-cols-2">
						<Card className={mobileEdit ? "hidden xl:flex" : ""}>
							<CardHeader>
								<CardTitle>评分目录</CardTitle>
								<CardDescription>选择模块查看属性与计分规则。</CardDescription>
							</CardHeader>
							<CardContent className="px-3">
								{visible.map(({ node: item, depth }) => (
									<button
										key={item.id}
										type="button"
										onClick={() => {
											setSelected(item.id);
											setMobileEdit(true);
										}}
										className={cn(
											"flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-3 text-left text-sm hover:bg-muted",
											node.id === item.id && "bg-muted font-medium",
										)}
										style={{ paddingLeft: `${12 + Math.min(depth, 6) * 16}px` }}
									>
										<span className="min-w-0 truncate">{item.name}</span>
										<ChevronRight className="size-3 shrink-0 text-muted-foreground" />
									</button>
								))}
							</CardContent>
							{editable && (
								<CardFooter className="border-t">
									<Button
										variant="outline"
										className="w-full"
										disabled={!["SUM", "WEIGHTED"].includes(node.kind)}
										onClick={() => {
											const id = crypto.randomUUID();
											change({
												...scheme,
												nodes: [
													...scheme.nodes,
													nodeSchema.parse({
														id,
														name: "新评分模块",
														parentId: node.id,
														kind: "ACTIVITY",
														order: scheme.nodes.length,
													}),
												],
											});
											setSelected(id);
											setMobileEdit(true);
										}}
									>
										<Plus data-icon="inline-start" />
										添加下级模块
									</Button>
								</CardFooter>
							)}
						</Card>
						<Card className={!mobileEdit ? "hidden xl:flex" : ""}>
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
								<FieldGroup>
									<Button
										type="button"
										variant="outline"
										className="self-start xl:hidden"
										onClick={() => setMobileEdit(false)}
									>
										返回评分目录
									</Button>
									<Field>
										<FieldLabel htmlFor="node-name">模块名称</FieldLabel>
										<Input
											id="node-name"
											value={node.name}
											disabled={!editable}
											onChange={(e) => update("name", e.target.value)}
											maxLength={80}
										/>
									</Field>
									<div className="grid gap-5 sm:grid-cols-2">
										<Field>
											<FieldLabel htmlFor="node-order">同级显示顺序</FieldLabel>
											<Input
												id="node-order"
												type="number"
												min={0}
												max={100000}
												step={1}
												value={node.order}
												disabled={!editable}
												onChange={(e) =>
													update("order", Number(e.target.value))
												}
											/>
										</Field>
										{node.parentId && (
											<Field>
												<FieldLabel htmlFor="node-parent">上级模块</FieldLabel>
												<NativeSelect
													id="node-parent"
													value={node.parentId}
													disabled={!editable}
													onChange={(e) => update("parentId", e.target.value)}
												>
													{scheme.nodes
														.filter(
															(item) =>
																["SUM", "WEIGHTED"].includes(item.kind) &&
																!descendants.has(item.id),
														)
														.map((item) => (
															<NativeSelectOption key={item.id} value={item.id}>
																{item.name}
															</NativeSelectOption>
														))}
												</NativeSelect>
											</Field>
										)}
									</div>
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
											{Object.entries(kinds).map(([value, label]) => (
												<NativeSelectOption key={value} value={value}>
													{label}
												</NativeSelectOption>
											))}
										</NativeSelect>
									</Field>
									{node.parentId &&
										scheme.nodes.find((n) => n.id === node.parentId)?.kind ===
											"WEIGHTED" && (
											<Field>
												<FieldLabel htmlFor="node-weight">
													占上级比例（%）
												</FieldLabel>
												<Input
													id="node-weight"
													type="number"
													step="any"
													defaultValue={Rational.from(node.weight)
														.mul(Rational.from("100"))
														.fixed()}
													key={`${node.id}-weight`}
													disabled={!editable}
													onBlur={(e) => {
														try {
															update(
																"weight",
																Rational.from(e.target.value)
																	.div(Rational.from("100"))
																	.fixed(12),
															);
														} catch {
															setError("请输入有效比例");
														}
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
												<FieldLabel htmlFor={`node-${key}`}>{label}</FieldLabel>
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
													["minimum", "原始分下限"],
													["maximum", "原始分上限"],
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
									<Field>
										<FieldLabel htmlFor="node-normalize">满分折算</FieldLabel>
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
								</FieldGroup>
							</CardContent>
							{editable && node.parentId && (
								<CardFooter className="border-t">
									<Button
										variant="outline"
										onClick={() => {
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
										}}
									>
										<Trash2 data-icon="inline-start" />
										删除模块
									</Button>
								</CardFooter>
							)}
						</Card>
					</div>
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
							{scheme.deductions.map((d, index) => (
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
														p.id === d.id ? { ...p, name: e.target.value } : p,
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
							))}
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
									填入原始分与扣分额核对当前方案，试算不会保存学生成绩。
								</CardDescription>
							</CardHeader>
							<CardContent>
								<form
									className="flex flex-col gap-5"
									onSubmit={async (e) => {
										e.preventDefault();
										if (busy) return;
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
