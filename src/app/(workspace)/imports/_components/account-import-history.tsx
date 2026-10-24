"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle } from "lucide-react";
import type { DataTableFeatures } from "@/lib/data-table-features";
import type {
	ImportBatchDetail,
	ImportBatchSummary,
	ImportRowResult,
} from "@/lib/management-types";
import { dateText } from "@/lib/business-labels";
import { useRemote } from "@/components/dashboard/use-remote";
import { RemoteState } from "@/components/dashboard/remote-state";
import { Feedback, requestJson } from "@/components/dashboard/feedback";
import { TemplateDirectory } from "@/components/dashboard/template-directory";
import { RecordList } from "@/components/dashboard/record-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldLabel } from "@/components/ui/field";
import {
	NativeSelect,
	NativeSelectOption,
} from "@/components/ui/native-select";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";

type HistoryResponse = {
	items: ImportBatchSummary[];
	total: number;
	page: number;
	pageSize: number;
};
type TargetRole = ImportBatchSummary["targetRole"];
const roleLabels: Record<TargetRole, string> = {
	STUDENT: "学生",
	COUNSELOR: "辅导员",
	COLLEGE: "学院管理人员",
};
const rowStateLabels: Record<string, string> = {
	CREATED: "已创建",
	SKIPPED: "已跳过",
	ERROR: "未导入",
};
function shortId(id: string) {
	return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}
function batchTitle(batch: ImportBatchSummary) {
	return `${dateText(batch.createdAt)} · ${roleLabels[batch.targetRole]}`;
}

