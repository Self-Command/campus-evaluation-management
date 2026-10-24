"use client";
import { EvidenceViewer } from "@/components/dashboard/evidence-viewer";
import { useUnsavedChanges } from "@/components/dashboard/use-unsaved-changes";
import { TemplateDirectory } from "@/components/dashboard/template-directory";
import Link from "next/link";
import { useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import type { DataTableFeatures } from "@/lib/data-table-features";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Field,
	FieldDescription,
	FieldGroup,
	FieldLabel,
} from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import {
	NativeSelect,
	NativeSelectOption,
} from "@/components/ui/native-select";
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
	SheetDescription,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { Feedback, requestJson } from "@/components/dashboard/feedback";
import { dateText, statusLabels, type AppRole } from "@/lib/business-labels";
type History = {
	action: string;
	at: string;
	before?: unknown;
	after?: unknown;
	reason?: string | null;
	note?: string;
	role?: string;
};
type EvidenceFile = { id: string; name: string; mime: string; size: number };
type Recognition = {
	id: string;
	revision: number;
	status: string;
	origin: string;
	note: string;
	reviewReason: string | null;
	createdAt: string;
	reviewedAt: string | null;
	counseledAt: string | null;
	collegeReviewedAt: string | null;
	returnedByRole: string | null;
	activityEvidenceId: string | null;
	activityEvidence: {
		id: string;
		version: number;
		active: boolean;
		note: string;
		createdAt: string;
		evidence: EvidenceFile;
	} | null;
	evidence: { evidence: EvidenceFile }[];
	history: History[];
	student: {
		id: string;
		name: string;
		login: string;
		college: string | null;
		major: string | null;
		className: string | null;
		counselorId: string | null;
		collegeId: string | null;
	};
	participation: {
		id: string;
		removedAt: string | null;
		removalReason: string | null;
		registrationSnapshot: Record<string, unknown> | null;
		activity: {
			id: string;
			name: string;
			points: string;
			ownerId: string;
			collegeId: string | null;
			college: { name: string } | null;
		};
	};
	reviewerName: string | null;
	submitterName: string | null;
	counselorName: string | null;
	collegeReviewerName: string | null;
	canReview: boolean;
	canManage: boolean;
};
const statusOptions = [
	"PENDING_COUNSELOR",
	"PENDING_COLLEGE",
	"RETURNED",
	"APPROVED",
	"SUPERSEDED",
	"WITHDRAWN",
	"REVOKED",
	"REJECTED",
];
const originLabels: Record<string, string> = {
	IMPORT: "名单导入",
	CORRECTION: "补录",
	SCORE_CORRECTION: "活动得分更正",
	EVIDENCE_REVISION: "活动证明更新",
	LEGACY: "历史记录",
	PERSONAL: "本人提交",
};
const historyLabels: Record<string, string> = {
	IMPORTED: "导入名单",
	CORRECTION_ADDED: "补录参与",
	CORRECTION_RESUBMITTED: "更正后重新提交",
	CORRECTION_SUPERSEDED: "更正替代原认定",
	SCORE_CORRECTED: "更正活动得分",
	SCORE_SUPERSEDED: "得分更正，原认定已替代",
	SCORE_REOPENED: "得分更正，重新提交",
	EVIDENCE_SUPERSEDED: "活动证明更新，原认定已替代",
	EVIDENCE_REOPENED: "按新证明重新提交",
	COUNSELORAPPROVE: "辅导员通过",
	COUNSELORRETURN: "辅导员退回",
	COLLEGEAPPROVE: "学院通过",
	COLLEGERETURN: "学院退回",
	REVOKE: "撤销认定",
	RESUBMIT: "重新提交",
	PARTICIPATION_REMOVED: "移除参与",
	REGISTERED: "登记参加",
	IMPORT: "导入登记",
};
function HistoryList({ items }: { items?: History[] }) {
	return (
		<div className="flex flex-col gap-3">
			{items?.length ? (
				items.map((event, index) => (
					<div key={index} className="border-l pl-3">
						<p className="text-sm">
							{historyLabels[event.action] || "状态变更"} ·{" "}
							{dateText(event.at)}
						</p>
						{event.reason && (
							<p className="whitespace-pre-wrap text-sm text-muted-foreground">
								{event.reason}
							</p>
						)}
						{event.note && (
							<p className="whitespace-pre-wrap text-sm text-muted-foreground">
								{event.note}
							</p>
						)}
						{event.before !== undefined && event.before !== null && (
							<p className="text-xs text-muted-foreground">
								变更前：
								{statusLabels[String(event.before)] ||
									String(event.before)}
							</p>
						)}
						{event.after !== undefined && event.after !== null && (
							<p className="text-xs text-muted-foreground">
								变更后：
								{statusLabels[String(event.after)] ||
									String(event.after)}
							</p>
						)}
					</div>
				))
			) : (
				<p className="text-sm text-muted-foreground">暂无处理记录。</p>
			)}
		</div>
	);
}
export function Recognitions({
	data,
	term,
	role,
	status,
	query,
}: {
	data: { items: Recognition[]; total: number; page: number };
	term: { id: string; phase: string; disposition?: string };
	role: AppRole;
	status: string;
	query: string;
}) {
	const router = useRouter();
	const path = usePathname();
	const params = useSearchParams();
	const tab =
		params.get("tab") ||
		(path.startsWith("/terms/") ? "recognitions" : "activities");
	const listQuery = new URLSearchParams({
		termId: term.id,
		tab,
		status,
		q: query,
		page: String(data.page),
	});
	const returnHref = `${path}?${listQuery}`;
	const [selected, setSelected] = useState<Recognition | null>(null);
	const [busy, setBusy] = useState(false);
	const [dirty, setDirty] = useState(false);
	const [error, setError] = useState("");
	useUnsavedChanges(Boolean(selected) && (dirty || busy));
	const active =
		term.phase === "ACTIVE" &&
		(!term.disposition || term.disposition === "NORMAL");
	function open(row: Recognition) {
		setSelected(row);
		setError("");
		setDirty(false);
	}
	async function submit(
		action: string,
		payload: Record<string, unknown>,
	) {
		if (!selected || busy) return;
		setBusy(true);
		setError("");
		try {
			await requestJson("/api/activities", {
				action,
				termId: term.id,
				id: selected.id,
				revision: selected.revision,
				...payload,
			});
			setDirty(false);
			setSelected(null);
			router.refresh();
		} catch (err) {
			setError((err as Error).message);
		} finally {
			setBusy(false);
		}
	}
	const columns: ColumnDef<DataTableFeatures, Recognition>[] = [
		{
			id: "student",
			header: "学生",
			cell: ({ row }) => (
				<div>
					<p className="font-medium">{row.original.student.name}</p>
					<p className="text-xs text-muted-foreground">
						{row.original.student.login}
					</p>
					<p className="text-xs text-muted-foreground">
						{row.original.student.college} /{" "}
						{row.original.student.className}
					</p>
				</div>
			),
		},
		{
			id: "activity",
			header: "活动 / 主办学院",
			cell: ({ row }) => (
				<div>
					<Link
						href={`/activities/${row.original.participation.activity.id}?returnTo=${encodeURIComponent(returnHref)}`}
						className="font-medium hover:underline"
					>
						{row.original.participation.activity.name}
					</Link>
					<p className="text-xs text-muted-foreground">
						{row.original.participation.activity.college?.name ||
							"主办学院未设置"}
					</p>
				</div>
			),
		},
		{
			id: "score",
			header: "活动得分",
			cell: ({ row }) =>
				`${row.original.participation.activity.points} 分`,
		},
		{
			accessorKey: "status",
			header: "审核进度",
			cell: ({ row }) => (
				<div className="flex flex-col gap-1">
					<Badge variant="outline">
						{statusLabels[row.original.status] || row.original.status}
					</Badge>
					{row.original.returnedByRole && (
						<span className="text-xs text-muted-foreground">
							退回至
							{row.original.returnedByRole === "COLLEGE"
								? "学院审核"
								: "辅导员审核"}
						</span>
					)}
					{row.original.participation.removedAt && (
						<span className="text-xs text-destructive">已移除</span>
					)}
				</div>
			),
		},
		{
			accessorKey: "createdAt",
			header: "提交时间",
			cell: ({ row }) => dateText(row.original.createdAt),
		},
		{
			id: "actions",
			header: "操作",
			cell: ({ row }) => (
				<Button variant="ghost" size="sm" onClick={() => open(row.original)}>
					{row.original.canReview
						? row.original.status === "PENDING_COUNSELOR"
							? "审核"
							: "学院审核"
						: row.original.canManage &&
							  row.original.status === "RETURNED"
							? "修改并重新提交"
							: "查看"}
				</Button>
			),
		},
	];
	return (
		<>
			<TemplateDirectory
				description={
					role === "ADMIN"
						? `共 ${data.total} 条记录。查看全校参与记录和审核进度。`
						: role === "STUDENT"
							? `共 ${data.total} 条记录。查看本人参与记录和审核进度。`
							: role === "COLLEGE"
								? `共 ${data.total} 条记录。仅显示本学院学生的活动参与。`
								: role === "COUNSELOR"
									? `共 ${data.total} 条记录。仅显示负责班级学生的活动参与。`
									: `共 ${data.total} 条记录。查看你发布活动的参与审核进度。`
				}
				data={data.items}
				columns={columns}
				empty={
					role === "STUDENT"
						? {
								title: "暂无活动参与记录",
								description:
									"学院登记你参加活动后，会在这里显示活动得分和审核进度。",
							}
						: {
								title: "当前没有参与记录",
								description:
									"活动名单登记后，会在这里显示审核进度；可切换状态查看历史。",
							}
				}
				actions={
					<Link
						href={
							path.startsWith("/terms/")
								? `${path}?termId=${term.id}&tab=overview`
								: `/activities?termId=${term.id}`
						}
						className={buttonVariants({ variant: "outline", size: "sm" })}
					>
						查看活动列表
					</Link>
				}
				filters={
					<form action={path} className="flex flex-wrap items-end gap-3">
						<input type="hidden" name="termId" value={term.id} />
						<input type="hidden" name="tab" value={tab} />
						<Field className="w-full sm:w-48">
							<FieldLabel htmlFor="recognition-search">
								学生或活动
							</FieldLabel>
							<Input
								id="recognition-search"
								name="q"
								defaultValue={query}
								placeholder="姓名、学号或活动名称"
							/>
						</Field>
						<Field className="w-full sm:w-48">
							<FieldLabel htmlFor="review-filter">审核状态</FieldLabel>
							<NativeSelect
								id="review-filter"
								name="status"
								defaultValue={status}
							>
								<NativeSelectOption value="">全部状态</NativeSelectOption>
								<NativeSelectOption value="PENDING">
									待审核
								</NativeSelectOption>
								{statusOptions.map((value) => (
									<NativeSelectOption key={value} value={value}>
										{statusLabels[value] || value}
									</NativeSelectOption>
								))}
							</NativeSelect>
						</Field>
						<Button type="submit" variant="outline">筛选</Button>
					</form>
				}
				pagination={{
					page: data.page,
					total: data.total,
					href: (page) => {
						const next = new URLSearchParams(listQuery);
						next.set("page", String(page));
						return `${path}?${next}`;
					},
				}}
				mobile={(row) => (
					<div className="flex flex-col gap-3">
						<div className="flex justify-between gap-2">
							<p className="font-medium">
								{row.student.name} · {row.student.login}
							</p>
							<Badge variant="outline">
								{statusLabels[row.status] || row.status}
							</Badge>
						</div>
						<p className="text-xs text-muted-foreground">
							{row.participation.activity.name} ·{" "}
							{row.participation.activity.college?.name || "未设置"} ·{" "}
							{dateText(row.createdAt)}
						</p>
						<p className="text-sm">
							{row.participation.activity.points} 分
						</p>
						<Button
							variant="outline"
							className="self-start"
							onClick={() => open(row)}
						>
							{row.canReview
								? row.status === "PENDING_COUNSELOR"
									? "审核"
									: "学院审核"
								: row.canManage && row.status === "RETURNED"
									? "修改并重新提交"
									: "查看"}
						</Button>
					</div>
				)}
			/>
			<Sheet
				open={!!selected}
				onOpenChange={(value) => {
					if (
						!busy &&
						!value &&
						(!dirty || window.confirm("放弃尚未保存的审核内容？"))
					)
						setSelected(null);
				}}
			>
				<SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
					<SheetHeader>
						<SheetTitle>{selected?.participation.activity.name}</SheetTitle>
						<SheetDescription>
							{selected?.student.name} · {selected?.student.login} ·{" "}
							{selected?.student.college} / {selected?.student.major} /{" "}
							{selected?.student.className}
						</SheetDescription>
					</SheetHeader>
					{selected && (
						<div className="flex flex-col gap-6 px-5 pb-6">
							<Feedback error={error} />
							<div className="flex flex-wrap items-center gap-2">
								<Badge variant="outline">
									{statusLabels[selected.status] || selected.status}
								</Badge>
								<Badge variant="secondary">
									{originLabels[selected.origin] || selected.origin}
								</Badge>
								{selected.participation.removedAt && (
									<Badge variant="destructive">已移除</Badge>
								)}
							</div>
							{selected.participation.removedAt && (
								<div className="rounded-lg border border-dashed p-3">
									<p className="text-sm font-medium">
										该学生的参与记录已移除，不能继续审核
									</p>
									<p className="mt-1 text-sm text-muted-foreground">
										{selected.participation.removalReason ||
											"未填写原因"}
									</p>
								</div>
							)}
							<section className="grid gap-4 sm:grid-cols-2">
								<div>
									<h3 className="text-sm font-medium">活动与分数</h3>
									<p className="mt-2 text-sm">
										{selected.participation.activity.name}
									</p>
									<p className="text-xs text-muted-foreground">
										主办学院：
										{selected.participation.activity.college?.name ||
											"未设置"}
									</p>
									<p className="mt-2 text-sm tabular-nums">
										活动得分：
										{selected.participation.activity.points} 分
									</p>
									<Link
										href={`/activities/${selected.participation.activity.id}?termId=${term.id}&tab=evidence`}
										className="mt-2 inline-block text-sm underline underline-offset-4"
									>
										查看活动详情与证明
									</Link>
								</div>
								<div>
									<h3 className="text-sm font-medium">提交信息</h3>
									<p className="mt-2 text-sm">
										{selected.submitterName || "主办学院"}
									</p>
									<p className="text-xs text-muted-foreground">
										提交于 {dateText(selected.createdAt)}
									</p>
									{selected.participation.registrationSnapshot && (
										<p className="mt-2 text-xs text-muted-foreground">
											登记时班级：
											{[
												selected.participation.registrationSnapshot
													.college,
												selected.participation.registrationSnapshot
													.major,
												selected.participation.registrationSnapshot
													.className,
											]
												.filter(Boolean)
												.map(String)
												.join(" / ") || "未记录"}
										</p>
									)}
								</div>
							</section>
							<section>
								<h3 className="mb-2 text-sm font-medium">参与说明</h3>
								<p className="whitespace-pre-wrap text-sm leading-7">
									{selected.note}
								</p>
							</section>
							<section>
								<h3 className="mb-3 text-sm font-medium">活动证明</h3>
								{selected.activityEvidence ? (
									<div className="flex flex-col gap-2 rounded-lg border p-4">
										<div className="flex flex-wrap items-center justify-between gap-2">
											<p className="text-sm font-medium">
												第 {selected.activityEvidence.version} 版 ·{" "}
												{selected.activityEvidence.note}
											</p>
											<Badge
												variant={
													selected.activityEvidence.active
														? "default"
														: "outline"
												}
											>
												{selected.activityEvidence.active
													? "当前有效"
													: "历史版本"}
											</Badge>
										</div>
										<p className="text-xs text-muted-foreground">
											上传于{" "}
											{dateText(selected.activityEvidence.createdAt)}
										</p>
										<EvidenceViewer
											evidence={selected.activityEvidence.evidence}
										/>
									</div>
								) : selected.evidence.length ? (
									<div className="flex flex-col gap-2">
										{selected.evidence.map(({ evidence }) => (
											<EvidenceViewer key={evidence.id} evidence={evidence} />
										))}
									</div>
								) : (
									<p className="text-sm text-muted-foreground">
										还没有活动证明。请主办学院先在活动详情中上传。
									</p>
								)}
							</section>
							{(selected.reviewerName ||
								selected.counselorName ||
								selected.collegeReviewerName ||
								selected.reviewReason) && (
								<section className="rounded-lg border p-4">
									<h3 className="mb-2 text-sm font-medium">审核记录</h3>
									<dl className="grid gap-2 text-sm sm:grid-cols-2">
										<div>
											<dt className="text-xs text-muted-foreground">
												辅导员审核
											</dt>
											<dd>
												{selected.counselorName || "尚未审核"}
												{selected.counseledAt
													? ` · ${dateText(selected.counseledAt)}`
													: ""}
											</dd>
										</div>
										<div>
											<dt className="text-xs text-muted-foreground">
												学院审核
											</dt>
											<dd>
												{selected.collegeReviewerName || "尚未审核"}
												{selected.collegeReviewedAt
													? ` · ${dateText(selected.collegeReviewedAt)}`
													: ""}
											</dd>
										</div>
									</dl>
									{selected.reviewReason && (
										<p className="mt-3 whitespace-pre-wrap text-sm">
											{selected.reviewReason}
										</p>
									)}
								</section>
							)}
							{active && selected.canReview && (
								<form
									className="flex flex-col gap-4 border-t pt-5"
									onChange={() => setDirty(true)}
									onSubmit={async (event) => {
										event.preventDefault();
										if (busy) return;
										const form = new FormData(event.currentTarget);
										const submitter = (event.nativeEvent as SubmitEvent)
											.submitter as HTMLButtonElement;
										await submit(submitter.value, {
											reason: form.get("reason") || undefined,
										});
									}}
								>
									<FieldGroup>
										<Field>
											<FieldLabel htmlFor="review-reason">
												审核意见
											</FieldLabel>
											<Textarea
												id="review-reason"
												name="reason"
												minLength={2}
												maxLength={1000}
												rows={4}
												placeholder="通过可填写依据；退回请说明需要修改的内容"
											/>
											<FieldDescription>
												{selected.status === "PENDING_COUNSELOR"
													? "通过后由学生所在学院审核；退回由主办学院补充证明或更正参与信息。"
													: "通过后计分；退回由主办学院补充材料或更正后重新提交。"}
											</FieldDescription>
										</Field>
									</FieldGroup>
									<div className="flex flex-wrap gap-3">
										<Button
											type="submit"
											value={
												selected.status === "PENDING_COUNSELOR"
													? "counselorApprove"
													: "collegeApprove"
											}
											formNoValidate
											disabled={busy}
										>
											{selected.status === "PENDING_COUNSELOR"
												? "核对通过"
												: "审核通过并计分"}
										</Button>
										<Button
											type="submit"
											variant="outline"
											value={
												selected.status === "PENDING_COUNSELOR"
													? "counselorReturn"
													: "collegeReturn"
											}
											disabled={busy}
										>
											退回主办学院
										</Button>
									</div>
								</form>
							)}
							{active &&
								role === "ADMIN" &&
								selected.status === "APPROVED" && (
									<form
										className="flex flex-col gap-4 border-t pt-5"
										onChange={() => setDirty(true)}
										onSubmit={async (event) => {
											event.preventDefault();
											if (busy) return;
											const form = new FormData(event.currentTarget);
											await submit("revoke", {
												reason: form.get("reason"),
											});
										}}
									>
										<FieldGroup>
											<Field>
												<FieldLabel htmlFor="recognition-revoke">
													撤销原因
												</FieldLabel>
												<Textarea
													id="recognition-revoke"
													name="reason"
													required
													minLength={2}
													maxLength={1000}
													rows={3}
												/>
												<FieldDescription>
													仅用于重复来源、材料失实等情况；撤销后立即停止计分。
												</FieldDescription>
											</Field>
										</FieldGroup>
										<Button
											type="submit"
											variant="outline"
											disabled={busy}
										>
											撤销认定
										</Button>
									</form>
								)}
							{active &&
								selected.canManage &&
								!selected.participation.removedAt &&
								selected.status === "RETURNED" && (
									<form
										className="flex flex-col gap-4 border-t pt-5"
										onChange={() => setDirty(true)}
										onSubmit={async (event) => {
											event.preventDefault();
											if (busy) return;
											const form = new FormData(event.currentTarget);
											await submit("resubmit", {
												note: form.get("note"),
												reason: form.get("reason") || undefined,
											});
										}}
									>
										<FieldGroup>
											<Field>
												<FieldLabel htmlFor="recognition-resubmit-note">
													参与说明
												</FieldLabel>
												<Textarea
													id="recognition-resubmit-note"
													name="note"
													defaultValue={selected.note}
													required
													minLength={2}
													maxLength={2000}
													rows={4}
												/>
											</Field>
											<Field>
												<FieldLabel htmlFor="recognition-resubmit-reason">
													更正原因
												</FieldLabel>
												<Textarea
													id="recognition-resubmit-reason"
													name="reason"
													maxLength={1000}
													rows={3}
													placeholder="更正得分或补充参与记录时说明依据"
												/>
											</Field>
										</FieldGroup>
										<FieldDescription>
											活动证明：
											{selected.activityEvidence?.active
												? `第 ${selected.activityEvidence.version} 版有效`
												: "尚未上传有效证明，请先在活动详情上传"}
										</FieldDescription>
										<Button type="submit" disabled={busy}>
											重新提交审核
										</Button>
									</form>
								)}
							{active &&
								selected.canManage &&
								!selected.participation.removedAt && (
									<form
										className="flex flex-col gap-4 border-t pt-5"
										onChange={() => setDirty(true)}
										onSubmit={async (event) => {
											event.preventDefault();
											if (busy) return;
											if (
												!window.confirm(
													"确认移除该学生的参与记录？已通过的认定将停止计分，历史记录保留。",
												)
											)
												return;
											const form = new FormData(event.currentTarget);
											await submit("remove", {
												reason: form.get("reason"),
											});
										}}
									>
										<FieldGroup>
											<Field>
												<FieldLabel htmlFor="recognition-remove-reason">
													移除原因
												</FieldLabel>
												<Textarea
													id="recognition-remove-reason"
													name="reason"
													required
													minLength={2}
													maxLength={1000}
													rows={3}
													placeholder="说明该学生实际未参加或名单录入错误"
												/>
												<FieldDescription>
													移除会保留历史记录。已通过的认定停止计分，待审记录同时撤回。
												</FieldDescription>
											</Field>
										</FieldGroup>
										<Button
											type="submit"
											variant="outline"
											disabled={busy}
										>
											确认移除
										</Button>
									</form>
								)}
							<Separator />
							<section>
								<h3 className="mb-3 text-sm font-medium">处理记录</h3>
								<HistoryList items={selected.history} />
							</section>
						</div>
					)}
				</SheetContent>
			</Sheet>
		</>
	);
}
