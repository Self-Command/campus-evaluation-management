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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
	NativeSelect,
	NativeSelectOption,
} from "@/components/ui/native-select";
import { Field, FieldLabel } from "@/components/ui/field";
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
const ownStatusLabels: Record<string, { label: string; hint: string }> = {
	APPROVED: {
		label: "已通过",
		hint: "审核已通过，活动得分已计入总评。",
	},
	PENDING: {
		label: "等待审核",
		hint: "学院已提交你的参与记录，审核结果会在这里更新。",
	},
	PENDING_COUNSELOR: {
		label: "等待辅导员审核",
		hint: "辅导员审核后进入学院审核，你无需操作。",
	},
	PENDING_COLLEGE: {
		label: "等待学院审核",
		hint: "学院审核通过后计分，你无需操作。",
	},
	RETURNED: {
		label: "已退回重审",
		hint: "学院正在核对这份名单，你无需操作；如有疑问请联系主办学院。",
	},
	SUPERSEDED: {
		label: "已被新记录替代",
		hint: "学院更新了你的参与记录，以最新一次认定为准。",
	},
	RESCORING: {
		label: "等待重新评分",
		hint: "学院正在重新核对这条参与记录，你无需操作。",
	},
	WITHDRAWN: {
		label: "已撤回",
		hint: "主办学院撤回了这条参与记录。",
	},
	REVOKED: {
		label: "已撤销",
		hint: "这条参与记录已撤销，不计分。",
	},
	REJECTED: {
		label: "未通过",
		hint: "审核未通过，这条参与不计分。",
	},
	REMOVED: {
		label: "已移除",
		hint: "学院已将你移出这份参与名单。",
	},
	NONE: {
		label: "等待提交名单",
		hint: "学院尚未提交这份参与名单，提交后可在这里查看审核进度。",
	},
};
function snapshotText(snapshot: Record<string, unknown>, key: string) {
	const value = snapshot[key];
	return typeof value === "string" && value.trim() ? value : "";
}
export function OwnParticipation({
	participation,
	points,
}: {
	participation: NonNullable<
		import("./activity-form").Activity["ownParticipation"]
	>;
	points: string;
}) {
	const sources = [...participation.sources].sort((a, b) =>
		(a.createdAt ?? "").localeCompare(b.createdAt ?? ""),
	);
	const latest = sources.at(-1);
	const status = participation.removedAt
		? "REMOVED"
		: (latest?.status ?? "NONE");
	const meta = ownStatusLabels[status] ?? ownStatusLabels.NONE;
	const approved = status === "APPROVED";
	const scored = ["REMOVED", "WITHDRAWN", "REVOKED", "REJECTED"].includes(status);
	const snapshot = participation.registrationSnapshot ?? {};
	const facts = [
		["学号", snapshotText(snapshot, "login") || snapshotText(snapshot, "studentNumber")],
		["学院", snapshotText(snapshot, "college")],
		["专业", snapshotText(snapshot, "major")],
		["班级", snapshotText(snapshot, "className")],
	].filter(([, value]) => value);
	const reviewNote = latest?.reviewReason?.trim();
	const evidence = [
		...new Map(
			sources
				.flatMap((source) => source.evidence ?? [])
				.map(({ evidence: file }) => [file.id, file]),
		).values(),
	];
	const history = [
		...new Map(
			[...(participation.history ?? []), ...sources.flatMap((source) => source.history ?? [])]
				.filter((event) => event.action)
				.map((event) => [`${event.action}-${event.at}`, event]),
		).values(),
	].sort((a, b) => b.at.localeCompare(a.at));
	return (
		<section className="flex flex-col gap-5 py-4">
			<div className="rounded-lg border p-5">
				<div className="flex flex-wrap items-start justify-between gap-4">
					<div className="flex flex-col gap-1">
						<p className="text-xs text-muted-foreground">审核状态</p>
						<p className="text-lg font-semibold">{meta.label}</p>
					</div>
					<div className="text-right">
						<p className="text-xs text-muted-foreground">
							{approved
								? "已获活动得分"
								: scored
									? "活动得分"
									: "审核通过后获得"}
						</p>
						<p className="text-2xl font-semibold tabular-nums">
							{scored ? "不计分" : `${points} 分`}
						</p>
					</div>
				</div>
				<p className="mt-3 text-sm text-muted-foreground">{meta.hint}</p>
				{participation.removedAt && (
					<div className="mt-3 rounded-md border border-dashed p-3">
						<p className="text-sm font-medium">
							{dateText(participation.removedAt)} 移出名单
						</p>
						<p className="mt-1 text-sm text-muted-foreground">
							{participation.removalReason?.trim() || "未填写移除原因。"}
						</p>
					</div>
				)}
				<dl className="mt-5 grid gap-4 border-t pt-4 sm:grid-cols-2">
					<div>
						<dt className="text-xs text-muted-foreground">登记时间</dt>
						<dd className="mt-1 text-sm">
							{dateText(participation.registeredAt)}
						</dd>
					</div>
					{facts.map(([label, value]) => (
						<div key={label}>
							<dt className="text-xs text-muted-foreground">{label}</dt>
							<dd className="mt-1 text-sm">{value}</dd>
						</div>
					))}
				</dl>
			</div>
			{reviewNote && (
				<div className="rounded-lg border p-4">
					<p className="text-xs text-muted-foreground">审核说明</p>
					<p className="mt-1 whitespace-pre-wrap text-sm">{reviewNote}</p>
				</div>
			)}
			{evidence.length > 0 && (
				<div className="flex flex-col gap-2 rounded-lg border p-4">
					<p className="text-xs text-muted-foreground">证明附件</p>
					{evidence.map((file) => (
						<EvidenceViewer key={file.id} evidence={file} />
					))}
				</div>
			)}
			{history.length > 0 && (
				<section className="flex flex-col gap-3">
					<h3 className="text-sm font-medium">处理记录</h3>
					{history.map((event, index) => (
						<div
							key={`${event.action}-${event.at}-${index}`}
							className="flex flex-col gap-1 border-l pl-3"
						>
							<p className="text-sm">
								{historyLabels[event.action] || "记录变更"} · {dateText(event.at)}
							</p>
							{event.reason?.trim() && (
								<p className="whitespace-pre-wrap text-sm text-muted-foreground">
									{event.reason}
								</p>
							)}
						</div>
					))}
				</section>
			)}
		</section>
	);
}
export function ActivityParticipants({
	activityId,
	termId,
	points,
	hostCollege,
	rosterCommitted,
}: {
	activityId: string;
	termId: string;
	canManage: boolean;
	active: boolean;
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
			cell: () => `${points} 分`,
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
					onClick={() => setSelected(row.original)}
				>
					查看
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
								{points} 分 ·{" "}
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
								onClick={() => setSelected(row)}
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
					if (!open) setSelected(null);
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
									<dd className="text-sm">{points} 分</dd>
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
							<Separator />
							<h3 className="text-sm font-medium">参与和审核记录</h3>
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
