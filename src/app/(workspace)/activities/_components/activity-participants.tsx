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
	history?: History[];
	sources: {
		id: string;
		status: string;
		evidence?: {
			evidence: { id: string; name: string; mime: string; size: number };
		}[];
		reviewReason?: string | null;
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
	REVIEWED: "审核认定",
	WITHDRAW: "撤回",
	REVOKE: "撤销认定",
	CLOSE: "结束认定",
	RESUBMIT: "重新提交",
	SUBMITTED: "提交认定",
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
			<h2 className="text-base font-medium">本人后台参与登记</h2>
			<dl className="grid gap-5 sm:grid-cols-2">
				<div>
					<dt className="text-xs text-muted-foreground">登记时间</dt>
					<dd className="mt-1 text-sm">
						{dateText(participation.registeredAt)}
					</dd>
				</div>
				<div>
					<dt className="text-xs text-muted-foreground">活动分数</dt>
					<dd className="mt-1 text-sm">
						{individual
							? (participation.score ?? "尚未录分")
							: `${points} 分（固定）`}
					</dd>
				</div>
				{snapshot && (
					<div className="sm:col-span-2">
						<dt className="text-xs text-muted-foreground">登记时学生归属</dt>
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
								.join(" / ") || "未记录历史归属"}
						</dd>
					</div>
				)}
			</dl>
			<p className="text-sm text-muted-foreground">
				登记保留参与事实，审核通过后才计分。历史身份不扩大当前活动申报资格。
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
			<h3 className="text-sm font-medium">参与与录分历史</h3>
			<HistoryList items={participation.history} />
		</section>
	);
}
export function ActivityParticipants({
	activityId,
	termId,
	owner,
	active,
	individual,
	points,
}: {
	activityId: string;
	termId: string;
	owner: boolean;
	active: boolean;
	individual: boolean;
	points: string;
}) {
	const path = usePathname();
	const params = useSearchParams();
	const page = Math.max(
		1,
		Math.min(100000, Math.floor(Number(params.get("participantPage")) || 1)),
	);
	const query = params.get("participantQ") || "";
	const remote = useRemote<{
		items: Participant[];
		total: number;
		page: number;
	}>(
		`/api/activities/participants?termId=${termId}&activityId=${activityId}&page=${page}&q=${encodeURIComponent(query)}`,
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
			header: "登记时归属",
			cell: ({ row }) => (
				<div className="text-sm">
					{row.original.college}
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
					: "未后台登记",
		},
		{
			id: "score",
			header: "活动分数",
			cell: ({ row }) =>
				individual
					? (row.original.score ?? "尚未录分")
					: `${points} 分（固定）`,
		},
		{
			id: "sources",
			header: "认定状态",
			cell: ({ row }) => (
				<div className="flex flex-wrap gap-1">
					{row.original.sources.map((source) => (
						<Badge key={source.id} variant="outline">
							{statusLabels[source.status] || source.status}
						</Badge>
					))}
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
					{owner && active && individual ? "录分 / 历史" : "详情 / 历史"}
				</Button>
			),
		},
	];
	return (
		<>
			<RemoteState {...remote} />
			{remote.data && (
				<TemplateDirectory
					title="活动参与名录"
					description={`共 ${remote.data.total} 位参与学生。导入按追加处理，文件遗漏不会删除已登记参与；审核通过后才计分。`}
					data={remote.data.items}
					columns={columns}
					filters={
						<form action={path} className="flex flex-wrap items-end gap-3">
							{params.get("returnTo") && (
								<input
									type="hidden"
									name="returnTo"
									value={params.get("returnTo")!}
								/>
							)}
							<Field>
								<FieldLabel htmlFor="participant-search">姓名或学号</FieldLabel>
								<Input
									id="participant-search"
									name="participantQ"
									defaultValue={query}
								/>
							</Field>
							<Button variant="outline">筛选</Button>
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
									? (row.score ?? "尚未录分")
									: `${points} 分（固定）`}{" "}
								·{" "}
								{row.sources
									.map((source) => statusLabels[source.status] || source.status)
									.join("、")}
							</p>
							<p className="text-xs text-muted-foreground">
								{row.registeredAt ? dateText(row.registeredAt) : "未后台登记"}
							</p>
							<Button
								variant="outline"
								className="self-start"
								onClick={() => {
									setSelected(row);
									setError("");
									setDirty(false);
								}}
							>
								详情 / 录分历史
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
							参与事实、活动分数及认定处理记录
						</SheetDescription>
					</SheetHeader>
					{selected && (
						<div className="flex flex-col gap-5 px-5 pb-6">
							<Feedback error={error} />
							<dl className="grid gap-4 sm:grid-cols-2">
								<div>
									<dt className="text-xs text-muted-foreground">登记时间</dt>
									<dd className="text-sm">
										{selected.registeredAt
											? dateText(selected.registeredAt)
											: "未后台登记"}
									</dd>
								</div>
								<div>
									<dt className="text-xs text-muted-foreground">当前分数</dt>
									<dd className="text-sm">
										{individual
											? (selected.score ?? "尚未录分")
											: `${points} 分（固定）`}
									</dd>
								</div>
								<div className="sm:col-span-2">
									<dt className="text-xs text-muted-foreground">登记时归属</dt>
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
													.join(" / ") || "未记录历史归属"
											: "未记录历史归属"}
									</dd>
								</div>
							</dl>
							{owner && active && individual && selected.registeredAt && (
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
												该学生活动分数
											</FieldLabel>
											<Input
												id="participation-score"
												name="value"
												inputMode="decimal"
												defaultValue={selected.score ?? ""}
												required
											/>
											<FieldDescription>
												上限 {points}{" "}
												分。缺分不视为零；更改已通过认定的分数会使相应认定重新待审。
											</FieldDescription>
										</Field>
										<Field>
											<FieldLabel htmlFor="participation-score-reason">
												录入或更正理由
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
									<Button disabled={busy}>保存活动分数</Button>
								</form>
							)}
							<Separator />
							<h3 className="text-sm font-medium">参与与录分历史</h3>
							<HistoryList items={selected.history} />
							{selected.sources.map((source) => (
								<section key={source.id} className="flex flex-col gap-3">
									<Badge className="self-start" variant="outline">
										{statusLabels[source.status] || source.status}
									</Badge>
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