export function AccountImportHistory() {
	const params = useSearchParams();
	const [query, setQuery] = useState(params.get("q") || "");
	const [draft, setDraft] = useState(query);
	const [role, setRole] = useState<TargetRole | "">(
		(["STUDENT", "COUNSELOR", "COLLEGE"] as const).find(
			(value) => value === params.get("role"),
		) ?? "",
	);
	const [status, setStatus] = useState<"COMMITTED" | "REVOKED" | "">(
		params.get("status") === "REVOKED"
			? "REVOKED"
			: params.get("status") === "COMMITTED"
				? "COMMITTED"
				: "",
	);
	const [page, setPage] = useState(
		Math.max(1, Math.min(100000, Math.floor(Number(params.get("hpage")) || 1))),
	);
	const search = new URLSearchParams();
	if (query) search.set("q", query);
	if (role) search.set("role", role);
	if (status) search.set("status", status);
	search.set("page", String(page));
	const remote = useRemote<HistoryResponse>(
		`/api/admin/account-import/history?${search.toString()}`,
	);
	const [detailId, setDetailId] = useState<string | null>(null);
	const detail = useRemote<ImportBatchDetail>(
		detailId
			? `/api/admin/account-import/${encodeURIComponent(detailId)}`
			: null,
	);
	const [revokeOpen, setRevokeOpen] = useState(false);
	const [reason, setReason] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [success, setSuccess] = useState("");
	function updateLocation(
		nextQuery: string,
		nextRole: TargetRole | "",
		nextStatus: "COMMITTED" | "REVOKED" | "",
		nextPage: number,
	) {
		const next = new URLSearchParams({ kind: "accounts", view: "history" });
		if (nextQuery) next.set("q", nextQuery);
		if (nextRole) next.set("role", nextRole);
		if (nextStatus) next.set("status", nextStatus);
		if (nextPage > 1) next.set("hpage", String(nextPage));
		window.history.replaceState(null, "", `/imports?${next.toString()}`);
	}
	function openDetail(id: string) {
		setDetailId(id);
		setSuccess("");
	}
	function openRevoke(id: string) {
		setDetailId(id);
		setReason("");
		setError("");
		setSuccess("");
		setRevokeOpen(true);
	}
	async function submitRevoke() {
		if (!detail.data || busy) return;
		if (reason.trim().length < 2) {
			setError("请填写撤销理由");
			return;
		}
		setBusy(true);
		setError("");
		try {
			const result = await requestJson<{ revoked: number; missing: unknown[] }>(
				`/api/admin/account-import/${encodeURIComponent(detail.data.id)}/revoke`,
				{ reason: reason.trim() },
			);
			setRevokeOpen(false);
			setDetailId(null);
			setReason("");
			setSuccess(
				`已整批撤销该批次，删除 ${result.revoked} 个账号${
					result.missing.length
						? `，跳过 ${result.missing.length} 个已不存在的账号`
						: ""
				}。`,
			);
			remote.reload();
		} catch (err) {
			setError((err as Error).message);
		} finally {
			setBusy(false);
		}
	}
	const columns: ColumnDef<DataTableFeatures, ImportBatchSummary>[] = [
		{
			id: "batch",
			header: "批次",
			cell: ({ row }) => (
				<div className="min-w-0">
					<p className="font-mono text-xs text-muted-foreground">
						{shortId(row.original.id)}
					</p>
					<p className="mt-1 max-w-72 truncate text-sm">
						{row.original.note || "未填写本批说明"}
					</p>
				</div>
			),
		},
		{
			accessorKey: "createdAt",
			header: "导入时间",
			cell: ({ row }) => (
				<span className="whitespace-nowrap">
					{dateText(row.original.createdAt)}
				</span>
			),
		},
		{
			id: "actor",
			header: "操作人",
			cell: ({ row }) =>
				row.original.actor ? (
					<div>
						<p>{row.original.actor.name}</p>
						<p className="text-xs text-muted-foreground">
							{row.original.actor.login}
						</p>
					</div>
				) : (
					<span className="text-muted-foreground">账号已不存在</span>
				),
		},
		{
			id: "role",
			header: "导入角色",
			cell: ({ row }) => <Badge variant="outline">{roleLabels[row.original.targetRole]}</Badge>,
		},
		{
			id: "result",
			header: "处理结果",
			cell: ({ row }) => (
				<div className="text-sm">
					<p>新建 {row.original.created} 个</p>
					<p className="text-xs text-muted-foreground">
						跳过 {row.original.skipped} · 共 {row.original.rowCount} 行
					</p>
				</div>
			),
		},
		{
			id: "status",
			header: "状态",
			cell: ({ row }) => (
				<div className="flex flex-col gap-1">
					<Badge
						variant={row.original.status === "REVOKED" ? "secondary" : "default"}
					>
						{row.original.status === "REVOKED" ? "已撤销" : "已提交"}
					</Badge>
					{row.original.status === "REVOKED" && (
						<span className="max-w-48 whitespace-normal text-xs text-muted-foreground">
							{row.original.revokeReason || "未填写撤销理由"}
						</span>
					)}
				</div>
			),
		},
		{
			id: "actions",
			header: "操作",
			cell: ({ row }) => (
				<div className="flex flex-wrap gap-1">
					<Button
						variant="ghost"
						size="sm"
						onClick={() => openDetail(row.original.id)}
					>
						查看详情
					</Button>
					{row.original.status === "COMMITTED" && (
						<Button
							variant="ghost"
							size="sm"
							className="text-destructive hover:text-destructive"
							onClick={() => openRevoke(row.original.id)}
						>
							撤销批次
						</Button>
					)}
				</div>
			),
		},
	];
	const detailRows = detail.data?.rows ?? [];
	const detailColumns: ColumnDef<DataTableFeatures, ImportRowResult>[] = [
		{
			accessorKey: "line",
			header: "逻辑行",
			cell: ({ row }) => (
				<span className="tabular-nums">{row.original.line}</span>
			),
		},
		{
			id: "student",
			header: "登录账号 / 姓名",
			cell: ({ row }) => (
				<div>
					<p className="font-mono text-xs">{row.original.login || "—"}</p>
					<p className="text-sm">{row.original.name || "—"}</p>
				</div>
			),
		},
		{
			id: "organization",
			header: "学院 / 班级",
			cell: ({ row }) => (
				<div className="whitespace-normal text-sm">
					<p>{row.original.college || "—"}</p>
					<p className="text-xs text-muted-foreground">
						{row.original.className ||
							row.original.collegeCode ||
							row.original.major ||
							"—"}
					</p>
				</div>
			),
		},
		{
			id: "state",
			header: "结果",
			cell: ({ row }) => (
				<Badge
					variant={
						row.original.state === "ERROR"
							? "destructive"
							: row.original.state === "SKIPPED"
								? "secondary"
								: "default"
					}
				>
					{rowStateLabels[row.original.state] || row.original.state}
				</Badge>
			),
		},
		{
			accessorKey: "message",
			header: "说明",
			cell: ({ row }) => (
				<span className="block max-w-80 whitespace-normal break-words">
					{row.original.message}
				</span>
			),
		},
	];
	const revoke = detail.data?.revoke;
	const blockedAccounts =
		revoke?.accounts.filter((account) => account.blockers.length) ?? [];
	return (
		<>
			<Feedback success={success} />
			<RemoteState {...remote} />
			{remote.data && (
				<TemplateDirectory
					description={`共 ${remote.data.total} 个已提交或已撤销的批次。撤销会删除该批次创建且没有业务记录的账号；任一账号已有业务记录或身份变更时，整批不撤销。`}
					data={remote.data.items}
					columns={columns}
					empty={{
						title: "还没有导入记录",
						description: "完成一次账号导入后，可在本页核对结果或整批撤销。",
					}}
					filters={
						<form
							className="flex w-full flex-wrap items-end gap-3"
							onSubmit={(event) => {
								event.preventDefault();
								setQuery(draft.trim());
								setPage(1);
								updateLocation(draft.trim(), role, status, 1);
							}}
						>
							<Field className="w-full sm:w-64">
								<FieldLabel htmlFor="import-history-query">
									批次、说明或操作人
								</FieldLabel>
								<Input
									id="import-history-query"
									value={draft}
									maxLength={80}
									onChange={(event) => setDraft(event.target.value)}
									placeholder="输入批次号、说明、姓名或账号"
								/>
							</Field>
							<Field className="w-full sm:w-40">
								<FieldLabel htmlFor="import-history-role">角色</FieldLabel>
								<NativeSelect
									id="import-history-role"
									value={role}
									onChange={(event) => {
										const next = event.target.value as TargetRole | "";
										setRole(next);
										setPage(1);
										updateLocation(query, next, status, 1);
									}}
								>
									<NativeSelectOption value="">全部角色</NativeSelectOption>
									<NativeSelectOption value="STUDENT">学生</NativeSelectOption>
									<NativeSelectOption value="COUNSELOR">辅导员</NativeSelectOption>
									<NativeSelectOption value="COLLEGE">
										学院管理人员
									</NativeSelectOption>
								</NativeSelect>
							</Field>
							<Field className="w-full sm:w-36">
								<FieldLabel htmlFor="import-history-status">状态</FieldLabel>
								<NativeSelect
									id="import-history-status"
									value={status}
									onChange={(event) => {
										const next = event.target.value as
											| "COMMITTED"
											| "REVOKED"
											| "";
										setStatus(next);
										setPage(1);
										updateLocation(query, role, next, 1);
									}}
								>
									<NativeSelectOption value="">全部状态</NativeSelectOption>
									<NativeSelectOption value="COMMITTED">已提交</NativeSelectOption>
									<NativeSelectOption value="REVOKED">已撤销</NativeSelectOption>
								</NativeSelect>
							</Field>
							<Button type="submit" variant="outline">
								搜索
							</Button>
							<Button
								type="button"
								variant="ghost"
								onClick={() => {
									setDraft("");
									setQuery("");
									setRole("");
									setStatus("");
									setPage(1);
									updateLocation("", "", "", 1);
								}}
							>
								重置筛选
							</Button>
						</form>
					}
					pagination={{
						page: remote.data.page,
						total: remote.data.total,
						href: () => "/imports?kind=accounts&view=history",
						onPageChange: (next) => {
							setPage(next);
							updateLocation(query, role, status, next);
						},
					}}
					mobile={(row) => (
						<div className="flex flex-col gap-3">
							<div className="flex flex-wrap items-start justify-between gap-2">
								<div className="min-w-0">
									<p className="font-medium">
										{roleLabels[row.targetRole]} ·{" "}
										{dateText(row.createdAt)}
									</p>
									<p className="mt-1 break-words text-xs text-muted-foreground">
										{row.note || "未填写本批说明"}
									</p>
								</div>
								<Badge
									variant={row.status === "REVOKED" ? "secondary" : "default"}
								>
									{row.status === "REVOKED" ? "已撤销" : "已提交"}
								</Badge>
							</div>
							<p className="text-sm">
								新建 {row.created} 个 · 跳过 {row.skipped} · 共{" "}
								{row.rowCount} 行
							</p>
							<p className="text-xs text-muted-foreground">
								操作人 {row.actor ? `${row.actor.name}（${row.actor.login}）` : "账号已不存在"}
								{row.status === "REVOKED" && row.revokeReason
									? ` · 撤销理由：${row.revokeReason}`
									: ""}
							</p>
							<div className="flex flex-wrap gap-2">
								<Button
									variant="outline"
									size="sm"
									onClick={() => openDetail(row.id)}
								>
									查看详情
								</Button>
								{row.status === "COMMITTED" && (
									<Button
										variant="ghost"
										size="sm"
										className="text-destructive hover:text-destructive"
										onClick={() => openRevoke(row.id)}
									>
										撤销批次
									</Button>
								)}
							</div>
						</div>
					)}
				/>
			)}
			<Dialog
				open={!!detailId && !revokeOpen}
				onOpenChange={(open) => {
					if (!open) setDetailId(null);
				}}
			>
				<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
					<DialogHeader>
						<DialogTitle>批次详情</DialogTitle>
						<DialogDescription>
							{detail.data
								? `${batchTitle(detail.data)} · 批次 ${shortId(detail.data.id)}`
								: "正在读取批次记录…"}
						</DialogDescription>
					</DialogHeader>
					{detail.error && <Feedback error={detail.error} />}
					{detail.loading && (
						<p className="text-sm text-muted-foreground">正在读取批次记录…</p>
					)}
					{detail.data && (
						<div className="flex flex-col gap-5">
							<div className="grid gap-4 rounded-lg border bg-muted/30 p-4 sm:grid-cols-2 lg:grid-cols-4">
								{[
									["导入角色", roleLabels[detail.data.targetRole]],
									[
										"状态",
										detail.data.status === "REVOKED"
											? "已整批撤销"
											: "已提交",
									],
									[
										"操作人",
										detail.data.actor
											? `${detail.data.actor.name}（${detail.data.actor.login}）`
											: "账号已不存在",
									],
									[
										"提交时间",
										detail.data.committedAt
											? dateText(detail.data.committedAt)
											: dateText(detail.data.createdAt),
									],
									["新建账号", `${detail.data.created} 个`],
									["跳过", `${detail.data.skipped} 行`],
									["总行数", `${detail.data.rowCount} 行`],
									[
										"本批说明",
										detail.data.note || "未填写",
									],
								].map(([label, value]) => (
									<div key={label} className="flex flex-col gap-1">
										<span className="text-xs text-muted-foreground">
											{label}
										</span>
										<span className="break-words text-sm">{value}</span>
									</div>
								))}
							</div>
							{detail.data.status === "REVOKED" && (
								<div className="rounded-lg border bg-muted/30 p-4 text-sm">
									<p className="font-medium">该批次已整批撤销</p>
									<p className="mt-1 text-muted-foreground">
										{detail.data.revokedAt
											? `${dateText(detail.data.revokedAt)} 撤销`
											: "撤销时间未记录"}
										：{detail.data.revokeReason || "未填写撤销理由"}
									</p>
								</div>
							)}
							<RecordList
								data={detailRows}
								columns={detailColumns}
								searchText={(row) =>
									`${row.line} ${row.login} ${row.name} ${row.college} ${row.className} ${row.message}`
								}
								searchPlaceholder="按行号、账号、姓名或说明搜索"
								tabs={[
									{
										value: "all",
										label: `全部 ${detailRows.length}`,
										match: () => true,
									},
									{
										value: "created",
										label: `已创建 ${detailRows.filter((row) => row.state === "CREATED").length}`,
										match: (row) => row.state === "CREATED",
									},
									{
										value: "skipped",
										label: `已跳过 ${detailRows.filter((row) => row.state === "SKIPPED").length}`,
										match: (row) => row.state === "SKIPPED",
									},
								]}
								emptyTitle="没有匹配的记录"
								emptyDescription="请调整搜索或切换全部、已创建与已跳过。"
							/>
							{detail.data.status === "COMMITTED" && (
								<div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
									<div className="text-sm text-muted-foreground">
										{detail.data.revoke.canRevoke
											? "该批次创建的账号目前没有业务记录，可以整批撤销。"
											: detail.data.revoke.reason ||
												"该批次不能整批撤销，请核对账号状态。"}
									</div>
									{detail.data.revoke.canRevoke && (
										<Button
											variant="destructive"
											onClick={() => openRevoke(detail.data!.id)}
										>
											撤销本批账号
										</Button>
									)}
								</div>
							)}
						</div>
					)}
				</DialogContent>
			</Dialog>
			<Dialog
				open={revokeOpen}
				onOpenChange={(open) => {
					if (!open && !busy) setRevokeOpen(false);
				}}
			>
				<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
					<DialogHeader>
						<DialogTitle>整批撤销账号导入？</DialogTitle>
						<DialogDescription>
							撤销会删除该批次创建、且没有业务记录的账号及其学籍档案和登录会话。任一账号已有成绩、申报、参与、审核或身份变更时，整批都不会撤销。
						</DialogDescription>
					</DialogHeader>
					{detail.error && <Feedback error={detail.error} />}
					{detail.loading && (
						<p className="text-sm text-muted-foreground">正在检查可撤销账号…</p>
					)}
					{detail.data && revoke && (
						<div className="flex flex-col gap-4">
							{detail.data.status === "REVOKED" ? (
								<div className="rounded-lg border bg-muted/30 p-4 text-sm">
									<p className="font-medium">该批次已撤销</p>
									<p className="mt-1 text-muted-foreground">
										{detail.data.revokeReason || "未填写撤销理由"}
									</p>
								</div>
							) : (
								<>
									<div className="flex flex-col gap-2 rounded-lg border p-4">
										<p className="text-sm font-medium">
											{blockedAccounts.length > 0
												? `本批共 ${revoke.accounts.length} 个账号，其中 ${blockedAccounts.length} 个暂时不能撤销`
												: revoke.accounts.length > 0
													? `本批共 ${revoke.accounts.length} 个账号，可整批撤销`
													: "该批次没有可撤销的账号"}
										</p>
										{revoke.accounts.length ? (
											<ul className="flex flex-col gap-2 text-sm">
												{revoke.accounts.map((account) => (
													<li
														key={`${account.line}-${account.login}`}
														className="flex flex-wrap items-start justify-between gap-2"
													>
														<span>
															第{account.line}行 · {account.name}（
															{account.login}）
														</span>
														{account.blockers.length ? (
															<span className="text-xs text-destructive">
																{account.blockers
																	.map(
																		(blocker) =>
																			`${blocker.label} ${blocker.count}`,
																	)
																	.join("、")}
															</span>
														) : (
															<Badge variant="outline">可删除</Badge>
														)}
													</li>
												))}
											</ul>
										) : (
											<p className="text-sm text-muted-foreground">
												该批次没有记录到已创建的账号。
											</p>
										)}
										{revoke.missing.length > 0 && (
											<p className="text-xs text-muted-foreground">
												另有 {revoke.missing.length}{" "}
												个账号已不存在，撤销时会自动跳过：
												{revoke.missing
													.map((item) => `${item.login}（${item.name}）`)
													.join("、")}
											</p>
										)}
									</div>
									{blockedAccounts.length > 0 && (
										<div className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
											<p className="flex items-center gap-2 text-sm font-medium text-destructive">
												<AlertTriangle className="size-4" />
												暂时不能整批撤销
											</p>
											<p className="text-sm text-muted-foreground">
												{revoke.reason ||
													"部分账号已有业务记录或身份已变更，请先在账号管理中单独处理。"}
											</p>
										</div>
									)}
									{revoke.canRevoke && (
										<Field>
											<FieldLabel htmlFor="import-revoke-reason">
												撤销理由
											</FieldLabel>
											<Textarea
												id="import-revoke-reason"
												value={reason}
												onChange={(event) => setReason(event.target.value)}
												required
												minLength={2}
												maxLength={500}
												rows={3}
												placeholder="说明为什么撤销本批导入，将写入审计记录"
											/>
										</Field>
									)}
								</>
							)}
							<Feedback error={error} />
							<DialogFooter>
								<Button
									type="button"
									variant="outline"
									disabled={busy}
									onClick={() => setRevokeOpen(false)}
								>
									取消
								</Button>
								{detail.data.status === "COMMITTED" && revoke.canRevoke && (
									<Button
										type="button"
										variant="destructive"
										disabled={busy || reason.trim().length < 2}
										onClick={() => void submitRevoke()}
									>
										{busy ? "正在撤销…" : "确认整批撤销"}
									</Button>
								)}
							</DialogFooter>
						</div>
					)}
				</DialogContent>
			</Dialog>
		</>
	);
}
