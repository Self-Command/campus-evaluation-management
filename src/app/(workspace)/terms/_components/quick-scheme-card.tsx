"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, RotateCcw, Settings2, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Feedback, requestJson } from "@/components/dashboard/feedback";
import { useUnsavedChanges } from "@/components/dashboard/use-unsaved-changes";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { validateScheme } from "@/lib/scoring/validate";
import type { Scheme, ScoringNode } from "@/lib/scoring/types";
import {
	applyQuickSettings,
	developmentCapTotal,
	quickSchemeLayout,
	quickSettingsIssues,
	schoolQuickSettings,
	settingsFromScheme,
	type QuickSchemeSettings,
} from "@/lib/scoring/quick-config";
import { phaseLabels } from "@/lib/business-labels";

type Term = {
	id: string;
	name: string;
	phase: string;
	revision: number;
	disposition?: string;
	scheme: Scheme;
};

function leafNames(nodes: ScoringNode[]) {
	return nodes.map((node) => node.name).join("、");
}

function ValueOrEditor({
	editing,
	value,
	suffix,
	label,
	onChange,
	inputClassName = "w-20",
}: {
	editing: boolean;
	value: string;
	suffix: string;
	label: string;
	onChange: (value: string) => void;
	inputClassName?: string;
}) {
	if (!editing) {
		return (
			<span className="font-medium tabular-nums">
				{value || "—"}
				{suffix}
			</span>
		);
	}
	return (
		<label className="flex items-center gap-2 text-sm">
			<Input
				aria-label={label}
				value={value}
				inputMode="decimal"
				onChange={(event) => onChange(event.target.value)}
				className={`${inputClassName} text-right tabular-nums`}
			/>
			<span className="text-muted-foreground">{suffix}</span>
		</label>
	);
}

