"use client";
// Adapted from the selected template's dashboard tables + sheet detail pattern:
// a scoped student directory, the college deduction review queue and per-student
// deduction events with the counselor -> college submission flow.
import { useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import type { DataTableFeatures } from "@/lib/data-table-features";
import { TemplateDirectory } from "@/components/dashboard/template-directory";
import { useRemote } from "@/components/dashboard/use-remote";
import { RemoteState } from "@/components/dashboard/remote-state";
import { Feedback, requestJson } from "@/components/dashboard/feedback";
import { useUnsavedChanges } from "@/components/dashboard/use-unsaved-changes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldGroup, FieldLabel, FieldDescription } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { SearchableSelect } from "@/components/dashboard/searchable-select";
import {
	Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import {
	Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { dateText, statusLabels } from "@/lib/business-labels";

type Profile = { studentNumber: string; college: string; major: string; className: string };
type Project = { id: string; name: string; nodeId: string; nodeName: string; coefficient: string };
type Roster = {
	items: { id: string; login: string; name: string; studentProfile: Profile; events: number; pending: number; returned: number }[];
	total: number;
	page: number;
	scopeOptions: { colleges: string[]; majors: string[]; classes: string[] };
	projects: Project[];
	stats: { events: number };
	canSubmit: boolean;
	canReview: boolean;
	canCorrect: boolean;
};
type QueueItem = {
	id: string; studentId: string; studentName: string; login: string; className: string; college: string;
	projectId: string; projectName: string; nodeName: string; coefficient: string;
	action: "CREATE" | "REVOKE"; amount: string | null; targetOccurrence: number | null; targetAmount: string | null;
	reason: string; status: string; submitter: string | null; submittedAt: string; reviewer: string | null;
	reviewedAt: string | null; reviewReason: string | null; revision: number; canDecide: boolean; canRevise: boolean;
};
type Queue = { items: QueueItem[]; total: number; page: number; status: string; stats: { pending: number; returned: number }; role: string };
type Event = {
	id: string; projectId: string; projectName: string; nodeName: string; coefficient: string;
	occurrence: number; amount: string; revoked: boolean; reason: string; revision: number; updatedAt: string; pendingRevoke: boolean;
};
type Change = {
	id: string; projectId: string; projectName: string; nodeName: string; action: "CREATE" | "REVOKE";
	amount: string | null; reason: string; status: string; targetInputId: string | null; targetOccurrence: number | null;
	submittedBy: string | null; submittedAt: string; reviewer: string | null; reviewedAt: string | null; reviewReason: string | null; revision: number;
};
type Detail = {
	student: { id: string; login: string; name: string; disabled: boolean; profile: { college: string; major: string; className: string } | null };
	projects: Project[];
	events: Event[];
	changes: Change[];
	canSubmit: boolean; canReview: boolean; canCorrect: boolean; phase: string; disposition: string;
};

const queueStatuses = [
	["PENDING", "待处理（含已退回）"],
	["PENDING_COLLEGE", "待学院审核"],
	["RETURNED", "已退回待修改"],
	["APPROVED", "已通过"],
	["ABANDONED", "已撤回本次申请"],
] as const;
const actionLabels = { CREATE: "新增扣分", REVOKE: "撤销扣分" } as const;

export function DeductionWorkspace({ term, role }: { term: { id: string; name: string; phase: string; disposition: string }; role: "ADMIN" | "COLLEGE" | "COUNSELOR" }) {
	const readOnly = term.phase !== "ACTIVE" || term.disposition !== "NORMAL";
	const [queueStatus, setQueueStatus] = useState<string>("PENDING");
	const [queuePage, setQueuePage] = useState(1);
	const [query, setQuery] = useState("");
	const [draft, setDraft] = useState("");
	const [scope, setScope] = useState({ college: "", major: "", className: "" });
	const [draftScope, setDraftScope] = useState(scope);
	const [rosterPage, setRosterPage] = useState(1);
	const [selectedId, setSelectedId] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [success, setSuccess] = useState("");
	const [dirty, setDirty] = useState(false);
	const [view, setView] = useState<"queue" | "roster">(
		role === "COUNSELOR" ? "roster" : "queue",
	);
	const [projectFormKey, setProjectFormKey] = useState(0);
	const [sendingBack, setSendingBack] = useState<{ id: string; revision: number; label: string } | null>(null);
	const [revoking, setRevoking] = useState<Event | null>(null);
	useUnsavedChanges(dirty);

	const queue = useRemote<Queue>(`/api/deduction-changes?${new URLSearchParams({ termId: term.id, status: queueStatus, page: String(queuePage) })}`);
	const roster = useRemote<Roster>(`/api/deductions/roster?${new URLSearchParams({ termId: term.id, q: query, ...scope, page: String(rosterPage) })}`);
	const detail = useRemote<Detail>(selectedId ? `/api/deductions/${selectedId}?termId=${term.id}` : null);

	function refresh(message: string) {
		setSuccess(message);
		setError("");
		setDirty(false);
		queue.reload();
		roster.reload();
		detail.reload();
	}
	async function submit(input: Record<string, unknown>, message: string) {
		if (busy || !detail.data) return false;
		setBusy(true);
		setError("");
		setSuccess("");
		try {
			await requestJson("/api/deduction-changes", { termId: term.id, studentId: detail.data.student.id, requestId: crypto.randomUUID(), ...input });
			refresh(message);
			return true;
		} catch (err) {
			setError((err as Error).message);
			return false;
		} finally {
			setBusy(false);
		}
	}
	async function act(id: string, revision: number, action: string, extra: Record<string, unknown> = {}) {
		if (busy) return;
		setBusy(true);
		setError("");
		try {
			await requestJson(`/api/deduction-changes/${id}`, { termId: term.id, revision, action, ...extra }, "PATCH");
			refresh(action === "approve" ? "扣分已审核通过并生效。" : action === "return" ? "已退回原辅导员修改。" : action === "resubmit" ? "已重新提交学院审核。" : "已撤回本次申请。");
		} catch (err) {
			setError((err as Error).message);
		} finally {
			setBusy(false);
		}
	}
	function openStudent(id: string) {
		setSelectedId(id);
		setError("");
		setSuccess("");
	}
	const queueColumns: ColumnDef<DataTableFeatures, QueueItem>[] = [
		{ id: "student", header: "学生", cell: ({ row }) => (
			<div>
				<p className="font-medium">{row.original.studentName}</p>
				<p className="text-xs text-muted-foreground">{row.original.login} · {row.original.className}</p>
			</div>
		) },
		{ id: "project", header: "扣分项目", cell: ({ row }) => (
			<div>
				<p>{row.original.projectName}</p>
				<p className="text-xs text-muted-foreground">{row.original.nodeName} · 扣分系数 {row.original.coefficient}</p>
			</div>
		) },
		{ id: "action", header: "类型", cell: ({ row }) => (
			<div>
				<Badge variant={row.original.action === "REVOKE" ? "secondary" : "outline"}>{actionLabels[row.original.action]}</Badge>
				{row.original.action === "REVOKE" && row.original.targetOccurrence !== null && (
					<p className="text-xs text-muted-foreground">第 {row.original.targetOccurrence + 1} 次扣分 · 原扣分 {row.original.targetAmount ?? "—"}</p>
				)}
			</div>
		) },
		{ id: "amount", header: "扣分", cell: ({ row }) => <span className="tabular-nums">{row.original.amount ?? "—"}</span> },
		{ id: "reason", header: "事由", cell: ({ row }) => <span className="line-clamp-2 max-w-48 text-sm">{row.original.reason}</span> },
		{ id: "submitter", header: "提交", cell: ({ row }) => (
			<div>
				<p className="text-sm">{row.original.submitter || "—"}</p>
				<p className="text-xs text-muted-foreground">{dateText(row.original.submittedAt)}</p>
			</div>
		) },
		{ id: "status", header: "状态", cell: ({ row }) => (
			<div className="flex flex-col items-start gap-1">
				<Badge variant={row.original.status === "APPROVED" ? "outline" : "secondary"}>{statusLabels[row.original.status] || row.original.status}</Badge>
				{row.original.reviewReason && <span className="max-w-40 text-xs text-muted-foreground">{row.original.reviewReason}</span>}
			</div>
		) },
		{ id: "actions", header: "操作", cell: ({ row }) => (
			<div className="flex flex-wrap gap-2">
				{row.original.canDecide && (
					<>
						<Button size="sm" disabled={busy} onClick={() => act(row.original.id, row.original.revision, "approve", { reason: "学院审核通过" })}>审核通过</Button>
						<Button size="sm" variant="outline" disabled={busy} onClick={() => setSendingBack({ id: row.original.id, revision: row.original.revision, label: `${row.original.studentName} · ${row.original.projectName}` })}>退回辅导员修改</Button>
					</>
				)}
				{row.original.canRevise && <Button size="sm" variant="outline" disabled={busy} onClick={() => openStudent(row.original.studentId)}>修改后重新提交</Button>}
			</div>
		) },
	];
	const rosterColumns: ColumnDef<DataTableFeatures, Roster["items"][number]>[] = [
		{ id: "student", header: "学生", cell: ({ row }) => (
			<div>
				<p className="font-medium">{row.original.name}</p>
				<p className="text-xs text-muted-foreground">{row.original.studentProfile.studentNumber || row.original.login}</p>
			</div>
		) },
		{ id: "class", header: "班级", cell: ({ row }) => (
			<div>
				<p>{row.original.studentProfile.className}</p>
				<p className="text-xs text-muted-foreground">{row.original.studentProfile.college} · {row.original.studentProfile.major}</p>
			</div>
		) },
		{ id: "events", header: "当前有效扣分", cell: ({ row }) => <span className="tabular-nums">{row.original.events}</span> },
		{ id: "pending", header: "待审核", cell: ({ row }) => row.original.pending ? <Badge variant="outline">{row.original.pending}</Badge> : <span className="text-muted-foreground">0</span> },
		{ id: "returned", header: "退回待修改", cell: ({ row }) => row.original.returned ? <Badge variant="secondary">{row.original.returned}</Badge> : <span className="text-muted-foreground">0</span> },
		{ id: "actions", header: "操作", cell: ({ row }) => (
			<Button size="sm" variant="ghost" onClick={() => openStudent(row.original.id)}>{role === "COLLEGE" ? "查看与审核" : role === "ADMIN" ? "查看扣分" : "登记扣分"}</Button>
		) },
	];
	return (
		<>
			<div className="grid grid-cols-3 gap-2 sm:gap-4">
				{(role === "COLLEGE"
					? [["待学院审核", queue.data?.stats.pending ?? 0], ["退回待辅导员修改", queue.data?.stats.returned ?? 0], ["本院当前有效扣分", roster.data?.stats.events ?? 0]]
					: role === "COUNSELOR"
						? [["本人待学院审核", queue.data?.stats.pending ?? 0], ["退回本人修改", queue.data?.stats.returned ?? 0], ["负责班级有效扣分", roster.data?.stats.events ?? 0]]
						: [["全校待学院审核", queue.data?.stats.pending ?? 0], ["已退回待修改", queue.data?.stats.returned ?? 0], ["全校当前有效扣分", roster.data?.stats.events ?? 0]]
				).map(([label, value]) => (
					<Card key={String(label)}>
						<CardHeader className="pb-2">
							<CardDescription className="text-xs leading-tight">{label}</CardDescription>
							<CardTitle className="text-xl tabular-nums sm:text-2xl">{String(value)}</CardTitle>
						</CardHeader>
					</Card>
				))}
			</div>
			<Feedback error={error} success={success} />
			<Tabs
				value={view}
				onValueChange={(next) => setView(next as "queue" | "roster")}
				className="min-w-0"
			>
				<TabsList>
					<TabsTrigger value="queue">
						{role === "COLLEGE"
							? "待我审核"
							: role === "COUNSELOR"
								? "我的扣分申请"
								: "扣分记录审核"}
						{queue.data ? ` ${queue.data.stats.pending + queue.data.stats.returned}` : ""}
					</TabsTrigger>
					<TabsTrigger value="roster">
						{role === "COUNSELOR"
							? "负责班级学生"
							: role === "COLLEGE"
								? "本院学生"
								: "全校学生"}
						{roster.data ? ` ${roster.data.total}` : ""}
					</TabsTrigger>
				</TabsList>
				<TabsContent value="queue" className="min-w-0">
			<RemoteState {...queue} />
			{queue.data && (
				<TemplateDirectory
					description={`共 ${queue.data.total} 条扣分记录`}
					data={queue.data.items}
					columns={queueColumns}
					empty={
						role === "COUNSELOR"
							? {
									title: "暂无扣分申请",
									description:
										"在下方学生名单中登记扣分或申请取消，提交后由学院审核。",
								}
							: role === "COLLEGE"
								? {
										title: "暂无待审核的扣分申请",
										description:
											"辅导员提交后会显示在这里；可切换状态查看历史。",
									}
								: {
										title: "暂无扣分申请记录",
										description:
											"辅导员提交或管理员直接更正后，会在这里显示；可切换状态查看历史。",
									}
					}
					filters={
						<Field className="w-full sm:w-56">
							<FieldLabel htmlFor="deduction-queue-status">处理状态</FieldLabel>
							<NativeSelect id="deduction-queue-status" value={queueStatus} onChange={(event) => { setQueueStatus(event.target.value); setQueuePage(1); }}>
								{queueStatuses.map(([value, label]) => <NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}
							</NativeSelect>
						</Field>
					}
					pagination={{ page: queue.data.page, total: queue.data.total, href: () => "#", onPageChange: setQueuePage }}
					mobile={(row) => (
						<div className="flex flex-col gap-2">
							<p className="font-medium">{row.studentName} · {row.projectName}</p>
							<p className="text-sm">{actionLabels[row.action]}{row.amount ? ` · ${row.amount}` : ""}</p>
							<p className="text-xs text-muted-foreground">{row.reason}</p>
							<Badge variant="outline" className="self-start">{statusLabels[row.status] || row.status}</Badge>
							<div className="flex flex-wrap gap-2">
								{row.canDecide && <Button size="sm" disabled={busy} onClick={() => act(row.id, row.revision, "approve", { reason: "学院审核通过" })}>审核通过</Button>}
								{row.canDecide && <Button size="sm" variant="outline" disabled={busy} onClick={() => setSendingBack({ id: row.id, revision: row.revision, label: `${row.studentName} · ${row.projectName}` })}>退回辅导员修改</Button>}
								{row.canRevise && <Button size="sm" variant="outline" disabled={busy} onClick={() => openStudent(row.studentId)}>修改后重新提交</Button>}
							</div>
						</div>
					)}
				/>
			)}
				</TabsContent>
				<TabsContent value="roster" className="min-w-0">
			<RemoteState {...roster} />
			{roster.data && (
				<TemplateDirectory
					description={`共 ${roster.data.total} 位学生；待审扣分在学院通过前不计入总分。`}
					data={roster.data.items}
					columns={rosterColumns}
					filters={
						<form className="flex w-full flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); setQuery(draft.trim()); setScope(draftScope); setRosterPage(1); }}>
							<Field className="w-full sm:w-56">
								<FieldLabel htmlFor="deduction-query">姓名或学号</FieldLabel>
								<Input id="deduction-query" value={draft} maxLength={80} onChange={(event) => setDraft(event.target.value)} placeholder="输入姓名或学号" />
							</Field>
							{([["college", "学院", "colleges"], ["major", "专业", "majors"], ["className", "班级", "classes"]] as const).filter(([key]) => role === "ADMIN" || key !== "college").map(([key, label, options]) => (
								<Field className="w-full sm:w-40" key={key}>
									<FieldLabel htmlFor={`deduction-scope-${key}`}>{label}</FieldLabel>
									<SearchableSelect id={`deduction-scope-${key}`} value={draftScope[key]} onValueChange={(value) => {
										const next = { ...draftScope, [key]: value, ...(key === "college" ? { major: "", className: "" } : key === "major" ? { className: "" } : {}) };
										setDraftScope(next); setScope(next); setQuery(draft.trim()); setRosterPage(1);
									}} placeholder={`全部${label}`} searchPlaceholder={`搜索${label}`} options={roster.data!.scopeOptions[options].map(value => ({ value, label: value }))} />
								</Field>
							))}
							<Button type="submit" variant="outline">搜索</Button>
						</form>
					}
					pagination={{ page: roster.data.page, total: roster.data.total, href: () => "#", onPageChange: setRosterPage }}
					mobile={(row) => (
						<div className="flex flex-col gap-2">
							<p className="font-medium">{row.name} · {row.studentProfile.className}</p>
							<p className="text-sm tabular-nums">当前有效扣分 {row.events} · 待审核 {row.pending} · 退回待修改 {row.returned}</p>
							<Button size="sm" variant="outline" className="self-start" onClick={() => openStudent(row.id)}>查看扣分</Button>
						</div>
					)}
				/>
			)}
				</TabsContent>
			</Tabs>
			<Sheet open={!!selectedId} onOpenChange={(open) => { if (!open && (!dirty || window.confirm("放弃尚未提交的输入？"))) { setSelectedId(""); setDirty(false); } }}>
				<SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
					<SheetHeader>
						<SheetTitle>{detail.data?.student.name ?? "学生扣分"}</SheetTitle>
						<SheetDescription>
							{detail.data?.student.profile
								? `${detail.data.student.login} · ${detail.data.student.profile.college} · ${detail.data.student.profile.major} · ${detail.data.student.profile.className}`
								: "正在读取学生档案"}
						</SheetDescription>
					</SheetHeader>
					<div className="flex flex-col gap-6 px-5 pb-6">
						<RemoteState {...detail} />
						{detail.data && (
							<>
								<Card>
									<CardHeader>
										<CardTitle className="text-base">当前有效扣分</CardTitle>
										<CardDescription>每条扣分独立记录；同一项目的多次扣分累计后，按该项目的扣分系数计算。</CardDescription>
									</CardHeader>
									<CardContent className="flex flex-col gap-3">
										{detail.data.events.length === 0 && <p className="text-sm text-muted-foreground">暂无扣分记录。</p>}
										{detail.data.events.map(item => (
											<div key={item.id} className="flex flex-wrap items-center justify-between gap-3 border-b pb-3 last:border-b-0 last:pb-0">
												<div className="min-w-0">
													<p className="font-medium">{item.projectName} · 第 {item.occurrence + 1} 次扣分</p>
													<p className="text-sm tabular-nums">扣分 {item.amount} · 扣分系数 {item.coefficient} · 计入 {item.nodeName}</p>
													<p className="text-xs text-muted-foreground">{item.reason} · 第 {item.revision} 版 · {dateText(item.updatedAt)}</p>
													{item.pendingRevoke && <p className="text-xs text-muted-foreground">撤销申请待学院审核</p>}
												</div>
												<div className="flex flex-wrap items-center gap-2">
													<Badge variant={item.revoked ? "outline" : "secondary"}>{item.revoked ? "已撤销" : "生效中"}</Badge>
													{detail.data!.canSubmit && !item.revoked && !item.pendingRevoke && (
														<Button size="sm" variant="outline" disabled={busy} onClick={() => setRevoking(item)}>申请取消这条扣分</Button>
													)}
												</div>
											</div>
										))}
									</CardContent>
								</Card>
								{detail.data.canSubmit && (
									<Card>
										<CardHeader>
											<CardTitle className="text-base">新增扣分记录</CardTitle>
											<CardDescription>提交后进入待学院审核；通过前不计入总分。</CardDescription>
										</CardHeader>
										<CardContent>
											<form className="flex flex-col gap-4" onChange={() => setDirty(true)} onSubmit={async (event) => {
												event.preventDefault();
												const form = event.currentTarget;
												const data = new FormData(form);
												const submitted = await submit({ projectId: data.get("projectId"), action: "CREATE", amount: data.get("amount"), reason: data.get("reason") }, "扣分记录已提交学院审核。");
												if (!submitted) return;
												form.reset();
												setProjectFormKey((key) => key + 1);
											}}>
												<FieldGroup>
													<Field>
														<FieldLabel htmlFor="deduction-project">扣分项目</FieldLabel>
														<SearchableSelect
															key={projectFormKey}
															id="deduction-project"
															name="projectId"
															required
															defaultValue={detail.data.projects[0]?.id ?? ""}
															placeholder="选择扣分项目"
															searchPlaceholder="搜索扣分项目"
															onValueChange={() => setDirty(true)}
															options={detail.data.projects.map(item => ({ value: item.id, label: item.name, description: `${item.nodeName} · 扣分系数 ${item.coefficient}` }))}
														/>
														<FieldDescription>{detail.data.projects.length ? "扣分项目来自本周期生效评分制度。" : "本周期评分制度没有扣分项目。"}</FieldDescription>
													</Field>
													<Field>
														<FieldLabel htmlFor="deduction-amount">扣分额</FieldLabel>
														<Input id="deduction-amount" name="amount" inputMode="decimal" required />
													</Field>
													<Field>
														<FieldLabel htmlFor="deduction-reason">事由与依据</FieldLabel>
														<Textarea id="deduction-reason" name="reason" required minLength={2} maxLength={1000} rows={2} />
													</Field>
												</FieldGroup>
												<Button type="submit" className="self-start" disabled={busy || readOnly || !detail.data.projects.length}>提交学院审核</Button>
											</form>
										</CardContent>
									</Card>
								)}
								{detail.data.canCorrect && (
									<Card>
										<CardHeader>
											<CardTitle className="text-base">管理员直接更正（会记录原因）</CardTitle>
											<CardDescription>直接写入或撤销扣分记录，并保留修改前后值和原因；仅用于组织或数据异常。</CardDescription>
										</CardHeader>
										<CardContent>
											<form className="flex flex-col gap-4" onSubmit={async (event) => {
												event.preventDefault();
												const form = event.currentTarget;
												const data = new FormData(form);
												const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
												const sequence = Math.max(1, Math.trunc(Number(data.get("occurrence")) || 1));
												const occurrence = sequence - 1;
												const existing = detail.data!.events.find(item => item.occurrence === occurrence && item.projectId === data.get("projectId"));
												setBusy(true); setError(""); setSuccess("");
												try {
													await requestJson("/api/deductions", {
														termId: term.id, studentLogin: detail.data!.student.login, projectId: data.get("projectId"),
														occurrence, amount: data.get("amount"), reason: data.get("reason"),
														revision: existing?.revision ?? null, revoked: submitter?.value === "revoke",
													});
													refresh(submitter?.value === "revoke" ? "该条扣分已直接撤销并记录原因。" : "扣分记录已直接写入并记录原因。");
												} catch (err) { setError((err as Error).message); } finally { setBusy(false); }
											}}>
												<FieldGroup>
													<Field>
														<FieldLabel htmlFor="deduction-admin-project">扣分项目</FieldLabel>
														<SearchableSelect
															id="deduction-admin-project"
															name="projectId"
															required
															defaultValue={detail.data.projects[0]?.id ?? ""}
															placeholder="选择扣分项目"
															searchPlaceholder="搜索扣分项目"
															options={detail.data.projects.map(item => ({ value: item.id, label: item.name }))}
														/>
													</Field>
													<Field>
														<FieldLabel htmlFor="deduction-admin-occurrence">扣分序号</FieldLabel>
														<Input id="deduction-admin-occurrence" name="occurrence" type="number" min={1} defaultValue={Math.max(1, (detail.data.events.filter(item => item.projectId === detail.data!.projects[0]?.id).reduce((max, item) => Math.max(max, item.occurrence), -1)) + 2)} />
														<FieldDescription>序号从 1 开始；修改已有扣分时请填写它的序号与现有扣分额。</FieldDescription>
													</Field>
													<Field>
														<FieldLabel htmlFor="deduction-admin-amount">扣分额</FieldLabel>
														<Input id="deduction-admin-amount" name="amount" inputMode="decimal" required />
													</Field>
													<Field>
														<FieldLabel htmlFor="deduction-admin-reason">更正原因</FieldLabel>
														<Textarea id="deduction-admin-reason" name="reason" required minLength={2} maxLength={1000} rows={2} />
													</Field>
												</FieldGroup>
												<div className="flex flex-wrap gap-3">
													<Button type="submit" value="save" disabled={busy || readOnly}>保存更正</Button>
													<Button type="submit" value="revoke" variant="outline" disabled={busy || readOnly}>直接撤销这条扣分</Button>
												</div>
											</form>
										</CardContent>
									</Card>
								)}
								<section className="flex flex-col gap-3">
									<h2 className="font-medium text-base">提交与审核记录</h2>
									<p className="text-xs text-muted-foreground">最近 60 条；退回原因、审核人与处理结果全部保留。</p>
									{detail.data.changes.length === 0 && <p className="text-sm text-muted-foreground">暂无扣分提交记录。</p>}
									{detail.data.changes.map(change => (
										<div key={change.id} className="flex flex-col gap-2 border-b pb-3 last:border-b-0">
											<div className="flex flex-wrap items-center gap-2">
												<span className="font-medium">{change.projectName}</span>
												<Badge variant={change.action === "REVOKE" ? "secondary" : "outline"}>{actionLabels[change.action]}</Badge>
												{change.amount && <span className="tabular-nums text-sm">{change.amount}</span>}
												<Badge variant={change.status === "APPROVED" ? "outline" : "secondary"}>{statusLabels[change.status] || change.status}</Badge>
											</div>
											<p className="text-sm text-muted-foreground">{change.reason}</p>
											<p className="text-xs text-muted-foreground">
												提交：{change.submittedBy || "—"} · {dateText(change.submittedAt)}
												{change.reviewer ? ` · 审核：${change.reviewer} · ${change.reviewedAt ? dateText(change.reviewedAt) : ""}` : ""}
												{change.reviewReason ? ` · 意见：${change.reviewReason}` : ""}
											</p>
											{change.status === "RETURNED" && detail.data!.canSubmit && (
												<form className="flex flex-wrap items-end gap-2" onSubmit={async (event) => {
													event.preventDefault();
													const data = new FormData(event.currentTarget);
													await act(change.id, change.revision, "resubmit", { amount: change.action === "CREATE" ? data.get("amount") : undefined, reason: data.get("reason") });
												}}>
													{change.action === "CREATE" && (
														<Field className="w-32">
															<FieldLabel htmlFor={`resubmit-amount-${change.id}`}>修改后扣分额</FieldLabel>
															<Input id={`resubmit-amount-${change.id}`} name="amount" inputMode="decimal" required defaultValue={change.amount ?? ""} />
														</Field>
													)}
													<Field className="w-full sm:w-64">
														<FieldLabel htmlFor={`resubmit-reason-${change.id}`}>修改说明</FieldLabel>
														<Input id={`resubmit-reason-${change.id}`} name="reason" required minLength={2} maxLength={1000} defaultValue={change.reason} />
													</Field>
													<Button type="submit" size="sm" disabled={busy}>重新提交</Button>
													<Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => act(change.id, change.revision, "abandon", { reason: "辅导员撤回本次扣分申请" })}>撤回</Button>
												</form>
											)}
										</div>
									))}
								</section>
							</>
						)}
					</div>
				</SheetContent>
			</Sheet>
			<Dialog open={!!revoking} onOpenChange={(open) => { if (!open) setRevoking(null); }}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>申请取消这条扣分</DialogTitle>
						<DialogDescription>
							{revoking ? `${revoking.projectName} · 第 ${revoking.occurrence + 1} 次 · 扣分 ${revoking.amount}。取消需学院审核，通过前仍计入扣分。` : ""}
						</DialogDescription>
					</DialogHeader>
					<form className="flex flex-col gap-4" onSubmit={async (event) => {
						event.preventDefault();
						if (!revoking) return;
						const data = new FormData(event.currentTarget);
						await submit({ projectId: revoking.projectId, action: "REVOKE", targetInputId: revoking.id, targetRevision: revoking.revision, reason: data.get("reason") }, "撤销申请已提交学院审核。");
						setRevoking(null);
					}}>
						<Field>
							<FieldLabel htmlFor="deduction-revoke-reason">申请原因</FieldLabel>
							<Textarea id="deduction-revoke-reason" name="reason" required minLength={2} maxLength={1000} rows={3} />
							<FieldDescription>原因会随审核记录保留，并展示给学院审核人。</FieldDescription>
						</Field>
						<DialogFooter>
							<Button type="button" variant="outline" onClick={() => setRevoking(null)}>取消</Button>
							<Button type="submit" disabled={busy}>提交撤销申请</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
			<Dialog open={!!sendingBack} onOpenChange={(open) => { if (!open) setSendingBack(null); }}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>退回扣分申请</DialogTitle>
						<DialogDescription>{sendingBack?.label} · 退回后由原辅导员修改并重新提交学院审核。</DialogDescription>
					</DialogHeader>
					<form className="flex flex-col gap-4" onSubmit={async (event) => {
						event.preventDefault();
						if (!sendingBack) return;
						const data = new FormData(event.currentTarget);
						await act(sendingBack.id, sendingBack.revision, "return", { reason: data.get("reason") });
						setSendingBack(null);
					}}>
						<Field>
							<FieldLabel htmlFor="deduction-return-reason">退回原因</FieldLabel>
							<Textarea id="deduction-return-reason" name="reason" required minLength={2} maxLength={1000} rows={3} />
							<FieldDescription>原因会展示给提交辅导员，并保留在审核记录中。</FieldDescription>
						</Field>
						<DialogFooter>
							<Button type="button" variant="outline" onClick={() => setSendingBack(null)}>取消</Button>
							<Button type="submit" disabled={busy}>确认退回</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</>
	);
}
