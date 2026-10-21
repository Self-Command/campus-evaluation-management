"use client";
// Complete users directory and profile details/history, preserving table/filter/pagination and sheet sections.
import { EvidenceViewer } from "@/components/dashboard/evidence-viewer";
import { useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import type { DataTableFeatures } from "@/lib/data-table-features";
import { TemplateDirectory } from "@/components/dashboard/template-directory";
import { RemoteState } from "@/components/dashboard/remote-state";
import { useRemote } from "@/components/dashboard/use-remote";
import { Feedback, requestJson } from "@/components/dashboard/feedback";
import { useUnsavedChanges } from "@/components/dashboard/use-unsaved-changes";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
	NativeSelect,
	NativeSelectOption,
} from "@/components/ui/native-select";
import {
	FieldGroup,
	Field,
	FieldLabel,
	FieldDescription,
} from "@/components/ui/field";
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
	SheetDescription,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { dateText, statusLabels } from "@/lib/business-labels";
type History = {
	id?: string;
	at: string;
	action: string;
	before?: unknown;
	after?: unknown;
	reason?: string;
};
type Participant = {
	id: string;
	studentId: string;
	login: string;
	name: string;
	college: string;
	major: string;
	className: string;
	registeredAt: string;
	registrationSnapshot: Record<string, unknown> | null;
	score: string | null;
	revision: number;
	removedAt?: string | null;
	removalReason?: string | null;
	history?: History[];
	sources: {
		id: string;
		status: string;
		activityEvidenceId?: string | null;
		evidence?: {
			evidence: { id: string; name: string; mime: string; size: number };
		}[];
		reviewReason?: string | null;
		reviewerName?: string | null;
		counselorName?: string | null;
		collegeReviewerName?: string | null;
		returnedByRole?: string | null;
		history?: History[];
	}[];
};
const historyLabels: Record<string, string> = {
	REGISTER: "登记参加",
	REGISTERED: "登记参加",
	IMPORT: "导入登记",
	IMPORTED: "导入登记",
	SCORE_REVIEW_REQUIRED: "分数更改，须重新审核",
	SCORE: "录入活动分数",
	SCORE_CHANGED: "更正活动分数",
	SCORE_CORRECTED: "更正活动得分",
	SCORE_SUPERSEDED: "得分更正，原认定已替代",
	REVIEWED: "审核参与",
	WITHDRAW: "撤回",
	REVOKE: "撤销",
	CLOSE: "结束参与",
	RESUBMIT: "重新提交",
	SUBMITTED: "提交审核",
	PARTICIPATION_REMOVED: "移除参与",
	PARTICIPATION_RESTORED: "恢复参与",
	COUNSELOR_APPROVE: "辅导员通过",
	COUNSELOR_RETURN: "辅导员退回",
	COLLEGE_APPROVE: "学院通过",
	COLLEGE_RETURN: "学院退回",
	EVIDENCE_SUPERSEDED: "活动证明已更新",
	EVIDENCE_REOPENED: "按新证明重新提交",
	CORRECTION_ADDED: "补录参与",
	CORRECTION_SUPERSEDED: "更正替代旧认定",
	CORRECTION_RESUBMITTED: "更正后重新提交",
};
function HistoryList({ items }: { items?: History[] }) {
	return (
		<div className="flex flex-col gap-3">
			{items?.length ? (
				items.map((event, index) => (
					<div
						key={event.id || index}
						className="flex flex-col gap-1 border-l pl-3"
					>
						<p className="text-sm">
							{historyLabels[event.action] || "记录变更"} · {dateText(event.at)}
						</p>
						{event.before !== undefined && (
							<p className="break-words text-xs text-muted-foreground">
								变更前：
								{typeof event.before === "string"
									? event.before
									: JSON.stringify(event.before)}
							</p>
						)}
						{event.after !== undefined && (
							<p className="break-words text-xs text-muted-foreground">
								变更后：
								{typeof event.after === "string"
									? statusLabels[event.after] || event.after
									: JSON.stringify(event.after)}
							</p>
						)}
						<p className="whitespace-pre-wrap text-sm text-muted-foreground">
							{event.reason}
						</p>
					</div>
				))
			) : (
				<p className="text-sm text-muted-foreground">暂无变更记录。</p>
			)}
		</div>
	);
}
export function OwnParticipation({
	participation,
	individual,
	points,
}: {
	participation: NonNullable<
		import("./activity-form").Activity["ownParticipation"]
	>;
	individual: boolean;
	points: string;
}) {
	const snapshot = participation.registrationSnapshot;
	return (
		<section className="flex flex-col gap-4 py-4">
			<h2 className="text-base font-medium">我的参与登记</h2>
			<dl className="grid gap-5 sm:grid-cols-2">
				<div>
					<dt className="text-xs text-muted-foreground">登记时间</dt>
					<dd className="mt-1 text-sm">
						{dateText(participation.registeredAt)}
					</dd>
				</div>
				<div>
					<dt className="text-xs text-muted-foreground">活动得分</dt>
					<dd className="mt-1 text-sm">
						{individual
							? (participation.score ?? "未录分")
							: `${points} 分（统一）`}
					</dd>
				</div>
				{snapshot && (
					<div className="sm:col-span-2">
						<dt className="text-xs text-muted-foreground">登记时班级</dt>
						<dd className="mt-1 text-sm">
							{[
								snapshot.name,
								snapshot.login,
								snapshot.college,
								snapshot.major,
								snapshot.className,
							]
								.filter(Boolean)
								.map(String)
								.join(" / ") || "未记录历史班级"}
						</dd>
					</div>
				)}
			</dl>
			{participation.removedAt && (
				<div className="rounded-lg border border-dashed p-3">
					<p className="text-sm font-medium">该参与记录已被移除</p>
					<p className="mt-1 text-sm text-muted-foreground">
						{participation.removalReason || "如有疑问，请联系活动主办学院核对。"}
					</p>
				</div>
			)}
			<p className="text-sm text-muted-foreground">
				登记后需审核，通过才计分。登记时的班级只用于保留记录，不影响当前活动范围。
			</p>
			{participation.sources.map((source) => (
				<div key={source.id} className="flex flex-col gap-2 border-l pl-3">
					<Badge variant="outline" className="self-start">
						{statusLabels[source.status] || source.status}
					</Badge>
					<p className="text-sm text-muted-foreground">{source.reviewReason}</p>
					{source.evidence?.map(({ evidence }) => (
						<EvidenceViewer key={evidence.id} evidence={evidence} />
					))}
					<HistoryList items={source.history} />
				</div>
			))}
			<h3 className="text-sm font-medium">参与和得分记录</h3>
			<HistoryList items={participation.history} />
		</section>
	);
}
export function ActivityParticipants({
	activityId,
	termId,
	canManage,
	active,
	individual,
	points,
	hostCollege,
	rosterCommitted,
}: {
	activityId: string;
	termId: string;
	canManage: boolean;
	active: boolean;
	individual: boolean;
	points: string;
	hostCollege: string | null;
	rosterCommitted: boolean;
}) {
	const path = usePathname();
	const params = useSearchParams();
	const page = Math.max(
		1,
		Math.min(100000, Math.floor(Number(params.get("participantPage")) || 1)),
	);
	const query = params.get("participantQ") || "";
	const status = params.get("participantStatus") || "";
	const removed = params.get("participantRemoved") || "active";
	const queryString = new URLSearchParams({
		termId,
		activityId,
		page: String(page),
		q: query,
		status,
		removed,
	});
	const remote = useRemote<{
		items: Participant[];
		total: number;
		page: number;
	}>(
		`/api/activities/participants?${queryString.toString()}`,
	);
	const [selected, setSelected] = useState<Participant | null>(null);
	const [busy, setBusy] = useState(false);
	const [dirty, setDirty] = useState(false);
	const [error, setError] = useState("");
	useUnsavedChanges(dirty || busy);
	const columns: ColumnDef<DataTableFeatures, Participant>[] = [
		{
			id: "student",
			header: "学生",
			cell: ({ row }) => (
				<div>
					<p className="font-medium">{row.original.name}</p>
					<p className="text-xs text-muted-foreground">{row.original.login}</p>
				</div>
			),
		},
		{
			id: "organization",
			header: "学院 / 班级",
			cell: ({ row }) => (
				<div className="text-sm">
					{row.original.college || "—"}
					<p className="text-xs text-muted-foreground">
						{row.original.major} / {row.original.className}
					</p>
				</div>
			),
		},
		{
			accessorKey: "registeredAt",
			header: "登记时间",
			cell: ({ row }) =>
				row.original.registeredAt
					? dateText(row.original.registeredAt)
					: "未登记",
		},
		{
			id: "score",
			header: "活动得分",
			cell: ({ row }) =>
				individual
					? (row.original.score ?? "未录分")
					: `${points} 分（统一）`,
		},
		{
			id: "sources",
			header: "审核状态",
			cell: ({ row }) => (
				<div className="flex flex-col gap-1">
					<div className="flex flex-wrap gap-1">
						{row.original.sources.length ? (
							row.original.sources.map((source) => (
								<Badge key={source.id} variant="outline">
									{statusLabels[source.status] || source.status}
								</Badge>
							))
						) : (
							<span className="text-xs text-muted-foreground">暂无审核记录</span>
						)}
					</div>
					{row.original.removedAt && (
						<Badge variant="secondary" className="self-start">
							{statusLabels.REMOVED}
						</Badge>
					)}
				</div>
			),
		},
		{
			id: "actions",
			header: "操作",
			cell: ({ row }) => (
				<Button
					variant="ghost"
					size="sm"
					onClick={() => {
						setSelected(row.original);
						setDirty(false);
						setError("");
					}}
				>
					{canManage && active && individual && !row.original.removedAt
						? "录入得分"
						: "查看"}
				</Button>
			),
		},
	];
	return (
		<>
			<RemoteState {...remote} />
			{remote.data && (
				<TemplateDirectory
					title="活动参与名单"
					description={`共 ${remote.data.total} 位参与学生。${
						rosterCommitted
							? "名单已保存；漏报或错报从活动详情补录，移除参与需填写原因。"
							: "尚未提交名单；首次导入后，后续变更需补录。"
					}审核通过后才计分。`}
					data={remote.data.items}
					columns={columns}
					filters={
						<form action={path} className="flex flex-wrap items-end gap-3">
							<input type="hidden" name="termId" value={termId} />
							<input type="hidden" name="tab" value="participants" />
							{params.get("returnTo") && (
								<input
									type="hidden"
									name="returnTo"
									value={params.get("returnTo")!}
								/>
							)}
							<Field className="w-full sm:w-48">
								<FieldLabel htmlFor="participant-search">姓名或学号</FieldLabel>
								<Input
									id="participant-search"
									name="participantQ"
									defaultValue={query}
								/>
							</Field>
							<Field className="w-full sm:w-44">
								<FieldLabel htmlFor="participant-status">审核状态</FieldLabel>
								<NativeSelect
									id="participant-status"
									name="participantStatus"
									defaultValue={status}
								>
									<NativeSelectOption value="">全部状态</NativeSelectOption>
									<NativeSelectOption value="PENDING">待审核</NativeSelectOption>
									{[
										"PENDING_COUNSELOR",
										"PENDING_COLLEGE",
										"RETURNED",
										"APPROVED",
										"SUPERSEDED",
										"WITHDRAWN",
										"REVOKED",
										"REJECTED",
									].map((value) => (
										<NativeSelectOption key={value} value={value}>
											{statusLabels[value] || value}
										</NativeSelectOption>
									))}
								</NativeSelect>
							</Field>
							<Field className="w-full sm:w-40">
								<FieldLabel htmlFor="participant-removed">参与记录</FieldLabel>
								<NativeSelect
									id="participant-removed"
									name="participantRemoved"
									defaultValue={removed}
								>
									<NativeSelectOption value="active">未移除</NativeSelectOption>
									<NativeSelectOption value="removed">已移除</NativeSelectOption>
									<NativeSelectOption value="all">全部</NativeSelectOption>
								</NativeSelect>
							</Field>
							<Button type="submit" variant="outline">筛选</Button>
						</form>
					}
					pagination={{
						page: remote.data.page,
						total: remote.data.total,
						href: (number) => {
							const next = new URLSearchParams(params.toString());
							next.set("participantPage", String(number));
							return `${path}?${next}`;
						},
					}}
					mobile={(row) => (
						<div className="flex flex-col gap-3">
							<p className="font-medium">
								{row.name} · {row.login}
							</p>
							<p className="text-xs text-muted-foreground">
								{row.college} / {row.major} / {row.className}
							</p>
							<p className="text-sm">
								{individual
									? (row.score ?? "未录分")
									: `${points} 分（统一）`}{" "}
								·{" "}
								{row.sources
									.map((source) => statusLabels[source.status] || source.status)
									.join("、") || "暂无审核记录"}
								{row.removedAt ? " · 已移除" : ""}
							</p>
							<p className="text-xs text-muted-foreground">
								{row.registeredAt ? dateText(row.registeredAt) : "未登记"}
							</p>
							{row.removedAt && row.removalReason && (
								<p className="text-xs text-muted-foreground">
									移除原因：{row.removalReason}
								</p>
							)}
							<Button
								variant="outline"
								className="self-start"
								onClick={() => {
									setSelected(row);
									setError("");
									setDirty(false);
								}}
							>
								查看
							</Button>
						</div>
					)}
				/>
			)}
			<Sheet
				open={!!selected}
				onOpenChange={(open) => {
					if (
						!open &&
						!busy &&
						(!dirty || window.confirm("放弃尚未保存的活动分数？"))
					)
						setSelected(null);
				}}
			>
				<SheetContent className="w-full overflow-y-auto sm:max-w-xl">
					<SheetHeader>
						<SheetTitle>
							{selected?.name} · {selected?.login}
						</SheetTitle>
						<SheetDescription>
							{hostCollege ? `主办学院：${hostCollege} · ` : ""}
							参与记录、活动得分和审核记录
						</SheetDescription>
					</SheetHeader>
					{selected && (
						<div className="flex flex-col gap-5 px-5 pb-6">
							<Feedback error={error} />
							{selected.removedAt && (
								<div className="rounded-lg border border-dashed p-3">
									<p className="text-sm font-medium">该参与记录已移除</p>
									<p className="mt-1 text-sm text-muted-foreground">
										{selected.removalReason || "未填写原因"}
									</p>
									<p className="mt-1 text-xs text-muted-foreground">
										{selected.removedAt && dateText(selected.removedAt)}
									</p>
								</div>
							)}
							<dl className="grid gap-4 sm:grid-cols-2">
								<div>
									<dt className="text-xs text-muted-foreground">登记时间</dt>
									<dd className="text-sm">
										{selected.registeredAt
											? dateText(selected.registeredAt)
											: "未登记"}
									</dd>
								</div>
								<div>
									<dt className="text-xs text-muted-foreground">当前得分</dt>
									<dd className="text-sm">
										{individual
											? (selected.score ?? "未录分")
											: `${points} 分（统一）`}
									</dd>
								</div>
								<div className="sm:col-span-2">
									<dt className="text-xs text-muted-foreground">登记时班级</dt>
									<dd className="mt-1 text-sm">
										{selected.registrationSnapshot
											? [
													selected.registrationSnapshot.name,
													selected.registrationSnapshot.login,
													selected.registrationSnapshot.college,
													selected.registrationSnapshot.major,
													selected.registrationSnapshot.className,
												]
													.filter(Boolean)
													.map(String)
													.join(" / ") || "未记录历史班级"
											: "未记录历史班级"}
									</dd>
								</div>
							</dl>
							{canManage &&
								active &&
								individual &&
								selected.registeredAt &&
								!selected.removedAt && (
								<form
									className="flex flex-col gap-4"
									onChange={() => setDirty(true)}
									onSubmit={async (event) => {
										event.preventDefault();
										if (busy) return;
										setBusy(true);
										setError("");
										const form = new FormData(event.currentTarget);
										try {
											await requestJson("/api/activities", {
												action: "score",
												termId,
												participationId: selected.id,
												revision: selected.revision,
												value: form.get("value"),
												reason: form.get("reason"),
											});
											setDirty(false);
											setSelected(null);
											remote.reload();
										} catch (err) {
											setError((err as Error).message);
										} finally {
											setBusy(false);
										}
									}}
								>
									<FieldGroup>
										<Field>
											<FieldLabel htmlFor="participation-score">
												活动得分
											</FieldLabel>
											<Input
												id="participation-score"
												name="value"
												inputMode="decimal"
												defaultValue={selected.score ?? ""}
												required
											/>
											<FieldDescription>
												最高 {points}{" "}
												分。未录分不会按 0 分计算；更改已通过的得分会重新进入审核。
											</FieldDescription>
										</Field>
										<Field>
											<FieldLabel htmlFor="participation-score-reason">
												录入或更正原因
											</FieldLabel>
											<Textarea
												id="participation-score-reason"
												name="reason"
												minLength={2}
												maxLength={1000}
												required
											/>
										</Field>
									</FieldGroup>
									<Button type="submit" disabled={busy}>保存得分</Button>
								</form>
							)}
							<Separator />
							<h3 className="text-sm font-medium">参与和得分记录</h3>
							<HistoryList items={selected.history} />
							{selected.sources.map((source) => (
								<section key={source.id} className="flex flex-col gap-3">
									<Badge className="self-start" variant="outline">
										{statusLabels[source.status] || source.status}
									</Badge>
									<div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
										{source.counselorName && (
											<span>辅导员审核：{source.counselorName}</span>
										)}
										{source.collegeReviewerName && (
											<span>学院审核：{source.collegeReviewerName}</span>
										)}
										{source.returnedByRole && (
											<span>
												当前退回至：
												{source.returnedByRole === "COLLEGE"
													? "学院审核"
													: "辅导员审核"}
											</span>
										)}
									</div>
									<p className="whitespace-pre-wrap text-sm">
										{source.reviewReason}
									</p>
									{source.evidence?.map(({ evidence }) => (
										<EvidenceViewer key={evidence.id} evidence={evidence} />
									))}
									<HistoryList items={source.history} />
								</section>
							))}
						</div>
					)}
				</SheetContent>
			</Sheet>
		</>
	);
}