export function QuickSchemeCard({
	term,
	admin,
	editable,
	returnHref = "/terms",
	onAdvanced,
}: {
	term: Term;
	admin: boolean;
	editable: boolean;
	returnHref?: string;
	onAdvanced: () => void;
}) {
	const router = useRouter();
	const initialLayout = quickSchemeLayout(term.scheme);
	const [scheme, setScheme] = useState(term.scheme);
	const [revision, setRevision] = useState(term.revision);
	const [settings, setSettings] = useState<QuickSchemeSettings>(() =>
		initialLayout
			? settingsFromScheme(initialLayout)
			: {
					foundationWeight: "",
					developmentWeight: "",
					redCultureWeight: "",
					redCultureCap: "",
					academicWeight: "",
					physicalWeight: "",
					volunteeringCap: "",
					humanitiesCap: "",
					craftsmanshipCap: "",
					deductionCoefficient: "",
				},
	);
	const [baseline, setBaseline] = useState(settings);
	const [editing, setEditing] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [success, setSuccess] = useState("");

	const layout = quickSchemeLayout(scheme);
	const dirty = editing && JSON.stringify(settings) !== JSON.stringify(baseline);
	useUnsavedChanges(dirty);

	if (!layout) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>评分方案</CardTitle>
					<CardDescription>
						当前方案不是学校评分卡结构，请使用高级结构编辑查看和调整。
					</CardDescription>
				</CardHeader>
				<CardFooter>
					<Button onClick={onAdvanced}>进入高级结构编辑</Button>
				</CardFooter>
			</Card>
		);
	}

	const issues = quickSettingsIssues(layout, settings);
	let validationError = "";
	if (issues.length === 0) {
		try {
			validateScheme(applyQuickSettings(scheme, layout, settings));
		} catch {
			validationError =
				"当前方案还有未完成的高级设置，请进入高级结构编辑核对后再开启申报。";
		}
	}
	const valid = issues.length === 0 && !validationError;
	const baseTotal = (() => {
		const values = ["redCultureWeight", "academicWeight", "physicalWeight"].map(
			(key) => Number(settings[key as keyof QuickSchemeSettings]),
		);
		if (values.some((value) => !Number.isFinite(value))) return null;
		return values.reduce((sum, value) => sum + value, 0);
	})();
	const capTotal = developmentCapTotal(settings);

	function update(key: keyof QuickSchemeSettings, value: string) {
		setSettings((previous) => ({ ...previous, [key]: value }));
		setError("");
		setSuccess("");
	}

	function startEdit() {
		const next = settingsFromScheme(layout!);
		setSettings(next);
		setBaseline(next);
		setEditing(true);
		setError("");
		setSuccess("");
	}

	function cancelEdit() {
		setSettings(baseline);
		setEditing(false);
		setError("");
		setSuccess("");
	}

	function restoreTemplate() {
		setSettings(schoolQuickSettings());
		setEditing(true);
		setError("");
		setSuccess("已填入学校模板数值，保存后生效。");
	}

	async function save(activate: boolean) {
		if (busy || !layout) return;
		if (issues.length > 0 || validationError) {
			setError(
				validationError ||
					"请先修正上面的分值，再保存或开启申报。",
			);
			return;
		}
		if (
			activate &&
			!window.confirm(
				"开启后评分方案将生效，当前配置不能直接修改。确认开启申报？",
			)
		)
			return;
		let next: Scheme;
		try {
			next = applyQuickSettings(scheme, layout, settings);
		} catch (err) {
			setError((err as Error).message);
			return;
		}
		setBusy(true);
		setError("");
		try {
			let nextRevision = revision;
			const needsSave = editing || JSON.stringify(settings) !== JSON.stringify(baseline);
			if (needsSave) {
				const saved = await requestJson<{ revision: number; scheme: Scheme }>(
					`/api/terms/${term.id}/scheme`,
					{ action: "save", revision, scheme: next },
				);
				nextRevision = saved.revision;
				setRevision(saved.revision);
				setScheme(saved.scheme ?? next);
				setBaseline(settings);
				setEditing(false);
			}
			if (activate) {
				const activated = await requestJson<{ revision: number }>(
					`/api/terms/${term.id}/scheme`,
					{ action: "activate", revision: nextRevision },
				);
				setRevision(activated.revision);
			}
			toast.add({
				type: "success",
				title: activate ? "评分方案已开启申报" : "评分方案已保存",
				description: activate
					? "新的评分方案已生效，现在可以录入和审核。"
					: "新的占比和最高分已生效。",
			});
			setSuccess(
				activate
					? "评分方案已保存，并已开启申报。"
					: "评分方案已保存。",
			);
			router.refresh();
		} catch (err) {
			setError((err as Error).message);
		} finally {
			setBusy(false);
		}
	}

	function openAdvanced() {
		if (
			dirty &&
			!window.confirm("有尚未保存的分值调整，是否放弃并进入高级结构编辑？")
		)
			return;
		setEditing(false);
		onAdvanced();
	}

	const editAction = editable && !editing && (
		<Button variant="outline" onClick={startEdit} disabled={busy}>
			<Settings2 data-icon="inline-start" />
			调整分值
		</Button>
	);

	return (
		<div className="flex flex-col gap-4" data-testid="quick-scheme-card">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex flex-wrap items-center gap-2">
					<Badge variant="outline">{phaseLabels[term.phase]}</Badge>
					<span className="text-xs text-muted-foreground">
						评分方案版本 {revision}
					</span>
					<span className="text-xs text-muted-foreground">
						· 学校评分模板
					</span>
				</div>
				<div className="flex flex-wrap gap-2">
					{editAction}
					<Button variant="outline" onClick={openAdvanced} disabled={busy}>
						<SlidersHorizontal data-icon="inline-start" />
						{admin ? "高级结构编辑" : "查看完整规则"}
					</Button>
					<Link
						href={returnHref}
						className={buttonVariants({ variant: "outline" })}
					>
						返回周期
					</Link>
				</div>
			</div>

			<Feedback error={error} success={success} />

			<Card>
				<CardHeader className="border-b">
					<div className="flex flex-wrap items-start justify-between gap-3">
						<div className="flex flex-col gap-1">
							<CardTitle className="text-xl">综合测评成绩</CardTitle>
							<CardDescription>
								学校评分卡 · 满分 100 分 · 只需调整各部分的占比和最高分
							</CardDescription>
						</div>
						<Badge variant={valid ? "outline" : "destructive"}>
							{valid ? (
								<>
									<Check data-icon="inline-start" />
									配置完成
								</>
							) : (
								`${issues.length + (validationError ? 1 : 0)} 处待处理`
							)}
						</Badge>
					</div>
				</CardHeader>

				<CardContent className="flex flex-col gap-5 pt-5">
					{!valid && (
						<div className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
							{issues.map((issue) => (
								<p key={issue}>{issue}</p>
							))}
							{validationError && <p>{validationError}</p>}
						</div>
					)}

					<div className="rounded-lg border bg-muted/30">
						<div className="flex items-center justify-between gap-3 border-b px-4 py-3">
							<div>
								<p className="font-medium">总分构成</p>
								<p className="text-xs text-muted-foreground">
									基础性素质和发展性素质合计占总分 100%
								</p>
							</div>
							<Badge variant="outline">满分 100</Badge>
						</div>
						<div className="grid gap-4 p-4 sm:grid-cols-2">
							<div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-background px-3 py-2">
								<span className="font-medium">基础性素质</span>
								<div className="flex items-center gap-2 text-sm">
									<span className="text-muted-foreground">占总分</span>
									<ValueOrEditor
										editing={editing}
										value={settings.foundationWeight}
										suffix="%"
										label="基础性素质占总分比例"
										onChange={(value) => update("foundationWeight", value)}
									/>
								</div>
							</div>
							<div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-background px-3 py-2">
								<span className="font-medium">发展性素质</span>
								<div className="flex items-center gap-2 text-sm">
									<span className="text-muted-foreground">占总分</span>
									<ValueOrEditor
										editing={editing}
										value={settings.developmentWeight}
										suffix="%"
										label="发展性素质占总分比例"
										onChange={(value) => update("developmentWeight", value)}
									/>
								</div>
							</div>
						</div>
					</div>

					<section className="overflow-hidden rounded-lg border">
						<div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/30 px-4 py-3">
							<div>
								<p className="font-medium">基础性素质</p>
								<p className="text-xs text-muted-foreground">
									红色文化、学业成绩、体育素质按占比计入
								</p>
							</div>
							<div className="flex items-center gap-2 text-sm">
								<span className="text-muted-foreground">占总分</span>
								<span className="font-medium tabular-nums">
									{settings.foundationWeight || "—"}%
								</span>
							</div>
						</div>
						<div className="divide-y">
							<div className="flex flex-col gap-3 px-4 py-3">
								<div className="flex flex-wrap items-center justify-between gap-3">
									<div>
										<p className="font-medium">红色文化引领工程</p>
										<p className="text-xs text-muted-foreground">
											{layout.redCultureLeaves.length} 项活动累计，最多{" "}
											{settings.redCultureCap || "不限"} 分
										</p>
									</div>
									<div className="flex flex-wrap items-center gap-4 text-sm">
										<div className="flex items-center gap-2">
											<span className="text-muted-foreground">占基础性素质</span>
											<ValueOrEditor
												editing={editing}
												value={settings.redCultureWeight}
												suffix="%"
												label="红色文化引领工程占基础性素质比例"
												onChange={(value) => update("redCultureWeight", value)}
											/>
										</div>
										{editing && (
											<label className="flex items-center gap-2">
												<span className="text-muted-foreground">最多</span>
												<Input
													aria-label="红色文化引领工程最高分"
													value={settings.redCultureCap}
													inputMode="decimal"
													placeholder="不限"
													onChange={(event) =>
														update("redCultureCap", event.target.value)
													}
													className="w-20 text-right tabular-nums"
												/>
												<span className="text-muted-foreground">分</span>
											</label>
										)}
									</div>
								</div>
								<p className="text-xs text-muted-foreground">
									{leafNames(layout.redCultureLeaves)}
								</p>
							</div>

							<div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
								<div>
									<p className="font-medium">学业成绩</p>
									<p className="text-xs text-muted-foreground">辅导员直接录入</p>
								</div>
								<div className="flex items-center gap-2 text-sm">
									<span className="text-muted-foreground">占基础性素质</span>
									<ValueOrEditor
										editing={editing}
										value={settings.academicWeight}
										suffix="%"
										label="学业成绩占基础性素质比例"
										onChange={(value) => update("academicWeight", value)}
									/>
								</div>
							</div>

							<div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
								<div>
									<p className="font-medium">体育素质</p>
									<p className="text-xs text-muted-foreground">辅导员直接录入</p>
								</div>
								<div className="flex items-center gap-2 text-sm">
									<span className="text-muted-foreground">占基础性素质</span>
									<ValueOrEditor
										editing={editing}
										value={settings.physicalWeight}
										suffix="%"
										label="体育素质占基础性素质比例"
										onChange={(value) => update("physicalWeight", value)}
									/>
								</div>
							</div>
						</div>
						<div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/20 px-4 py-2 text-sm">
							<span className="text-muted-foreground">三项合计</span>
							<span
								className={
									baseTotal === 100
										? "font-medium text-emerald-600 dark:text-emerald-400"
										: "font-medium text-destructive"
								}
							>
								{baseTotal === null ? "待填写" : `${baseTotal}%`}
							</span>
						</div>
					</section>

					<section className="overflow-hidden rounded-lg border">
						<div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/30 px-4 py-3">
							<div>
								<p className="font-medium">发展性素质</p>
								<p className="text-xs text-muted-foreground">
									三项工程分别累计，达到最高分后按最高分计入
								</p>
							</div>
							<div className="flex items-center gap-2 text-sm">
								<span className="text-muted-foreground">占总分</span>
								<span className="font-medium tabular-nums">
									{settings.developmentWeight || "—"}%
								</span>
							</div>
						</div>
						<div className="divide-y">
							{[
								{
									key: "volunteeringCap" as const,
									name: "志愿服务实践工程",
									leaves: layout.volunteeringLeaves,
								},
								{
									key: "humanitiesCap" as const,
									name: "人文素质提升工程",
									leaves: layout.humanitiesLeaves,
								},
								{
									key: "craftsmanshipCap" as const,
									name: "卓越工匠培养工程",
									leaves: layout.craftsmanshipLeaves,
								},
							].map((item) => (
								<div key={item.key} className="flex flex-col gap-3 px-4 py-3">
									<div className="flex flex-wrap items-center justify-between gap-3">
										<div>
											<p className="font-medium">{item.name}</p>
											<p className="text-xs text-muted-foreground">
												{item.leaves.length} 项活动累计
											</p>
										</div>
										<div className="flex items-center gap-2 text-sm">
											<span className="text-muted-foreground">最多</span>
											{editing ? (
												<label className="flex items-center gap-2">
													<Input
														aria-label={`${item.name}最高分`}
														value={settings[item.key]}
														inputMode="decimal"
														placeholder="不限"
														onChange={(event) => update(item.key, event.target.value)}
														className="w-20 text-right tabular-nums"
													/>
													<span className="text-muted-foreground">分</span>
												</label>
											) : (
												<span className="font-medium tabular-nums">
													{settings[item.key] || "不限"} 分
												</span>
											)}
										</div>
									</div>
									<p className="text-xs text-muted-foreground">
										{leafNames(item.leaves)}
									</p>
								</div>
							))}
						</div>
						<div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/20 px-4 py-2 text-sm">
							<span className="text-muted-foreground">三项最高分合计</span>
							<span className="font-medium tabular-nums">
								{capTotal === null ? "待填写" : `${capTotal} 分`}
							</span>
						</div>
					</section>

					<section className="overflow-hidden rounded-lg border">
						<div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/30 px-4 py-3">
							<div>
								<p className="font-medium">扣分</p>
								<p className="text-xs text-muted-foreground">
									按登记分值乘以扣分比例，从总分中扣除
								</p>
							</div>
							<Badge variant="outline">单独扣除</Badge>
						</div>
						<div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
							<div>
								<p className="font-medium">
									{layout.deduction?.name || "当前方案未设置扣分项目"}
								</p>
								<p className="text-xs text-muted-foreground">
									{layout.deduction
										? "由辅导员或管理员登记扣分"
										: "如需扣分项目，请进入高级结构编辑"}
								</p>
							</div>
							{layout.deduction && (
								<div className="flex items-center gap-2 text-sm">
									<span className="text-muted-foreground">扣分比例</span>
									<ValueOrEditor
										editing={editing}
										value={settings.deductionCoefficient}
										suffix="%"
										label="法制与校规校纪扣分比例"
										onChange={(value) =>
											update("deductionCoefficient", value)
										}
									/>
								</div>
							)}
						</div>
					</section>

					{capTotal !== null && capTotal !== "100" && (
						<p className="text-xs text-muted-foreground">
							提示：三项工程最高分合计为 {capTotal} 分，发展性素质的最高满分为{" "}
							{capTotal} 分。
						</p>
					)}
				</CardContent>

				<CardFooter className="flex flex-wrap items-center justify-between gap-3">
					<div className="flex items-center gap-2 text-xs text-muted-foreground">
						<ShieldCheck className="size-3.5" />
						<span>总分 = 基础性素质 + 发展性素质 − 扣分</span>
					</div>
					{editable && (
						<div className="flex flex-wrap gap-2">
							{editing ? (
								<>
									<Button
										variant="outline"
										onClick={restoreTemplate}
										disabled={busy}
									>
										<RotateCcw data-icon="inline-start" />
										恢复模板数值
									</Button>
									<Button variant="outline" onClick={cancelEdit} disabled={busy}>
										取消
									</Button>
									<Button onClick={() => void save(false)} disabled={busy}>
										{busy ? "正在保存…" : "保存调整"}
									</Button>
									<Button
										onClick={() => void save(true)}
										disabled={busy || !valid}
									>
										保存并开启
									</Button>
								</>
							) : (
								<Button onClick={() => void save(true)} disabled={busy || !valid}>
									开启申报
								</Button>
							)}
						</div>
					)}
				</CardFooter>
			</Card>
		</div>
	);
}
