"use client";
// Complete invoice/page and invoice form/preview, users table for immutable history.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import type { DataTableFeatures } from "@/lib/data-table-features";
import { TemplateEditor } from "@/components/dashboard/template-editor";
import { TemplateDirectory } from "@/components/dashboard/template-directory";
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
		nodes: unknown[];
	}[];
	canPublish: boolean;
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
			<h3 className="text-sm font-medium">认定与申报阻断</h3>
			{(
				[
					["recognitionsPending", "活动认定待审核", "recognitions", "PENDING"],
					[
						"recognitionsNeedsChanges",
						"活动认定待补充",
						"recognitions",
						"NEEDS_CHANGES",
					],
					["claimsPending", "个人申报待审核", "claims", "PENDING"],
					["claimsNeedsChanges", "个人申报待补充", "claims", "NEEDS_CHANGES"],
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
	const snapshot = useRemote<{
		id: string;
		createdAt: string;
		payload?: {
			term: { name: string };
			results?: {
				name: string;
				login: string;
				total?: string;
				rank?: number;
			}[];
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
		{ accessorKey: "inputRevision", header: "输入修订" },
		{
			accessorKey: "checkingEndsAt",
			header: "当前核对截止",
			cell: ({ row }) =>
				dateText(
					row.original.effectiveCheckingEndsAt || row.original.checkingEndsAt,
				),
		},
		{
			id: "rank",
			header: "名单",
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
			header: "快照标识",
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
					查看快照
				</Button>
			),
		},
	];
	return (
		<>
			<RemoteState {...remote} />
			<Feedback error={error} success={success} />
			{data && (
				<>
					<div className="flex flex-wrap items-center justify-between gap-3">
						<div className="flex flex-wrap items-center gap-3">
							<Badge variant="outline">{phaseLabels[data.term.phase]}</Badge>
							<span className="text-xs text-muted-foreground">
								方案修订 {data.term.revision} · 输入修订{" "}
								{data.term.inputRevision}
							</span>
						</div>
						{(!data.term.disposition || data.term.disposition === "NORMAL") &&
							["CHECKING", "LOCKED"].includes(data.term.phase) && (
								<Button
									variant="outline"
									onClick={() => {
										setError("");
										setReopen(true);
									}}
								>
									填写理由并重开更正
								</Button>
							)}
					</div>
					<TemplateEditor
						preview={
							<Card>
								<CardHeader>
									<CardTitle>
										{preview
											? "发布检查结果"
											: lock
												? "锁定检查结果"
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
												{preview.canPublish ? "可以发布" : "存在阻断"}
											</Badge>
											{preview.missing.map((item) => (
												<div
													key={item.studentId}
													className="flex flex-col gap-1 border-b pb-3"
												>
													<Link
														href={`/results?termId=${termId}&login=${encodeURIComponent(item.login)}`}
														className="text-sm underline"
													>
														{item.name} · {item.login}
													</Link>
													<p className="text-sm text-muted-foreground">
														缺失 {item.nodes.length} 项必需成绩
													</p>
													<Link
														href={`/grades?termId=${termId}&login=${encodeURIComponent(item.login)}`}
														className="text-sm underline"
													>
														录入该学生成绩
													</Link>
												</div>
											))}
											<ReviewQueues
												termId={termId}
												breakdown={preview.reviewBreakdown}
											/>
											<Separator />
											<section className="flex flex-col gap-3">
												<h3 className="text-sm font-medium">参评名录政策</h3>
												<p className="text-sm">
													{preview.cohortPolicy === "PREVIOUS"
														? "沿用原发布名录及历史归属"
														: "使用当前有效学生名录"}
												</p>
												<p className="text-sm">
													新增 {preview.cohortChanges?.added.length || 0} 人 ·
													移除 {preview.cohortChanges?.removed.length || 0} 人
												</p>
												{preview.cohortChanges?.added.map((student) => (
													<p key={student.studentId} className="text-sm">
														新增：{student.name} · {student.login}
													</p>
												))}
												{preview.cohortChanges?.removed.map((student) => (
													<p key={student.studentId} className="text-sm">
														移除：{student.name} · {student.login}
													</p>
												))}
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
																处理本周期结果异议
															</Link>
														)}
														{item.type === "CONFIRMATIONS" && (
															<Link
																href={`/results?termId=${termId}`}
																className="text-sm underline"
															>
																查看本周期学生确认名录
															</Link>
														)}
													</div>
												))
											) : (
												<p className="text-sm">全部锁定检查已通过。</p>
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
												当前核对截止{" "}
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
								<TabsTrigger value="publication">发布与结算</TabsTrigger>
							</TabsList>
						</Tabs>
						<Separator />
						{data.term.disposition && data.term.disposition !== "NORMAL" ? (
							<p className="text-sm text-muted-foreground">
								{data.term.disposition === "ARCHIVED"
									? "本周期已归档，发布与结算记录只读；需要重开或锁定时，请先在周期管理中取消归档。"
									: "本周期已作废，发布与结算记录只读。"}
							</p>
						) : data.term.phase === "ACTIVE" ? (
							<form
								className="flex flex-col gap-5"
								onSubmit={async (e) => {
									e.preventDefault();
									if (busy || !preview?.canPublish || !preview.token) return;
									if (
										!window.confirm(
											`发布“${data.term.name}”的 ${preview.studentCount} 位学生结果并进入核对阶段？`,
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
										setSuccess("结果已发布，进入学生核对阶段。");
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
											<FieldLabel>重开后参评名录</FieldLabel>
											<p className="text-sm">
												{data.term.cohortPolicy === "CURRENT"
													? "使用当前有效学生名录"
													: "默认沿用原发布名录及历史归属"}
											</p>
											<FieldDescription>
												沿用政策保留原发布学生，不因转班或停用删除；需要增减名录时先有理由变更政策，再重新预检。
											</FieldDescription>
											<Button
												type="button"
												variant="outline"
												onClick={() => setCohort(true)}
											>
												变更参评名录政策
											</Button>
										</Field>
									)}
									<Field>
										<FieldLabel htmlFor="publish-deadline">
											学生核对截止时间
										</FieldLabel>
										<Input
											id="publish-deadline"
											name="checkingEndsAt"
											type="datetime-local"
											required
										/>
										<FieldDescription>
											核对期限内，学生可以确认本版本或提出异议。
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
									发布成绩并进入核对
								</Button>
							</form>
						) : data.term.phase === "CHECKING" ? (
							<div className="flex flex-col gap-5">
								<h2 className="font-medium">学生核对与锁定</h2>
								{data.current && (
									<Button variant="outline" onClick={() => setExtend(true)}>
										填写理由并延长核对期限
									</Button>
								)}
								<p className="text-sm text-muted-foreground">
									核对期限、待审材料、未决异议、必需确认及结果版本均通过检查后，才可锁定。
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
												`锁定“${data.term.name}”，保存 ${lock.studentCount} 位学生的不可变结算快照？`,
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
											setSuccess("本周期已锁定，结算快照已保存。");
											refresh();
										} catch (err) {
											setError((err as Error).message);
										} finally {
											setBusy(false);
										}
									}}
								>
									锁定并保存结算快照
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
										? "结算快照保存完整计分依据，普通录入与导入已关闭。需要更正时请填写理由重开。"
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
							title="结算快照"
							description="锁定时冻结的成绩、归属与计分依据不会被后续更正覆盖。"
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
										查看快照
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
						<DialogTitle>延长学生核对期限</DialogTitle>
						<DialogDescription>
							只延长期限，保留已完成的学生确认、原发布成绩及原截止时间。
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
								setSuccess("核对期限已延长，已有确认保留。");
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
									新的核对截止时间
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
								<FieldLabel htmlFor="extend-reason">延期理由</FieldLabel>
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
						<Button disabled={busy}>确认延长核对期限</Button>
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
						<DialogTitle>变更重开后的参评名录政策</DialogTitle>
						<DialogDescription>
							默认沿用原发布名录和身份。变更政策后必须重新预检并核对新增与移除学生，旧发布不变。
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
									"参评名录政策已保存，请重新检查发布条件和名录差异。",
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
								<FieldLabel htmlFor="cohort-policy">参评名录政策</FieldLabel>
								<NativeSelect
									id="cohort-policy"
									name="policy"
									defaultValue={data?.term.cohortPolicy || "PREVIOUS"}
								>
									<NativeSelectOption value="PREVIOUS">
										沿用原发布名录与历史归属
									</NativeSelectOption>
									<NativeSelectOption value="CURRENT">
										重新取当前有效学生名录
									</NativeSelectOption>
								</NativeSelect>
							</Field>
							<Field>
								<FieldLabel htmlFor="cohort-reason">
									名录政策变更理由
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
						<Button disabled={busy}>保存政策并重新预检</Button>
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
						<DialogTitle>填写理由并重开更正</DialogTitle>
						<DialogDescription>
							旧发布与结算快照保留。更正后需要重新发布并核对新版本。
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
								<FieldLabel htmlFor="reopen-reason">重开更正理由</FieldLabel>
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
				open={!!snapId}
				onOpenChange={(open) => {
					if (!open) setSnapId("");
				}}
			>
				<DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
					<DialogHeader>
						<DialogTitle>结算快照</DialogTitle>
						<DialogDescription>查看锁定时保存的不可变记录。</DialogDescription>
					</DialogHeader>
					<RemoteState {...snapshot} />
					{snapshot.data && (
						<div className="flex flex-col gap-4">
							<p className="break-all text-xs text-muted-foreground">
								快照标识 {snapshot.data.id}
							</p>
							<p className="break-all text-xs text-muted-foreground">
								校验摘要 {snapshot.data.sha256}
							</p>
							<p className="text-sm">
								结算时间：{dateText(snapshot.data.createdAt)}
							</p>
							{snapshot.data.payload?.results?.map((student, index) => (
								<div
									key={`${student.login}-${index}`}
									className="flex flex-wrap justify-between gap-3 border-b pb-3 text-sm"
								>
									<span>
										{student.name} · {student.login}
									</span>
									<span>
										{student.total ?? "—"} 分 · 名次 {student.rank ?? "—"}
									</span>
								</div>
							))}
							<a
								href={`/api/snapshots/${snapId}`}
								target="_blank"
								rel="noreferrer"
								className={buttonVariants({ variant: "outline" })}
							>
								打开完整冻结记录
							</a>
						</div>
					)}
				</DialogContent>
			</Dialog>
		</>
	);
}
