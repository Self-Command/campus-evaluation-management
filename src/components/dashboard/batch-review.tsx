"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import type { DataTableFeatures } from "@/lib/data-table-features";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Separator } from "@/components/ui/separator";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Feedback, requestJson } from "@/components/dashboard/feedback";

export type BatchRow = { id: string; revision: number };

export type BatchAction = {
	value: string;
	label: string;
	reason: "required" | "optional" | "none";
	reasonLabel?: string;
	reasonPlaceholder?: string;
	defaultReason?: string;
	description?: string;
	warning?: string;
	variant?: "default" | "outline" | "destructive";
};

export type BatchItemResult = {
	id: string;
	ok: boolean;
	revision?: number;
	status?: string;
	statusCode?: number;
	message?: string;
	notExecuted?: boolean;
};

export type BatchResponse = {
	batchId: string;
	action: string;
	requested: number;
	succeeded: number;
	failed: number;
	notExecuted: number;
	results: BatchItemResult[];
};

export type BatchSummary = {
	response: BatchResponse;
	labels: Record<string, string>;
};

export function useBatchReview<T extends BatchRow>({
	rows,
	isEligible,
	enabled,
	actions,
	url,
	termId,
	resetKey,
	rowLabel,
	onCompleted,
}: {
	rows: T[];
	isEligible: (row: T) => boolean;
	enabled: boolean;
	actions: BatchAction[];
	url: string;
	termId: string;
	resetKey?: string;
	rowLabel: (row: T) => string;
	onCompleted?: (summary: BatchSummary) => void;
}) {
	const [ids, setIds] = useState<string[]>([]);
	const [pending, setPending] = useState<BatchAction | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [summary, setSummary] = useState<BatchSummary | null>(null);
	const [viewKey, setViewKey] = useState(resetKey);

	if (viewKey !== resetKey) {
		setViewKey(resetKey);
		setIds([]);
		setPending(null);
		setSummary(null);
		setError("");
	}

	const eligible = useMemo(
		() => (enabled ? rows.filter(isEligible) : []),
		[enabled, rows, isEligible],
	);
	const selected = useMemo(
		() => eligible.filter((row) => ids.includes(row.id)),
		[eligible, ids],
	);
	const allSelected = eligible.length > 0 && selected.length === eligible.length;
	const canSelect = (row: T) => enabled && isEligible(row);
	const isSelected = (id: string) => ids.includes(id);

	function toggle(id: string) {
		if (busy) return;
		setIds((current) =>
			current.includes(id)
				? current.filter((value) => value !== id)
				: [...current, id],
		);
	}
	function toggleAll() {
		if (busy) return;
		const eligibleIds = eligible.map((row) => row.id);
		setIds((current) =>
			eligible.every((row) => current.includes(row.id))
				? current.filter((id) => !eligibleIds.includes(id))
				: [...new Set([...current, ...eligibleIds])],
		);
	}
	function clear() {
		if (!busy) setIds([]);
	}
	function choose(action: BatchAction) {
		if (busy || !selected.length) return;
		setError("");
		setPending(action);
	}
	async function confirm(reason?: string) {
		if (!pending || !selected.length || busy) return;
		setBusy(true);
		setError("");
		const action = pending;
		const labels = Object.fromEntries(
			selected.map((row) => [row.id, rowLabel(row)]),
		);
		const value = reason?.trim() || action.defaultReason;
		try {
			const response = await requestJson<BatchResponse>(url, {
				termId,
				batchId: crypto.randomUUID(),
				action: action.value,
				...(value ? { reason: value } : {}),
				items: selected.map((row) => ({
					id: row.id,
					revision: row.revision,
				})),
			});
			const next = { response, labels };
			setSummary(next);
			setPending(null);
			setIds([]);
			onCompleted?.(next);
		} catch (err) {
			setError((err as Error).message);
		} finally {
			setBusy(false);
		}
	}

	const checkboxColumn: ColumnDef<DataTableFeatures, T> | null =
		eligible.length > 0
			? {
					id: "batch-select",
					header: () => (
						<Checkbox
							aria-label="全选本页可批量处理的记录"
							checked={allSelected}
							disabled={busy}
							onCheckedChange={toggleAll}
						/>
					),
					cell: ({ row }) => {
						const selectable = canSelect(row.original);
						return (
							<Checkbox
								aria-label={
									selectable
										? `选择：${rowLabel(row.original)}`
										: "该记录当前不可批量处理"
								}
								checked={selectable && isSelected(row.original.id)}
								disabled={!selectable || busy}
								onCheckedChange={() => toggle(row.original.id)}
							/>
						);
					},
				}
			: null;

	const bar: ReactNode =
		eligible.length > 0 ? (
			<div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border bg-muted/30 px-3 py-2">
				<label className="flex cursor-pointer items-center gap-2 text-sm max-md:min-h-11">
					<Checkbox
						checked={allSelected}
						disabled={busy}
						onCheckedChange={toggleAll}
					/>
					全选本页
				</label>
				<Separator orientation="vertical" className="hidden h-5 sm:block" />
				<span className="text-sm text-muted-foreground">
					当前页可处理{" "}
					<span className="font-medium text-foreground tabular-nums">
						{eligible.length}
					</span>{" "}
					条 · 已选{" "}
					<span className="font-medium text-foreground tabular-nums">
						{selected.length}
					</span>{" "}
					条
				</span>
				<span className="hidden text-xs text-muted-foreground lg:inline">
					逐条处理，单条失败不影响其他记录
				</span>
				<div className="ms-auto flex flex-wrap items-center gap-2">
					{selected.length > 0 && (
						<Button
							size="sm"
							variant="ghost"
							disabled={busy}
							onClick={clear}
						>
							清空选择
						</Button>
					)}
					{actions.map((action) => (
						<Button
							key={action.value}
							size="sm"
							variant={action.variant ?? "outline"}
							disabled={!selected.length || busy}
							onClick={() => choose(action)}
						>
							{action.label}
						</Button>
					))}
				</div>
			</div>
		) : null;

	const failureRows = summary
		? summary.response.results.filter((item) => !item.ok)
		: [];

	const dialogs: ReactNode = (
		<>
			<Dialog
				open={!!pending}
				onOpenChange={(open) => {
					if (!open && !busy) {
						setPending(null);
						setError("");
					}
				}}
			>
				<DialogContent className="sm:max-w-lg">
					{pending && (
						<>
							<DialogHeader>
								<DialogTitle>{pending.label}</DialogTitle>
								<DialogDescription>
									已选择 {selected.length} 条记录。系统将逐条处理，单条失败不会影响其他记录。
								</DialogDescription>
							</DialogHeader>
							<Feedback error={error} />
							{pending.description && (
								<p className="text-sm text-muted-foreground">
									{pending.description}
								</p>
							)}
							<div className="max-h-36 overflow-y-auto rounded-lg border p-3">
								<p className="mb-1 text-xs text-muted-foreground">
									本次处理记录
								</p>
								{selected.map((row) => (
									<p key={row.id} className="truncate text-sm">
										{rowLabel(row)}
									</p>
								))}
							</div>
							{pending.warning && (
								<Alert>
									<AlertTitle>操作说明</AlertTitle>
									<AlertDescription>{pending.warning}</AlertDescription>
								</Alert>
							)}
							<form
								key={pending.value}
								className="flex flex-col gap-4"
								onSubmit={async (event) => {
									event.preventDefault();
									const data = new FormData(event.currentTarget);
									await confirm(String(data.get("reason") ?? ""));
								}}
							>
								{pending.reason !== "none" && (
									<Field>
										<FieldLabel htmlFor="batch-review-reason">
											{pending.reasonLabel ??
												(pending.reason === "required"
													? "操作理由"
													: "审核意见（选填）")}
										</FieldLabel>
										<Textarea
											id="batch-review-reason"
											name="reason"
											required={pending.reason === "required"}
											minLength={pending.reason === "required" ? 2 : undefined}
											maxLength={1000}
											rows={3}
											placeholder={pending.reasonPlaceholder}
										/>
										<FieldDescription>
											{pending.reason === "required"
												? "所选记录共用这一理由，并写入每条处理记录。"
												: pending.defaultReason
													? `可留空；留空时记录“${pending.defaultReason}”，并写入每条处理记录。`
													: "可留空；填写后会写入每条处理记录。"}
										</FieldDescription>
									</Field>
								)}
								<DialogFooter>
									<Button
										type="button"
										variant="outline"
										disabled={busy}
										onClick={() => {
											setPending(null);
											setError("");
										}}
									>
										取消
									</Button>
									<Button
										type="submit"
										variant={
											pending.variant === "destructive"
												? "destructive"
												: "default"
										}
										disabled={busy}
									>
										{busy ? "正在处理…" : `确认${pending.label}`}
									</Button>
								</DialogFooter>
							</form>
						</>
					)}
				</DialogContent>
			</Dialog>
			<Dialog
				open={!!summary}
				onOpenChange={(open) => {
					if (!open) setSummary(null);
				}}
			>
				<DialogContent className="sm:max-w-2xl">
					{summary && (
						<>
							<DialogHeader>
								<DialogTitle>
									{failureRows.length ? "批量处理结果" : "批量处理完成"}
								</DialogTitle>
								<DialogDescription>
									本批次共请求 {summary.response.requested} 条记录，列表已刷新。请核对以下处理结果。
								</DialogDescription>
							</DialogHeader>
							<div className="flex flex-wrap gap-2">
								<Badge variant="outline">
									成功 {summary.response.succeeded} 条
								</Badge>
								{summary.response.failed > 0 && (
									<Badge variant="destructive">
										失败 {summary.response.failed} 条
									</Badge>
								)}
								{summary.response.notExecuted > 0 && (
									<Badge variant="secondary">
										未执行 {summary.response.notExecuted} 条
									</Badge>
								)}
							</div>
							{failureRows.length > 0 && (
								<div className="max-h-64 overflow-y-auto rounded-lg border">
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>记录</TableHead>
												<TableHead>处理结果</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{failureRows.map((item) => (
												<TableRow key={item.id}>
													<TableCell className="max-w-56 whitespace-normal">
														{summary.labels[item.id] ?? item.id}
													</TableCell>
													<TableCell className="whitespace-normal text-muted-foreground">
														{item.notExecuted
															? "未执行：列表已变化，请刷新后重新勾选处理。"
															: item.message || "该记录未完成，请刷新后核对。"}
													</TableCell>
												</TableRow>
											))}
										</TableBody>
									</Table>
								</div>
							)}
							<DialogFooter>
								<Button onClick={() => setSummary(null)}>关闭</Button>
							</DialogFooter>
						</>
					)}
				</DialogContent>
			</Dialog>
		</>
	);

	return {
		enabled,
		eligibleCount: eligible.length,
		selectedCount: selected.length,
		canSelect,
		isSelected,
		toggle,
		toggleAll,
		clear,
		bar,
		checkboxColumn,
		dialogs,
	};
}
