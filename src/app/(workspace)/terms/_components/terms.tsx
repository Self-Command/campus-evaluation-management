"use client";
// Complete selected template users directory, profile details and invoice field groups.
import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import type { DataTableFeatures } from "@/lib/data-table-features";
import { TemplateDirectory } from "@/components/dashboard/template-directory";
import { useRemote } from "@/components/dashboard/use-remote";
import { RemoteState } from "@/components/dashboard/remote-state";
import { useUnsavedChanges } from "@/components/dashboard/use-unsaved-changes";
import { Feedback, requestJson } from "@/components/dashboard/feedback";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogDescription,
} from "@/components/ui/dialog";
import { phaseLabels, dateText } from "@/lib/business-labels";
export type TermRow = {
	id: string;
	name: string;
	phase: string;
	revision: number;
	createdAt: string;
	scheme: { nodes: unknown[] };
	disposition?: string;
	dispositionReason?: string | null;
	dispositionAt?: string | null;
};
type Management = TermRow & {
	usage: Record<string, number>;
	canDelete: boolean;
	canVoid: boolean;
	canArchive: boolean;
};
type Action =
	| "rename"
	| "delete"
	| "restore"
	| "void"
	| "archive"
	| "unarchive";
const viewLabels = {
	normal: "正常周期",
	archived: "已归档",
	void: "已作废",
	deleted: "回收站",
	all: "全部周期",
};
const dispositionLabels: Record<string, string> = {
	NORMAL: "正常",
	ARCHIVED: "已归档",
	VOID: "已作废",
	DELETED: "回收站",
};
const actions: Record<Action, string> = {
	rename: "修改名称",
	delete: "移入回收站",
	restore: "恢复周期",
	void: "作废周期",
	archive: "归档周期",
	unarchive: "取消归档",
};
const usageLabels: Record<string, string> = {
	activities: "活动",
	projects: "历史申报项目",
	claims: "成果申报",
	grades: "成绩记录",
	deductions: "扣分记录",
	imports: "导入批次",
	publications: "结果发布",
	snapshots: "结算存档",
	appeals: "成绩异议",
	reopenings: "重开记录",
	corrections: "计分更正",
};
export function Terms({
	terms,
	sources = terms,
	admin,
	create = false,
	view = "normal",
}: {
	terms: TermRow[];
	sources?: TermRow[];
	admin: boolean;
	create?: boolean;
	view?: keyof typeof viewLabels;
}) {
	const router = useRouter();
	const params = useSearchParams();
	const remote = useRemote<TermRow[]>(`/api/terms?view=${view}`, terms);
	const query = (params.get("q") || "").slice(0, 80);
	const page = Math.max(
		1,
		Math.min(100000, Math.floor(Number(params.get("page")) || 1)),
	);
	const filtered = (remote.data || []).filter(
		(t) => !query || t.name.toLowerCase().includes(query.toLowerCase()),
	);
	const currentPage = Math.min(
		page,
		Math.max(1, Math.ceil(filtered.length / 20)),
	);
	const [open, setOpen] = useState(create && admin);
	const [source, setSource] = useState("");
	const [target, setTarget] = useState<TermRow | null>(null);
	const [action, setAction] = useState<Action>("rename");
	const details = useRemote<Management>(
		target ? `/api/terms/${target.id}` : null,
	);
	const [busy, setBusy] = useState(false);
	const [dirty, setDirty] = useState(false);
	const [error, setError] = useState("");
	const [success, setSuccess] = useState("");
	useUnsavedChanges(dirty || busy);
	function href(next: number) {
		return `/terms?${new URLSearchParams({ view, q: query, page: String(next) })}`;
	}
	function termHref(t: TermRow) {
		return `/terms/${t.id}?returnTo=${encodeURIComponent(href(currentPage))}`;
	}
	function manage(t: TermRow) {
		details.reload();
		setTarget(t);
		setAction(
			t.disposition === "DELETED"
				? "restore"
				: t.disposition === "ARCHIVED"
					? "unarchive"
					: "rename",
		);
		setError("");
		setDirty(false);
	}
	function allowed(d: Management, a: Action) {
		return a === "rename"
			? d.disposition !== "DELETED"
			: a === "restore"
				? d.disposition === "DELETED"
				: a === "unarchive"
					? d.disposition === "ARCHIVED"
					: a === "delete"
						? d.canDelete
						: a === "void"
							? d.canVoid
							: d.canArchive;
	}
	const columns: ColumnDef<DataTableFeatures, TermRow>[] = [
		{
			accessorKey: "name",
			header: "测评周期",
			cell: ({ row }) =>
				row.original.disposition === "DELETED" ? (
					<span className="font-medium">{row.original.name}</span>
				) : (
					<Link
						href={termHref(row.original)}
						className="font-medium hover:underline"
					>
						{row.original.name}
					</Link>
				),
		},
		{
			accessorKey: "phase",
			header: "业务阶段",
			cell: ({ row }) => (
				<Badge variant="outline">{phaseLabels[row.original.phase]}</Badge>
			),
		},
		{
			id: "disposition",
			header: "管理状态",
			cell: ({ row }) => (
				<Badge
					variant={
						row.original.disposition && row.original.disposition !== "NORMAL"
							? "secondary"
							: "outline"
					}
				>
					{dispositionLabels[row.original.disposition || "NORMAL"]}
				</Badge>
			),
		},
		{
			id: "nodes",
			header: "评分模块",
			cell: ({ row }) => `${row.original.scheme.nodes.length} 个`,
		},
		{ accessorKey: "revision", header: "方案版本" },
		{
			accessorKey: "createdAt",
			header: "创建时间",
			cell: ({ row }) => dateText(row.original.createdAt),
		},
		{
			id: "actions",
			header: "操作",
			cell: ({ row }) => (
				<div className="flex flex-wrap gap-2">
					{row.original.disposition !== "DELETED" && (
						<Link
							href={termHref(row.original)}
							className={buttonVariants({ variant: "ghost", size: "sm" })}
						>
							进入周期
						</Link>
					)}
					{admin && (
						<Button
							variant="ghost"
							size="sm"
							onClick={() => manage(row.original)}
						>
							周期管理
						</Button>
					)}
				</div>
			),
		},
	];
	return (
		<>
			<RemoteState {...remote} />
			<Feedback success={success} />
			{remote.data && (
				<TemplateDirectory
					title="测评周期"
					description={`当前${viewLabels[view]}共 ${filtered.length} 个。复制只保留评分方案，不带业务记录和证明。`}
					data={filtered.slice((currentPage - 1) * 20, currentPage * 20)}
					columns={columns}
					search={{
						action: "/terms",
						query,
						placeholder: "搜索周期名称",
						hidden: { view },
					}}
					filters={
						<Field className="w-full sm:w-52">
							<FieldLabel htmlFor="term-view">周期状态</FieldLabel>
							<NativeSelect
								id="term-view"
								value={view}
								onChange={(e) => router.push(`/terms?view=${e.target.value}`)}
							>
								{Object.entries(viewLabels)
									.filter(([v]) => admin || !["all", "deleted"].includes(v))
									.map(([v, l]) => (
										<NativeSelectOption key={v} value={v}>
											{l}
										</NativeSelectOption>
									))}
							</NativeSelect>
						</Field>
					}
					actions={
						admin && (
							<Button
								onClick={() => {
									setOpen(true);
									setDirty(false);
									setError("");
									setSource("");
								}}
							>
								<Plus data-icon="inline-start" />
								新建周期
							</Button>
						)
					}
					pagination={{ page: currentPage, total: filtered.length, href }}
					mobile={(t) => (
						<div className="flex flex-col gap-3">
							<div className="flex flex-wrap justify-between gap-2">
								<p className="font-medium">{t.name}</p>
								<Badge variant="outline">
									{phaseLabels[t.phase]} ·{" "}
									{dispositionLabels[t.disposition || "NORMAL"]}
								</Badge>
							</div>
							<p className="text-xs text-muted-foreground">
								{t.scheme.nodes.length} 个模块 · 版本 {t.revision} ·{" "}
								{dateText(t.createdAt)}
							</p>
							<div className="flex flex-wrap gap-2">
								{t.disposition !== "DELETED" && (
									<Link
										className={buttonVariants({
											variant: "outline",
											size: "sm",
										})}
										href={termHref(t)}
									>
										进入周期
									</Link>
								)}
								{admin && (
									<Button variant="outline" size="sm" onClick={() => manage(t)}>
										周期管理
									</Button>
								)}
							</div>
						</div>
					)}
				/>
			)}
			<Dialog
				open={open}
				onOpenChange={(v) => {
					if (!busy && (!dirty || window.confirm("放弃尚未保存的周期创建？"))) {
						setOpen(v);
						setDirty(false);
					}
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>新建测评周期</DialogTitle>
						<DialogDescription>
							创建后先配置评分方案，再开启申报。复制不会带入学生、成绩、活动或证明。
						</DialogDescription>
					</DialogHeader>
					<form
						className="flex flex-col gap-5"
						onChange={() => setDirty(true)}
						onSubmit={async (e) => {
							e.preventDefault();
							if (busy) return;
							const f = new FormData(e.currentTarget);
							setBusy(true);
							setError("");
							try {
								const t = await requestJson<{ id: string }>("/api/terms", {
									name: f.get("name"),
									template: f.get("template") === "school",
									...(source ? { sourceTermId: source } : {}),
								});
								setDirty(false);
								router.push(`/terms/${t.id}?tab=scheme`);
							} catch (err) {
								setError((err as Error).message);
							} finally {
								setBusy(false);
							}
						}}
					>
						<Feedback error={error} />
						<FieldGroup>
							<Field>
								<FieldLabel htmlFor="term-name">周期名称</FieldLabel>
								<Input id="term-name" name="name" required maxLength={80} />
							</Field>
							<Field>
								<FieldLabel htmlFor="term-source">评分方案来源</FieldLabel>
								<NativeSelect
									id="term-source"
									value={source}
									onChange={(e) => setSource(e.target.value)}
								>
									<NativeSelectOption value="">使用空白方案</NativeSelectOption>
									{sources
										.filter((t) => t.disposition !== "DELETED")
										.map((t) => (
											<NativeSelectOption key={t.id} value={t.id}>
												复制：{t.name}
											</NativeSelectOption>
										))}
								</NativeSelect>
								<FieldDescription>
									只复制评分模块和扣分规则，保留原周期。
								</FieldDescription>
							</Field>
							{!source && (
								<Field>
									<FieldLabel htmlFor="term-template">初始评分方案</FieldLabel>
									<NativeSelect id="term-template" name="template">
										<NativeSelectOption value="blank">
											空白方案
										</NativeSelectOption>
										<NativeSelectOption value="school">
											学校样例（请按实际调整）
										</NativeSelectOption>
									</NativeSelect>
								</Field>
							)}
						</FieldGroup>
						<Button type="submit" disabled={busy}>{busy ? "正在创建…" : "创建并配置"}</Button>
					</form>
				</DialogContent>
			</Dialog>
			<Dialog
				open={!!target}
				onOpenChange={(v) => {
					if (
						!v &&
						!busy &&
						(!dirty || window.confirm("放弃尚未提交的周期管理操作？"))
					) {
						setTarget(null);
						setDirty(false);
					}
				}}
			>
				<DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
					<DialogHeader>
						<DialogTitle>{target?.name} · 周期管理</DialogTitle>
						<DialogDescription>
							根据当前业务引用决定可执行操作，所有变更保留理由和修改记录。
						</DialogDescription>
					</DialogHeader>
					<RemoteState {...details} />
					{details.data && (
						<form
							key={`${details.data.id}-${details.data.revision}`}
							className="flex flex-col gap-5"
							onChange={() => setDirty(true)}
							onSubmit={async (e) => {
								e.preventDefault();
								const d = details.data;
								if (busy || !d || !allowed(d, action)) return;
								const f = new FormData(e.currentTarget);
								setBusy(true);
								setError("");
								try {
									await requestJson(
										`/api/terms/${d.id}`,
										{
											action,
											revision: d.revision,
											reason: f.get("reason"),
											...(action === "rename" ? { name: f.get("name") } : {}),
										},
										"PATCH",
									);
									setDirty(false);
									setTarget(null);
									setSuccess(`周期已完成${actions[action]}。`);
									remote.reload();
									router.refresh();
								} catch (err) {
									setError((err as Error).message);
								} finally {
									setBusy(false);
								}
							}}
						>
							<Feedback error={error} />
							<dl className="grid gap-5 sm:grid-cols-3">
								{Object.entries(details.data.usage).map(([k, v]) => (
									<div key={k} className="flex flex-col gap-1">
										<dt className="text-xs text-muted-foreground">
											{usageLabels[k] || "其他引用"}
										</dt>
										<dd className="text-sm tabular-nums">{v}</dd>
									</div>
								))}
							</dl>
							<p className="text-xs text-muted-foreground">
								版本 {details.data.revision} ·{" "}
								{dispositionLabels[details.data.disposition || "NORMAL"]}
								{details.data.dispositionAt
									? ` · ${dateText(details.data.dispositionAt)}`
									: ""}
								{details.data.dispositionReason
									? ` · ${details.data.dispositionReason}`
									: ""}
							</p>
							<FieldGroup>
								<Field>
									<FieldLabel htmlFor="term-action">管理操作</FieldLabel>
									<NativeSelect
										id="term-action"
										value={action}
										onChange={(e) => setAction(e.target.value as Action)}
									>
										{Object.entries(actions)
											.filter(([a]) => allowed(details.data!, a as Action))
											.map(([a, l]) => (
												<NativeSelectOption key={a} value={a}>
													{l}
												</NativeSelectOption>
											))}
									</NativeSelect>
									<FieldDescription>
										只有没有业务记录的配置周期才能移入回收站；未发布的周期可以作废；锁定后才能归档。作废和归档记录都可以继续查看。
									</FieldDescription>
								</Field>
								{action === "rename" && (
									<Field>
										<FieldLabel htmlFor="term-rename">周期名称</FieldLabel>
										<Input
											id="term-rename"
											name="name"
											defaultValue={details.data.name}
											required
											maxLength={80}
										/>
									</Field>
								)}
								<Field>
									<FieldLabel htmlFor="term-reason">操作理由</FieldLabel>
									<Textarea
										id="term-reason"
										name="reason"
										required
										minLength={2}
										maxLength={500}
										rows={3}
									/>
								</Field>
							</FieldGroup>
							<Button type="submit" disabled={busy || !allowed(details.data, action)}>
								{busy ? "正在提交…" : actions[action]}
							</Button>
						</form>
					)}
				</DialogContent>
			</Dialog>
		</>
	);
}
