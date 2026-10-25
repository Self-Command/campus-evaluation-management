"use client";
// Complete invoice/page and invoice form/preview, users table for immutable history.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { cn } from "cn";
import type { ColumnDef } from "@tanstack/react-table";
import type { DataTableFeatures } from "@/lib/data-table-features";
import { TemplateEditor } from "@/components/dashboard/template-editor";
import { TemplateDirectory } from "@/components/dashboard/template-directory";
import { RecordList } from "@/components/dashboard/record-list";
import { useRemote } from "@/components/dashboard/use-remote";
import { RemoteState } from "@/components/dashboard/remote-state";
import { Feedback, requestJson } from "@/components/dashboard/feedback";
import {
	Card,
	CardHeader,
	CardTitle,
	CardDescription,
	CardContent,
} from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import {
	Field,
	FieldGroup,
	FieldLabel,
	FieldDescription,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
	NativeSelect,
	NativeSelectOption,
} from "@/components/ui/native-select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogDescription,
} from "@/components/ui/dialog";
import { phaseLabels, dateText } from "@/lib/business-labels";
type Published = {
	id: string;
	sequence: number;
	publishedAt: string;
	checkingEndsAt: string;
	effectiveCheckingEndsAt?: string;
	requireConfirmation: boolean;
	studentCount: number;
	inputRevision: number;
};
type Summary = {
	term: {
		id: string;
		name: string;
		phase: string;
		disposition?: string;
		revision: number;
		inputRevision: number;
		cohortPolicy?: "PREVIOUS" | "CURRENT";
	};
	current: Published | null;
	history: Published[];
};
type Preview = {
	token: string;
	reviewBreakdown: {
		recognitionsPending: number;
		recognitionsNeedsChanges: number;
		claimsPending: number;
		claimsNeedsChanges: number;
	};
	cohortPolicy: "PREVIOUS" | "CURRENT";
	cohortChanges: {
		added: { studentId: string; login: string; name: string }[];
		removed: { studentId: string; login: string; name: string }[];
	};
	termRevision: number;
	inputRevision: number;
	studentCount: number;
	pendingReviews: number;
	missing: {
		studentId: string;
		login: string;
		name: string;
		nodes: { id: string; name: string }[];
	}[];
	canPublish: boolean;
};
type CohortStudent = Preview["cohortChanges"]["added"][number] & {
	direction: "added" | "removed";
};
type SnapshotStudent = {
	name: string;
	login: string;
	total?: string;
	rank?: number;
};
type LockPreview = {
	reviewBreakdown: Preview["reviewBreakdown"];
	revision: number;
	inputRevision: number;
	publicationId: string;
	studentCount: number;
	confirmedCount: number;
	blockers: { type: string; message: string; count: number }[];
	token: string;
	expiresAt: string;
};
function ReviewQueues({
	termId,
	breakdown,
}: {
	termId: string;
	breakdown: Preview["reviewBreakdown"];
}) {
	return (
		<section className="flex flex-col gap-3">
			<h3 className="text-sm font-medium">尚未完成的审核</h3>
			{(
				[
					["recognitionsPending", "活动参与待审核", "recognitions", "PENDING"],
					[
						"recognitionsNeedsChanges",
						"活动参与已退回",
						"recognitions",
						"RETURNED",
					],
					["claimsPending", "成果申报处理中", "claims", "PENDING"],
					["claimsNeedsChanges", "成果申报已退回", "claims", "RETURNED"],
				] as const
			).map(([key, label, route, status]) => (
				<Link
					key={key}
					href={`/${route}?termId=${termId}&status=${status}`}
					className="flex flex-wrap justify-between gap-2 text-sm underline"
				>
					<span>{label}</span>
					<span>{breakdown[key]} 条</span>
				</Link>
			))}
		</section>
	);
}
type Snapshot = {
	id: string;
	createdAt: string;
	publicationId?: string;
	studentCount?: number;
	hash?: string;
	sequence?: number;
};
export function Publication({ termId }: { termId: string }) {
	const router = useRouter();
	const remote = useRemote<Summary>(`/api/terms/${termId}/publication`);
	const snapshots = useRemote<Snapshot[]>(`/api/terms/${termId}/snapshots`);
	const [preview, setPreview] = useState<Preview | null>(null);
	const [lock, setLock] = useState<LockPreview | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [success, setSuccess] = useState("");
	const [reopen, setReopen] = useState(false);
	const [snapId, setSnapId] = useState("");
	const [extend, setExtend] = useState(false);
	const [cohort, setCohort] = useState(false);
	const [missingOpen, setMissingOpen] = useState(false);
	const [cohortDetail, setCohortDetail] = useState(false);
	const snapshot = useRemote<{
		id: string;
		createdAt: string;
		payload?: {
			term: { name: string };
			results?: SnapshotStudent[];
		};
		sha256?: string;
	}>(snapId ? `/api/snapshots/${snapId}` : null);
	const data = remote.data;
	function refresh() {
		setPreview(null);
		setLock(null);
		remote.reload();
		snapshots.reload();
		router.refresh();
	}
	const historyColumns: ColumnDef<DataTableFeatures, Published>[] = [
		{ accessorKey: "sequence", header: "发布版本" },
		{
			accessorKey: "publishedAt",
			header: "发布时间",
			cell: ({ row }) => dateText(row.original.publishedAt),
		},
		{ accessorKey: "studentCount", header: "学生人数" },
		{ accessorKey: "inputRevision", header: "成绩版本" },
		{
			accessorKey: "checkingEndsAt",
			header: "核对截止",
			cell: ({ row }) =>
				dateText(
					row.original.effectiveCheckingEndsAt || row.original.checkingEndsAt,
				),
		},
		{
			id: "rank",
			header: "排名",
			cell: ({ row }) => (
				<Link
					href={`/rankings?termId=${termId}&publicationId=${row.original.id}`}
					className={buttonVariants({ variant: "ghost", size: "sm" })}
				>
					查看排名
				</Link>
			),
		},
	];
	const snapshotColumns: ColumnDef<DataTableFeatures, Snapshot>[] = [
		{
			accessorKey: "createdAt",
			header: "结算时间",
			cell: ({ row }) => dateText(row.original.createdAt),
		},
		{
			accessorKey: "studentCount",
			header: "学生人数",
			cell: ({ row }) => row.original.studentCount ?? "—",
		},
		{
			id: "id",
			header: "存档编号",
			cell: ({ row }) => (
				<span className="break-all text-xs">{row.original.id}</span>
			),
		},
		{
			id: "action",
			header: "操作",
			cell: ({ row }) => (
				<Button
					variant="ghost"
					size="sm"
					onClick={() => setSnapId(row.original.id)}
				>
					查看存档
				</Button>
			),
		},
	];
	const missingColumns: ColumnDef<
		DataTableFeatures,
		Preview["missing"][number]
	>[] = [
		{
			accessorKey: "name",
			header: "学生",
			cell: ({ row }) => (
				<Link
					href={`/results?termId=${termId}&login=${encodeURIComponent(row.original.login)}`}
					className="font-medium underline underline-offset-4"
				>
					{row.original.name}
				</Link>
			),
		},
		{ accessorKey: "login", header: "学号" },
		{
			id: "nodes",
			header: "未录入项",
			cell: ({ row }) => (
				<span className="block max-w-80 whitespace-normal break-words text-xs text-muted-foreground">
					{row.original.nodes.map((node) => node.name).join("、")}
				</span>
			),
		},
		{
			id: "action",
			header: "操作",
			cell: ({ row }) => (
				<Link
					href={`/grades?termId=${termId}&login=${encodeURIComponent(row.original.login)}`}
					className={buttonVariants({ variant: "ghost", size: "sm" })}
				>
					录入成绩
				</Link>
			),
		},
	];
	const cohortColumns: ColumnDef<DataTableFeatures, CohortStudent>[] = [
		{ accessorKey: "name", header: "姓名" },
		{ accessorKey: "login", header: "学号" },
		{
			id: "direction",
			header: "变更",
			cell: ({ row }) => (
				<Badge variant="outline">
					{row.original.direction === "added" ? "新增" : "移除"}
				</Badge>
			),
		},
	];
	const snapshotResultColumns: ColumnDef<
		DataTableFeatures,
		SnapshotStudent
	>[] = [
		{
			accessorKey: "name",
			header: "学生",
			cell: ({ row }) => (
				<span>
					{row.original.name} · {row.original.login}
				</span>
			),
		},
		{
			accessorKey: "total",
			header: "总分",
			cell: ({ row }) => (
				<span className="tabular-nums">{row.original.total ?? "—"}</span>
			),
		},
		{
			accessorKey: "rank",
			header: "名次",
			cell: ({ row }) => (
				<span className="tabular-nums">{row.original.rank ?? "—"}</span>
			),
		},
	];
		const publishSteps = [
		{ title: "检查", description: "名单与成绩完整性" },
		{ title: "发布", description: "生成成绩版本" },
		{ title: "学生确认", description: "确认或提出异议" },
		{ title: "锁定", description: "保存结算存档" },
	];
	const stepIndex = !data
		? 0
		: data.term.phase === "CHECKING"
			? 2
			: data.term.phase === "LOCKED"
				? 3
				: data.term.phase === "ACTIVE" && preview?.canPublish
					? 1
					: 0;
	const flowDone = data?.term.phase === "LOCKED";
	const cohortRows: CohortStudent[] = preview
		? [
				...(preview.cohortChanges?.added ?? []).map((student) => ({
					...student,
					direction: "added" as const,
				})),
				...(preview.cohortChanges?.removed ?? []).map((student) => ({
					...student,
					direction: "removed" as const,
				})),
			]
		: [];
	return (
		<>
			<RemoteState {...remote} />
			<Feedback error={error} success={success} />
			{data && (
				<>
					<div className="flex flex-wrap items-center justify-between gap-3">
						<span className="text-xs text-muted-foreground">
							评分方案版本 {data.term.revision} · 成绩版本{" "}
							{data.term.inputRevision}
						</span>
						{(!data.term.disposition || data.term.disposition === "NORMAL") &&
							["CHECKING", "LOCKED"].includes(data.term.phase) && (
								<Button
									variant="outline"
									onClick={() => {
										setError("");
										setReopen(true);
									}}
								>
									填写原因并重开更正
								</Button>
							)}
					</div>
					{data.term.phase !== "CONFIGURATION" && (
						<ol
							aria-label={`发布流程，当前阶段${phaseLabels[data.term.phase]}`}
							className="grid grid-cols-2 gap-3 rounded-lg border p-3 xl:grid-cols-4"
						>
							{publishSteps.map((step, index) => {
								const done = flowDone || index < stepIndex;
								const active = !flowDone && index === stepIndex;
								return (
									<li
										key={step.title}
										aria-current={active ? "step" : undefined}
										className="flex min-w-0 items-start gap-2"
									>
										<span
											className={cn(
												"mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs tabular-nums",
												done
													? "border-primary bg-primary text-primary-foreground"
													: active
														? "border-primary text-primary"
														: "text-muted-foreground",
											)}
										>
											{done ? <Check className="size-3.5" /> : index + 1}
										</span>
										<div className="min-w-0">
											<p
												className={cn(
													"text-sm font-medium",
													!done && !active && "text-muted-foreground",
												)}
											>
												{step.title}
											</p>
											<p className="text-xs text-muted-foreground">
												{step.description}
											</p>
										</div>
									</li>
								);
							})}
						</ol>
					)}
					<TemplateEditor
						preview={
							<Card>
								<CardHeader>
									<CardTitle>
										{preview
											? "发布前检查"
											: lock
												? "锁定前检查"
												: "当前发布"}
									</CardTitle>
									<CardDescription>{data.term.name}</CardDescription>
								</CardHeader>
								<CardContent className="flex flex-col gap-4">
									{preview ? (
										<>
											<dl className="grid grid-cols-2 gap-4">
												<div>
													<dt className="text-xs text-muted-foreground">
														检查学生
													</dt>
													<dd className="text-2xl tabular-nums">
														{preview.studentCount}
													</dd>
												</div>
												<div>
													<dt className="text-xs text-muted-foreground">
														待审核
													</dt>
													<dd className="text-2xl tabular-nums">
														{preview.pendingReviews}
													</dd>
												</div>
											</dl>
											<Badge
												className="self-start"
												variant={preview.canPublish ? "default" : "secondary"}
											>
												{preview.canPublish ? "可以发布" : "暂时不能发布"}
											</Badge>
											{preview.missing.length ? (
												<div className="flex flex-col gap-2 border-b pb-3">
													<p className="text-sm font-medium text-destructive">
														必需成绩未录入 {preview.missing.length} 人
													</p>
													<p className="text-sm text-muted-foreground">
														有成绩未录入时不能发布，请先补齐。
													</p>
													<Button
														type="button"
														variant="outline"
														size="sm"
														className="self-start"
														onClick={() => setMissingOpen(true)}
													>
														查看未录入名单
													</Button>
												</div>
											) : (
												<p className="text-sm text-muted-foreground">
													必需成绩已齐全。
												</p>
											)}
											<ReviewQueues
												termId={termId}
												breakdown={preview.reviewBreakdown}
											/>
											<Separator />
											<section className="flex flex-col gap-3">
												<h3 className="text-sm font-medium">参评名单范围</h3>
												<p className="text-sm">
													{preview.cohortPolicy === "PREVIOUS"
														? "沿用上次发布名单和当时班级"
														: "使用当前在籍学生名单"}
												</p>
												<p className="text-sm">
													新增 {preview.cohortChanges?.added.length || 0} 人 ·
													移除 {preview.cohortChanges?.removed.length || 0} 人
												</p>
												{cohortRows.length ? (
													<Button
														type="button"
														variant="outline"
														size="sm"
														className="self-start"
														onClick={() => setCohortDetail(true)}
													>
														查看名单变化
													</Button>
												) : (
													<p className="text-sm text-muted-foreground">
														本周期名单无变化。
													</p>
												)}
											</section>
										</>
									) : lock ? (
										<>
											<p className="text-sm">
												{lock.studentCount} 位学生，{lock.confirmedCount}{" "}
												位已确认。
											</p>
											{lock.blockers.length ? (
												lock.blockers.map((item, index) => (
													<div
														key={`${item.type}-${index}`}
														className="flex flex-col gap-1 border-b pb-3"
													>
														<Badge variant="secondary" className="self-start">
															{item.count} 项
														</Badge>
														<p className="text-sm">{item.message}</p>
														{item.type === "APPEALS" && (
															<Link
																href={`/appeals?termId=${termId}`}
																className="text-sm underline"
															>
																处理本周期成绩异议
															</Link>
														)}
														{item.type === "CONFIRMATIONS" && (
															<Link
																href={`/results?termId=${termId}`}
																className="text-sm underline"
															>
																查看本周期学生确认名单
															</Link>
														)}
													</div>
												))
											) : (
												<p className="text-sm">锁定前检查已全部通过。</p>
											)}
											<p className="text-xs text-muted-foreground">
												检查有效至 {dateText(lock.expiresAt)}
											</p>
											<ReviewQueues
												termId={termId}
												breakdown={lock.reviewBreakdown}
											/>
										</>
									) : data.current ? (
										<>
											<p className="text-2xl">
												发布版本 {data.current.sequence}
											</p>
											<p className="text-sm">
												{data.current.studentCount} 位学生
											</p>
											<p className="text-sm text-muted-foreground">
												发布于 {dateText(data.current.publishedAt)}
											</p>
											<p className="text-sm text-muted-foreground">
												核对截止{" "}
												{dateText(
													data.current.effectiveCheckingEndsAt ||
														data.current.checkingEndsAt,
												)}
											</p>
											{data.current.effectiveCheckingEndsAt &&
												data.current.effectiveCheckingEndsAt !==
													data.current.checkingEndsAt && (
													<p className="text-xs text-muted-foreground">
														原截止 {dateText(data.current.checkingEndsAt)}
														；延期保留旧确认和原发布成绩。
													</p>
												)}
											<Link
												href={`/rankings?termId=${termId}&publicationId=${data.current.id}`}
												className={buttonVariants({ variant: "outline" })}
											>
												查看排名与导出
											</Link>
										</>
									) : (
										<p className="text-sm text-muted-foreground">
											本周期尚无当前发布结果。
										</p>
									)}
								</CardContent>
							</Card>
						}
					>
						<Tabs value="publication">
							<TabsList className="w-full">
								<TabsTrigger value="publication">发布与存档</TabsTrigger>
							</TabsList>
						</Tabs>
						<Separator />
						{data.term.disposition && data.term.disposition !== "NORMAL" ? (
							<p className="text-sm text-muted-foreground">
								{data.term.disposition === "ARCHIVED"
									? "本周期已归档，发布记录只能查看；需要重开或锁定时，请先在周期管理中取消归档。"
									: "本周期已作废，发布记录只能查看。"}
							</p>
						) : data.term.phase === "ACTIVE" ? (
							<form
								className="flex flex-col gap-5"
								onSubmit={async (e) => {
									e.preventDefault();
									if (busy || !preview?.canPublish || !preview.token) return;
									if (
										!window.confirm(
											`发布“${data.term.name}”的 ${preview.studentCount} 位学生成绩，并进入学生确认阶段？`,
										)
									)
										return;
									const f = new FormData(e.currentTarget);
									setBusy(true);
									setError("");
									try {
										await requestJson(`/api/terms/${termId}/publication`, {
											action: "publish",
											revision: preview.termRevision,
											inputRevision: preview.inputRevision,
											token: preview.token,
											checkingEndsAt: new Date(
												String(f.get("checkingEndsAt")),
											).toISOString(),
											requireConfirmation:
												f.get("requireConfirmation") === "true",
											requestId: crypto.randomUUID(),
										});
										setSuccess("结果已发布，学生可以开始确认。");
										refresh();
									} catch (err) {
										setPreview(null);
										setError((err as Error).message);
									} finally {
										setBusy(false);
									}
								}}
							>
								<FieldGroup>
									{data.history.length > 0 && (
										<Field>
											<FieldLabel>重开后的参评名单</FieldLabel>
											<p className="text-sm">
												{data.term.cohortPolicy === "CURRENT"
													? "使用当前在籍学生名单"
													: "默认沿用上次发布名单和当时班级"}
											</p>
											<FieldDescription>
												沿用上次名单会保留原发布学生，不因转班或停用删除；需要增减名单时先更改范围，再重新检查。
											</FieldDescription>
											<Button
												type="button"
												variant="outline"
												onClick={() => setCohort(true)}
											>
												更改名单范围
											</Button>
										</Field>
									)}
									<Field>
										<FieldLabel htmlFor="publish-deadline">
											学生确认截止时间
										</FieldLabel>
										<Input
											id="publish-deadline"
											name="checkingEndsAt"
											type="datetime-local"
											required
										/>
										<FieldDescription>
											截止前，学生可以确认本版成绩或提出异议。
										</FieldDescription>
									</Field>
									<Field>
										<FieldLabel htmlFor="publish-confirmation">
											锁定前是否要求全部学生确认
										</FieldLabel>
										<NativeSelect
											id="publish-confirmation"
											name="requireConfirmation"
											required
											defaultValue="true"
										>
											<NativeSelectOption value="true">
												要求全部学生确认
											</NativeSelectOption>
											<NativeSelectOption value="false">
												不强制全部确认
											</NativeSelectOption>
										</NativeSelect>
									</Field>
								</FieldGroup>
								<Button
									type="button"
									variant="outline"
									disabled={busy}
									onClick={async () => {
										setBusy(true);
										setError("");
										try {
											setPreview(
												await requestJson<Preview>(
													`/api/terms/${termId}/publication`,
													{ action: "preview" },
												),
											);
										} catch (err) {
											setError((err as Error).message);
										} finally {
											setBusy(false);
										}
									}}
								>
									{busy ? "正在检查…" : "检查发布条件"}
								</Button>
								<Button
									type="submit"
									disabled={busy || !preview?.canPublish || !preview.token}
								>
									发布成绩
								</Button>
							</form>
						) : data.term.phase === "CHECKING" ? (
							<div className="flex flex-col gap-5">
								<h2 className="font-medium">学生确认与锁定</h2>
								{data.current && (
									<Button variant="outline" onClick={() => setExtend(true)}>
										填写原因并延长确认期限
									</Button>
								)}
								<p className="text-sm text-muted-foreground">
									确认期限、待审记录、未处理异议、确认人数和结果版本都通过检查后，才能锁定。
								</p>
								<Button
									variant="outline"
									disabled={busy}
									onClick={async () => {
										setBusy(true);
										setError("");
										try {
											setLock(
												await requestJson<LockPreview>(
													`/api/terms/${termId}/settlement`,
													{ action: "preview" },
												),
											);
										} catch (err) {
											setError((err as Error).message);
										} finally {
											setBusy(false);
										}
									}}
								>
									检查锁定条件
								</Button>
								<Button
									disabled={busy || !lock || lock.blockers.length > 0}
									onClick={async () => {
										if (busy || !lock) return;
										if (
											!window.confirm(
												`锁定“${data.term.name}”，保存 ${lock.studentCount} 位学生的结算存档？`,
											)
										)
											return;
										setBusy(true);
										setError("");
										try {
											await requestJson(`/api/terms/${termId}/settlement`, {
												action: "lock",
												revision: lock.revision,
												token: lock.token,
												requestId: crypto.randomUUID(),
											});
											setSuccess("本周期已锁定，结算存档已保存。");
											refresh();
										} catch (err) {
											setError((err as Error).message);
										} finally {
											setBusy(false);
										}
									}}
								>
									锁定并保存存档
								</Button>
								<Link
									href={`/appeals?termId=${termId}`}
									className={buttonVariants({ variant: "outline" })}
								>
									处理测评异议
								</Link>
							</div>
						) : (
							<div className="flex flex-col gap-3">
								<h2 className="font-medium">
									{data.term.phase === "LOCKED"
										? "本周期已锁定"
										: "先完成评分配置"}
								</h2>
								<p className="text-sm text-muted-foreground">
									{data.term.phase === "LOCKED"
										? "存档保存完整计分依据，普通录入和导入已关闭。需要更正时请填写原因重开。"
										: "保存评分方案并开启申报后，录入并审核完整成绩再发布。"}
								</p>
								<Link
									href={`/terms/${termId}`}
									className={buttonVariants({ variant: "outline" })}
								>
									查看评分方案
								</Link>
							</div>
						)}
					</TemplateEditor>
					<TemplateDirectory
						title="发布历史"
						description="各次发布结果与学生确认分别保留。"
						data={data.history}
						columns={historyColumns}
						mobile={(row) => (
							<div className="flex flex-col gap-3">
								<p className="font-medium">
									发布版本 {row.sequence} · {row.studentCount} 位学生
								</p>
								<p className="text-xs text-muted-foreground">
									{dateText(row.publishedAt)}
								</p>
								<Link
									className="text-sm underline"
									href={`/rankings?termId=${termId}&publicationId=${row.id}`}
								>
									查看该版本排名
								</Link>
							</div>
						)}
					/>
					<RemoteState {...snapshots} />
					{snapshots.data && (
						<TemplateDirectory
							title="结算存档"
							description="锁定时保存的成绩、班级和计分依据，不会被后续更正覆盖。"
							data={snapshots.data}
							columns={snapshotColumns}
							mobile={(row) => (
								<div className="flex flex-col gap-3">
									<p className="font-medium">{dateText(row.createdAt)}</p>
									<p className="break-all text-xs text-muted-foreground">
										{row.id}
									</p>
									<Button
										className="self-start"
										variant="outline"
										onClick={() => setSnapId(row.id)}
									>
										查看存档
									</Button>
								</div>
							)}
						/>
					)}
				</>
			)}
			<Dialog
				open={
					extend &&
					(!data?.term.disposition || data.term.disposition === "NORMAL")
				}
				onOpenChange={(open) => {
					if (!busy) setExtend(open);
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>延长学生确认期限</DialogTitle>
						<DialogDescription>
							只延长截止时间，已有确认、原发布成绩和原截止时间不变。
						</DialogDescription>
					</DialogHeader>
					<form
						className="flex flex-col gap-5"
						onSubmit={async (event) => {
							event.preventDefault();
							if (
								busy ||
								!data?.current ||
								(data.term.disposition && data.term.disposition !== "NORMAL")
							)
								return;
							const form = new FormData(event.currentTarget);
							setBusy(true);
							setError("");
							try {
								await requestJson(`/api/terms/${termId}/publication`, {
									action: "extend",
									revision: data.term.revision,
									publicationId: data.current.id,
									checkingEndsAt: new Date(
										String(form.get("checkingEndsAt")),
									).toISOString(),
									reason: form.get("reason"),
								});
								setExtend(false);
								setSuccess("确认期限已延长，已有确认保留。");
								refresh();
							} catch (err) {
								setError((err as Error).message);
							} finally {
								setBusy(false);
							}
						}}
					>
						<Feedback error={error} />
						<p className="text-sm">
							当前截止：
							{data?.current
								? dateText(
										data.current.effectiveCheckingEndsAt ||
											data.current.checkingEndsAt,
									)
								: "—"}
						</p>
						<FieldGroup>
							<Field>
								<FieldLabel htmlFor="extend-deadline">
									新的确认截止时间
								</FieldLabel>
								<Input
									id="extend-deadline"
									name="checkingEndsAt"
									type="datetime-local"
									required
								/>
								<FieldDescription>
									新截止时间必须晚于当前有效截止时间。
								</FieldDescription>
							</Field>
							<Field>
								<FieldLabel htmlFor="extend-reason">延期原因</FieldLabel>
								<Textarea
									id="extend-reason"
									name="reason"
									minLength={2}
									maxLength={1000}
									required
									rows={3}
								/>
							</Field>
						</FieldGroup>
						<Button type="submit" disabled={busy}>确认延长</Button>
					</form>
				</DialogContent>
			</Dialog>
			<Dialog
				open={
					cohort &&
					(!data?.term.disposition || data.term.disposition === "NORMAL")
				}
				onOpenChange={(open) => {
					if (!busy) setCohort(open);
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>更改重开后的参评名单范围</DialogTitle>
						<DialogDescription>
							默认沿用上次发布名单和当时班级。更改后需要重新检查名单变化，旧发布不变。
						</DialogDescription>
					</DialogHeader>
					<form
						className="flex flex-col gap-5"
						onSubmit={async (event) => {
							event.preventDefault();
							if (
								busy ||
								!data ||
								(data.term.disposition && data.term.disposition !== "NORMAL")
							)
								return;
							const form = new FormData(event.currentTarget);
							setBusy(true);
							setError("");
							try {
								await requestJson(`/api/terms/${termId}/publication`, {
									action: "cohort",
									revision: data.term.revision,
									policy: form.get("policy"),
									reason: form.get("reason"),
								});
								setCohort(false);
								setSuccess(
									"参评名单范围已保存，请重新检查发布条件和名单变化。",
								);
								refresh();
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
								<FieldLabel htmlFor="cohort-policy">参评名单范围</FieldLabel>
								<NativeSelect
									id="cohort-policy"
									name="policy"
									defaultValue={data?.term.cohortPolicy || "PREVIOUS"}
								>
									<NativeSelectOption value="PREVIOUS">
										沿用上次发布名单和当时班级
									</NativeSelectOption>
									<NativeSelectOption value="CURRENT">
										使用当前在籍学生名单
									</NativeSelectOption>
								</NativeSelect>
							</Field>
							<Field>
								<FieldLabel htmlFor="cohort-reason">
									更改原因
								</FieldLabel>
								<Textarea
									id="cohort-reason"
									name="reason"
									minLength={2}
									maxLength={1000}
									required
									rows={3}
								/>
							</Field>
						</FieldGroup>
						<Button type="submit" disabled={busy}>保存并重新检查</Button>
					</form>
				</DialogContent>
			</Dialog>
			<Dialog
				open={
					reopen &&
					(!data?.term.disposition || data.term.disposition === "NORMAL")
				}
				onOpenChange={(open) => {
					if (!busy) setReopen(open);
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>填写原因并重开更正</DialogTitle>
						<DialogDescription>
							旧发布和结算存档保留。更正后需要重新发布并核对新版本。
						</DialogDescription>
					</DialogHeader>
					<form
						className="flex flex-col gap-5"
						onSubmit={async (e) => {
							e.preventDefault();
							if (
								busy ||
								!data ||
								(data.term.disposition && data.term.disposition !== "NORMAL")
							)
								return;
							setBusy(true);
							setError("");
							const f = new FormData(e.currentTarget);
							try {
								await requestJson(`/api/terms/${termId}/settlement`, {
									action: "reopen",
									revision: data.term.revision,
									reason: f.get("reason"),
								});
								setReopen(false);
								setSuccess("已重开，可在申报与审核阶段执行更正。");
								refresh();
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
								<FieldLabel htmlFor="reopen-reason">重开原因</FieldLabel>
								<Textarea
									id="reopen-reason"
									name="reason"
									required
									minLength={2}
									maxLength={1000}
									rows={4}
								/>
							</Field>
						</FieldGroup>
						<Button type="submit" disabled={busy}>
							确认重开
						</Button>
					</form>
				</DialogContent>
			</Dialog>
			<Dialog
				open={missingOpen}
				onOpenChange={(open) => {
					if (!busy) setMissingOpen(open);
				}}
			>
				<DialogContent className="sm:max-w-4xl">
					<DialogHeader>
						<DialogTitle>成绩未录完名单</DialogTitle>
						<DialogDescription>
							{preview?.missing.length ?? 0} 位学生还有必需成绩未录入，补齐后才能发布。可按姓名或学号查找并进入成绩录入。
						</DialogDescription>
					</DialogHeader>
					{preview && (
						<RecordList
							data={preview.missing}
							columns={missingColumns}
							searchText={(item) => `${item.name} ${item.login}`}
							searchPlaceholder="按姓名或学号搜索缺失学生"
							emptyTitle="没有匹配的记录"
							emptyDescription="请调整搜索条件。"
							tableClassName="max-h-[55dvh]"
							mobile={(item) => (
								<div className="flex flex-col gap-2">
									<div className="flex items-start justify-between gap-3">
										<Link
											href={`/results?termId=${termId}&login=${encodeURIComponent(item.login)}`}
											className="font-medium underline underline-offset-4"
										>
											{item.name} · {item.login}
										</Link>
										<Badge variant="outline">
											{item.nodes.length} 项
										</Badge>
									</div>
									<p className="text-xs text-muted-foreground">
										{item.nodes.map((node) => node.name).join("、")}
									</p>
									<Link
										href={`/grades?termId=${termId}&login=${encodeURIComponent(item.login)}`}
										className="text-sm underline"
									>
										录入该学生成绩
									</Link>
								</div>
							)}
						/>
					)}
				</DialogContent>
			</Dialog>
			<Dialog
				open={cohortDetail}
				onOpenChange={(open) => {
					if (!busy) setCohortDetail(open);
				}}
			>
				<DialogContent className="sm:max-w-4xl">
					<DialogHeader>
						<DialogTitle>参评名单变化</DialogTitle>
						<DialogDescription>
							这里只改变本周期参评范围，不修改旧发布成绩。可按姓名或学号查找。
						</DialogDescription>
					</DialogHeader>
					{preview && (
						<RecordList
							data={cohortRows}
							columns={cohortColumns}
							searchText={(student) => `${student.name} ${student.login}`}
							searchPlaceholder="按姓名或学号搜索名单变更"
							tabs={[
								{
									value: "added",
									label: `新增 ${preview.cohortChanges?.added.length ?? 0}`,
									match: (student) => student.direction === "added",
								},
								{
									value: "removed",
									label: `移除 ${preview.cohortChanges?.removed.length ?? 0}`,
									match: (student) => student.direction === "removed",
								},
							]}
							emptyTitle="没有匹配的名单变更"
							emptyDescription="请调整搜索条件或切换新增与移除。"
							tableClassName="max-h-[55dvh]"
							mobile={(student) => (
								<div className="flex items-center justify-between gap-3">
									<div>
										<p className="font-medium">{student.name}</p>
										<p className="text-xs text-muted-foreground">
											{student.login}
										</p>
									</div>
									<Badge variant="outline">
										{student.direction === "added" ? "新增" : "移除"}
									</Badge>
								</div>
							)}
						/>
					)}
				</DialogContent>
			</Dialog>
			<Dialog
				open={!!snapId}
				onOpenChange={(open) => {
					if (!open) setSnapId("");
				}}
			>
				<DialogContent className="sm:max-w-3xl">
					<DialogHeader>
						<DialogTitle>结算存档</DialogTitle>
						<DialogDescription>查看锁定时保存的记录。</DialogDescription>
					</DialogHeader>
					<RemoteState {...snapshot} />
					{snapshot.data && (
						<div className="flex flex-col gap-4">
							<p className="break-all text-xs text-muted-foreground">
								存档编号 {snapshot.data.id}
							</p>
							<p className="break-all text-xs text-muted-foreground">
								校验摘要 {snapshot.data.sha256}
							</p>
							<p className="text-sm">
								结算时间：{dateText(snapshot.data.createdAt)}
							</p>
							<RecordList
								data={snapshot.data.payload?.results ?? []}
								columns={snapshotResultColumns}
								searchText={(student) => `${student.name} ${student.login}`}
								searchPlaceholder="按姓名或学号搜索"
								emptyTitle="存档中没有学生结果"
								emptyDescription="该存档没有可显示的学生结果。"
								tableClassName="max-h-[55dvh]"
							/>
							<a
								href={`/api/snapshots/${snapId}`}
								target="_blank"
								rel="noreferrer"
								className={buttonVariants({ variant: "outline" })}
							>
								打开完整存档
							</a>
						</div>
					)}
				</DialogContent>
			</Dialog>
		</>
	);
}
