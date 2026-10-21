"use client";
// Adapted from the selected template's dashboard tables + sheet detail pattern:
// a scoped student directory, the college review queue and the per-student grade
// detail with the two-stage counselor -> college flow.
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
import { Separator } from "@/components/ui/separator";
import {
	Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import {
	Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { dateText, statusLabels } from "@/lib/business-labels";

type Profile = { studentNumber: string; college: string; major: string; className: string };
type Roster = {
	items: { id: string; login: string; name: string; studentProfile: Profile; entered: number; required: number; pending: number; returned: number }[];
	total: number;
	page: number;
	scopeOptions: { colleges: string[]; majors: string[]; classes: string[] };
	nodes: { id: string; name: string; minimum: string; maximum: string; required: boolean }[];
	canSubmit: boolean;
	canReview: boolean;
	canCorrect: boolean;
};
type QueueItem = {
	id: string; studentId: string; studentName: string; login: string; className: string; college: string;
	nodeId: string; nodeName: string; value: string; baseValue: string | null; reason: string; status: string;
	submitter: string | null; submittedAt: string; reviewer: string | null; reviewedAt: string | null;
	reviewReason: string | null; revision: number; canDecide: boolean; canRevise: boolean;
};
type Queue = { items: QueueItem[]; total: number; page: number; status: string; stats: { pending: number; returned: number; mine: number }; role: string };
type Node = { id: string; name: string; minimum: string; maximum: string; required: boolean; input: { id: string; value: string; revision: number; updatedAt: string } | null; change: { id: string; value: string; reason: string; status: string; revision: number; submittedBy: string; submittedAt: string; reviewReason: string | null } | null };
type Detail = {
	student: { id: string; login: string; name: string; disabled: boolean; profile: { college: string; major: string; className: string } | null };
	nodes: Node[];
	changes: { id: string; nodeId: string; nodeName: string; value: string; baseValue: string | null; reason: string; status: string; submittedBy: string | null; submittedAt: string; reviewer: string | null; reviewedAt: string | null; reviewReason: string | null }[];
	canSubmit: boolean;
	canReview: boolean;
	canCorrect: boolean;
	phase: string;
	disposition: string;
};

const queueStatuses = [
	["PENDING", "待处理与退回"],
	["PENDING_COLLEGE", "待学院审核"],
	["RETURNED", "已退回"],
	["APPROVED", "已通过"],
	["ABANDONED", "已放弃"],
] as const;

export function GradeWorkspace({ term, role }: { term: { id: string; name: string; phase: string; disposition: string }; role: "ADMIN" | "COLLEGE" | "COUNSELOR" }) {
	const readOnly = term.phase !== "ACTIVE" || term.disposition !== "NORMAL";
	const [queueStatus, setQueueStatus] = useState<string>("PENDING");
	const [queuePage, setQueuePage] = useState(1);
	const [query, setQuery] = useState("");
	const [draft, setDraft] = useState("");
	const [scope, setScope] = useState({ college: "", major: "", className: "" });
	const [draftScope, setDraftScope] = useState(scope);
	const [rosterPage, setRosterPage] = useState(1);
	const [selectedId, setSelectedId] = useState("");
	const [node, setNode] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [success, setSuccess] = useState("");
	const [sendingBack, setSendingBack] = useState<{ id: string; revision: number; label: string } | null>(null);
	const [dirty, setDirty] = useState(false);
	useUnsavedChanges(dirty);

	const queue = useRemote<Queue>(`/api/grade-changes?${new URLSearchParams({ termId: term.id, status: queueStatus, page: String(queuePage) })}`);
	const roster = useRemote<Roster>(`/api/grades/roster?${new URLSearchParams({ termId: term.id, q: query, ...scope, page: String(rosterPage) })}`);
	const detail = useRemote<Detail>(selectedId ? `/api/grades/${selectedId}?termId=${term.id}` : null);
	const current = detail.data?.nodes.find(item => item.id === node) || null;

	function refresh(message: string) {
		setSuccess(message);
		setError("");
		queue.reload();
		roster.reload();
		detail.reload();
		setDirty(false);
	}
	async function act(id: string, revision: number, action: string, extra: Record<string, unknown> = {}) {
		if (busy) return;
		setBusy(true);
		setError("");
		try {
			await requestJson(`/api/grade-changes/${id}`, { termId: term.id, revision, action, ...extra }, "PATCH");
			refresh(action === "approve" ? "成绩已审核通过并生效。" : action === "return" ? "已退回原辅导员修正。" : action === "resubmit" ? "已重新提交学院审核。" : "已放弃本次修订。");
		} catch (err) {
			setError((err as Error).message);
		} finally {
			setBusy(false);
		}
	}
	async function submitChange(form: HTMLFormElement) {
		if (!current || !detail.data || busy) return;
		const data = new FormData(form);
		setBusy(true);
		setError("");
		setSuccess("");
		try {
			await requestJson("/api/grade-changes", {
				termId: term.id, studentId: detail.data.student.id, nodeId: current.id,
				value: data.get("value"), reason: data.get("reason"),
				requestId: crypto.randomUUID(),
			});
			refresh("成绩修订已提交学院审核，审核通过前不影响成绩。");
		} catch (err) {
			setError((err as Error).message);
		} finally {
			setBusy(false);
		}
	}
	async function correctDirectly(form: HTMLFormElement) {
		if (!current || !detail.data || busy) return;
		const data = new FormData(form);
		setBusy(true);
		setError("");
		setSuccess("");
		try {
			await requestJson("/api/grades", {
				termId: term.id, studentLogin: detail.data.student.login, nodeId: current.id,
				value: data.get("value"), reason: data.get("reason"),
				revision: current.input?.revision ?? null,
			});
			refresh("例外更正已直接生效并留痕。");
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
		const first = roster.data?.nodes[0]?.id || "";
		setNode(first);
	}
	const queueColumns: ColumnDef<DataTableFeatures, QueueItem>[] = [
		{ id: "student", header: "学生", cell: ({ row }) => (
			<div>
				<p className="font-medium">{row.original.studentName}</p>
				<p className="text-xs text-muted-foreground">{row.original.login} · {row.original.className}</p>
			</div>
		) },
		{ id: "node", header: "成绩模块", cell: ({ row }) => row.original.nodeName },
		{ id: "change", header: "有效值 → 修订值", cell: ({ row }) => (
			<span className="tabular-nums">{row.original.baseValue ?? "未录入"} → {row.original.value}</span>
		) },
		{ id: "reason", header: "修订理由", cell: ({ row }) => <span className="line-clamp-2 max-w-48 text-sm">{row.original.reason}</span> },
		{ id: "submitter", header: "提交", cell: ({ row }) => (
			<div>
				<p className="text-sm">{row.original.submitter || "—"}</p>
				<p className="text-xs text-muted-foreground">{dateText(row.original.submittedAt)}</p>
			</div>
		) },
		{ id: "status", header: "状态", cell: ({ row }) => (
			<div className="flex flex-col items-start gap-1">
				<Badge variant={row.original.status === "RETURNED" ? "destructive" : row.original.status === "APPROVED" ? "secondary" : "outline"}>
					{statusLabels[row.original.status] || row.original.status}
				</Badge>
				{row.original.reviewReason && <span className="max-w-40 text-xs text-muted-foreground">{row.original.reviewReason}</span>}
			</div>
		) },
		{ id: "actions", header: "操作", cell: ({ row }) => (
			<div className="flex flex-wrap gap-2">
				{row.original.canDecide && (
					<>
						<Button size="sm" disabled={busy} onClick={() => act(row.original.id, row.original.revision, "approve", { reason: "学院审核通过" })}>通过</Button>
						<Button size="sm" variant="outline" disabled={busy} onClick={() => setSendingBack({ id: row.original.id, revision: row.original.revision, label: `${row.original.studentName} · ${row.original.nodeName}` })}>退回</Button>
					</>
				)}
				{row.original.canRevise && (
					<Button size="sm" variant="outline" disabled={busy} onClick={() => openStudent(row.original.studentId)}>修正并重提</Button>
				)}
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
		{ id: "progress", header: "已录 / 应录", cell: ({ row }) => (
			<span className="tabular-nums">{row.original.entered} / {row.original.required}</span>
		) },
		{ id: "pending", header: "待审", cell: ({ row }) => row.original.pending ? <Badge variant="outline">{row.original.pending}</Badge> : <span className="text-muted-foreground">0</span> },
		{ id: "returned", header: "退回", cell: ({ row }) => row.original.returned ? <Badge variant="destructive">{row.original.returned}</Badge> : <span className="text-muted-foreground">0</span> },
		{ id: "actions", header: "操作", cell: ({ row }) => (
			<Button size="sm" variant="ghost" onClick={() => openStudent(row.original.id)}>
				{role === "COLLEGE" ? "查看与审核" : role === "ADMIN" ? "查看成绩" : "录入成绩"}
			</Button>
		) },
	];
	return (
		<>
			<div className="grid gap-4 sm:grid-cols-3">
				{(role === "COLLEGE"
					? [["待学院审核", queue.data?.stats.pending ?? 0], ["已退回待修正", queue.data?.stats.returned ?? 0], ["待处理合计", queue.data?.total ?? 0]]
					: role === "COUNSELOR"
						? [["待学院审核", queue.data?.stats.pending ?? 0], ["退回本人修正", queue.data?.stats.returned ?? 0], ["本人待审修订", queue.data?.stats.mine ?? 0]]
						: [["全校待学院审核", queue.data?.stats.pending ?? 0], ["已退回待修正", queue.data?.stats.returned ?? 0], ["本周期学生", roster.data?.total ?? 0]]
				).map(([label, value]) => (
					<Card key={String(label)}>
						<CardHeader className="pb-2">
							<CardDescription>{label}</CardDescription>
							<CardTitle className="text-2xl tabular-nums">{String(value)}</CardTitle>
						</CardHeader>
					</Card>
				))}
			</div>
			<Feedback error={error} success={success} />
			<RemoteState {...queue} />
			{queue.data && (
				<TemplateDirectory
					title={role === "COUNSELOR" ? "我的成绩修订" : "成绩审核队列"}
					description={role === "COLLEGE" ? "本院辅导员提交的成绩修订；通过后按批准值生效，退回必须填写理由。" : "按提交时间排列的成绩修订与处理状态。"}
					data={queue.data.items}
					columns={queueColumns}
					filters={
						<Field className="w-full sm:w-56">
							<FieldLabel htmlFor="grade-queue-status">处理状态</FieldLabel>
							<NativeSelect id="grade-queue-status" value={queueStatus} onChange={(event) => { setQueueStatus(event.target.value); setQueuePage(1); }}>
								{queueStatuses.map(([value, label]) => <NativeSelectOption key={value} value={value}>{label}</NativeSelectOption>)}
							</NativeSelect>
						</Field>
					}
					pagination={{ page: queue.data.page, total: queue.data.total, href: () => "#", onPageChange: setQueuePage }}
					mobile={(row) => (
						<div className="flex flex-col gap-2">
							<p className="font-medium">{row.studentName} · {row.nodeName}</p>
							<p className="text-sm tabular-nums">{row.baseValue ?? "未录入"} → {row.value}</p>
							<p className="text-xs text-muted-foreground">{row.reason}</p>
							<Badge variant="outline" className="self-start">{statusLabels[row.status] || row.status}</Badge>
							<div className="flex flex-wrap gap-2">
								{row.canDecide && <Button size="sm" disabled={busy} onClick={() => act(row.id, row.revision, "approve", { reason: "学院审核通过" })}>通过</Button>}
								{row.canDecide && <Button size="sm" variant="outline" disabled={busy} onClick={() => setSendingBack({ id: row.id, revision: row.revision, label: `${row.studentName} · ${row.nodeName}` })}>退回</Button>}
								{row.canRevise && <Button size="sm" variant="outline" disabled={busy} onClick={() => openStudent(row.studentId)}>修正并重提</Button>}
							</div>
						</div>
					)}
				/>
			)}
			<RemoteState {...roster} />
			{roster.data && (
				<TemplateDirectory
					title={role === "COUNSELOR" ? "负责班级成绩" : role === "COLLEGE" ? "本院学生成绩" : "全校学生成绩"}
					description={`共 ${roster.data.total} 位学生。待审修订在学院通过前不改变有效成绩。`}
					data={roster.data.items}
					columns={rosterColumns}
					filters={
						<form className="flex w-full flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); setQuery(draft.trim()); setScope(draftScope); setRosterPage(1); }}>
							<Field className="w-full sm:w-56">
								<FieldLabel htmlFor="grade-query">姓名或学号</FieldLabel>
								<Input id="grade-query" value={draft} maxLength={80} onChange={(event) => setDraft(event.target.value)} placeholder="输入姓名或学号" />
							</Field>
							{([["college", "学院", "colleges"], ["major", "专业", "majors"], ["className", "班级", "classes"]] as const).map(([key, label, options]) => (
								<Field className="w-full sm:w-40" key={key}>
									<FieldLabel htmlFor={`grade-scope-${key}`}>{label}</FieldLabel>
									<NativeSelect id={`grade-scope-${key}`} value={draftScope[key]} onChange={(event) => {
										const next = { ...draftScope, [key]: event.target.value, ...(key === "college" ? { major: "", className: "" } : key === "major" ? { className: "" } : {}) };
										setDraftScope(next); setScope(next); setQuery(draft.trim()); setRosterPage(1);
									}}>
										<NativeSelectOption value="">全部{label}</NativeSelectOption>
										{roster.data!.scopeOptions[options].map(value => <NativeSelectOption key={value} value={value}>{value}</NativeSelectOption>)}
									</NativeSelect>
								</Field>
							))}
							<Button type="submit" variant="outline">搜索</Button>
						</form>
					}
					pagination={{ page: roster.data.page, total: roster.data.total, href: () => "#", onPageChange: setRosterPage }}
					mobile={(row) => (
						<div className="flex flex-col gap-2">
							<p className="font-medium">{row.name} · {row.studentProfile.className}</p>
							<p className="text-sm tabular-nums">已录 {row.entered} / {row.required} · 待审 {row.pending} · 退回 {row.returned}</p>
							<Button size="sm" variant="outline" className="self-start" onClick={() => openStudent(row.id)}>查看成绩</Button>
						</div>
					)}
				/>
			)}
			<Sheet open={!!selectedId} onOpenChange={(open) => { if (!open && (!dirty || window.confirm("放弃尚未提交的输入？"))) { setSelectedId(""); setDirty(false); } }}>
				<SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
					<SheetHeader>
						<SheetTitle>{detail.data?.student.name ?? "学生成绩"}</SheetTitle>
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
										<CardTitle className="text-base">成绩模块与有效值</CardTitle>
										<CardDescription>待审修订在学院通过前不影响有效成绩；退回的修订需辅导员修正后重新提交。</CardDescription>
									</CardHeader>
									<CardContent className="flex flex-col gap-3">
										{detail.data.nodes.length === 0 && <p className="text-sm text-muted-foreground">本周期评分方案没有成绩输入模块。</p>}
										{detail.data.nodes.map(item => (
											<div key={item.id} className="flex flex-wrap items-center justify-between gap-3 border-b pb-3 last:border-b-0 last:pb-0">
												<div className="min-w-0">
													<p className="font-medium">{item.name}{item.required ? " · 必录" : ""}</p>
													<p className="text-xs text-muted-foreground">有效值 <span className="tabular-nums">{item.input?.value ?? "未录入"}</span> · 范围 {item.minimum}～{item.maximum}{item.input ? ` · 第 ${item.input.revision} 版` : ""}</p>
													{item.change && (
														<p className="text-xs text-muted-foreground">
															待审修订 <span className="tabular-nums">{item.change.value}</span> · {statusLabels[item.change.status] || item.change.status} · {item.change.reason}
															{item.change.reviewReason ? ` · 学院意见：${item.change.reviewReason}` : ""}
														</p>
													)}
												</div>
												<div className="flex flex-wrap gap-2">
													{detail.data!.canReview && item.change?.status === "PENDING_COLLEGE" && (
														<>
															<Button size="sm" disabled={busy} onClick={() => act(item.change!.id, item.change!.revision, "approve", { reason: "学院审核通过" })}>通过</Button>
															<Button size="sm" variant="outline" disabled={busy} onClick={() => setSendingBack({ id: item.change!.id, revision: item.change!.revision, label: `${detail.data!.student.name} · ${item.name}` })}>退回</Button>
														</>
													)}
													{detail.data!.canSubmit && item.change && (
														<Button size="sm" variant="outline" disabled={busy} onClick={() => act(item.change!.id, item.change!.revision, "abandon", { reason: "辅导员放弃本次修订" })}>放弃修订</Button>
													)}
													<Button size="sm" variant="ghost" onClick={() => { setNode(item.id); setError(""); setSuccess(""); }}>选择</Button>
												</div>
											</div>
										))}
									</CardContent>
								</Card>
								{current && (detail.data.canSubmit || detail.data.canCorrect) && (
									<Card>
										<CardHeader>
											<CardTitle className="text-base">{detail.data.canSubmit ? (current.change?.status === "RETURNED" ? "修正退回的成绩" : "提交成绩修订") : "例外更正（直接生效）"}</CardTitle>
											<CardDescription>
												{detail.data.canSubmit
													? "提交后进入待学院审核；学院通过前有效成绩保持不变。"
													: "管理员例外更正直接写入有效成绩并保留前后值与理由，仅用于组织或数据异常。"}
											</CardDescription>
										</CardHeader>
										<CardContent>
											<form
												key={`${current.id}-${current.change?.revision ?? current.input?.revision ?? "new"}`}
												className="flex flex-col gap-4"
												onChange={() => setDirty(true)}
												onSubmit={async (event) => {
													event.preventDefault();
													const form = event.currentTarget;
													if (detail.data!.canSubmit && current.change?.status === "RETURNED") {
														setBusy(true); setError(""); setSuccess("");
														const data = new FormData(form);
														try {
															await requestJson(`/api/grade-changes/${current.change.id}`, { termId: term.id, revision: current.change.revision, action: "resubmit", value: data.get("value"), reason: data.get("reason") }, "PATCH");
															refresh("已重新提交学院审核。");
														} catch (err) { setError((err as Error).message); } finally { setBusy(false); }
													} else if (detail.data!.canSubmit) await submitChange(form);
													else await correctDirectly(form);
												}}
											>
												<FieldGroup>
													<Field>
														<FieldLabel htmlFor="grade-node">成绩模块</FieldLabel>
														<NativeSelect id="grade-node" value={current.id} onChange={(event) => { if (dirty && !window.confirm("切换模块将放弃未提交输入，是否继续？")) return; setDirty(false); setNode(event.target.value); }}>
															{detail.data.nodes.map(item => <NativeSelectOption key={item.id} value={item.id}>{item.name}</NativeSelectOption>)}
														</NativeSelect>
														<FieldDescription>当前有效值：{current.input?.value ?? "未录入"}；允许范围 {current.minimum}～{current.maximum}。</FieldDescription>
													</Field>
													<Field>
														<FieldLabel htmlFor="grade-value">成绩</FieldLabel>
														<Input id="grade-value" name="value" inputMode="decimal" required defaultValue={current.change?.value ?? current.input?.value ?? ""} />
													</Field>
													<Field>
														<FieldLabel htmlFor="grade-reason">{detail.data.canSubmit ? "提交理由" : "更正理由"}</FieldLabel>
														<Textarea id="grade-reason" name="reason" required minLength={2} maxLength={1000} rows={2} defaultValue={current.change?.reason ?? ""} />
													</Field>
												</FieldGroup>
												<div className="flex flex-wrap gap-3">
													<Button type="submit" disabled={busy || readOnly}>{detail.data.canSubmit ? (current.change?.status === "RETURNED" ? "重新提交审核" : "提交学院审核") : "保存例外更正"}</Button>
													{readOnly && <span className="self-center text-sm text-muted-foreground">当前阶段或周期状态只读，需管理员重开后才能提交。</span>}
												</div>
											</form>
										</CardContent>
									</Card>
								)}
								<section className="flex flex-col gap-3">
									<h2 className="font-medium text-base">修订与审核记录</h2>
									<p className="text-xs text-muted-foreground">最近 60 条；退回理由、审核人与生效前后值全部保留。</p>
									{detail.data.changes.length === 0 && <p className="text-sm text-muted-foreground">暂无成绩修订记录。</p>}
									{detail.data.changes.map(change => (
										<div key={change.id} className="flex flex-col gap-1 border-b pb-3 last:border-b-0">
											<div className="flex flex-wrap items-center gap-2">
												<span className="font-medium">{change.nodeName}</span>
												<span className="tabular-nums text-sm">{change.baseValue ?? "未录入"} → {change.value}</span>
												<Badge variant={change.status === "RETURNED" ? "destructive" : change.status === "APPROVED" ? "secondary" : "outline"}>{statusLabels[change.status] || change.status}</Badge>
											</div>
											<p className="text-sm text-muted-foreground">{change.reason}</p>
											<p className="text-xs text-muted-foreground">
												提交：{change.submittedBy || "—"} · {dateText(change.submittedAt)}
												{change.reviewer ? ` · 审核：${change.reviewer} · ${change.reviewedAt ? dateText(change.reviewedAt) : ""}` : ""}
												{change.reviewReason ? ` · 意见：${change.reviewReason}` : ""}
											</p>
										</div>
									))}
								</section>
							</>
						)}
					</div>
				</SheetContent>
			</Sheet>
			<Dialog open={!!sendingBack} onOpenChange={(open) => { if (!open) setSendingBack(null); }}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>退回成绩修订</DialogTitle>
						<DialogDescription>{sendingBack?.label} · 退回后由原辅导员修正并重新提交学院审核。</DialogDescription>
					</DialogHeader>
					<form
						className="flex flex-col gap-4"
						onSubmit={async (event) => {
							event.preventDefault();
							if (!sendingBack) return;
							const data = new FormData(event.currentTarget);
							try {
								await act(sendingBack.id, sendingBack.revision, "return", { reason: data.get("reason") });
								setSendingBack(null);
							} catch (err) {
								setError((err as Error).message);
							}
						}}
					>
						<Field>
							<FieldLabel htmlFor="grade-return-reason">退回理由</FieldLabel>
							<Textarea id="grade-return-reason" name="reason" required minLength={2} maxLength={1000} rows={3} />
							<FieldDescription>理由会展示给提交辅导员，并保留在审核记录中。</FieldDescription>
						</Field>
						<DialogFooter>
							<Button type="button" variant="outline" onClick={() => setSendingBack(null)}>取消</Button>
							<Button type="submit" disabled={busy}>确认退回</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
			<Separator className="my-2" />
			<p className="text-xs text-muted-foreground">
				本页只处理成绩输入与审核。综合成绩、排名与发布请使用成绩查询与结果发布页面。
			</p>
		</>
	);
}
