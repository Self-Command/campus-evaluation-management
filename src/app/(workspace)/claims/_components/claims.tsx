"use client";
import { EvidenceViewer } from "@/components/dashboard/evidence-viewer";
// Complete users directory plus invoice form and profile sheet, retaining template header, filtering, table and editor panels.
import { useState } from "react";
import { Plus } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import type { DataTableFeatures } from "@/lib/data-table-features";
import type { Scheme } from "@/lib/scoring/types";
import { TemplateDirectory } from "@/components/dashboard/template-directory";
import { TemplateEditor } from "@/components/dashboard/template-editor";
import { useRemote } from "@/components/dashboard/use-remote";
import { RemoteState } from "@/components/dashboard/remote-state";
import { Feedback, requestJson } from "@/components/dashboard/feedback";
import { EvidenceUpload } from "@/components/dashboard/evidence-upload";
import { SearchableSelect } from "@/components/dashboard/searchable-select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
	Card,
	CardHeader,
	CardTitle,
	CardDescription,
	CardContent,
} from "@/components/ui/card";
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
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
	SheetDescription,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { dateText, statusLabels } from "@/lib/business-labels";

export type Claim = {
	id: string;
	revision: number;
	status: string;
	title: string;
	occurredOn: string;
	note: string;
	reviewReason?: string | null;
	createdAt: string;
	scoreNodeId: string | null;
	score: string | null;
	scorer: { id: string; name: string } | null;
	reviewer: { id: string; name: string } | null;
	projectName: string | null;
	student: {
		id: string;
		name: string;
		login: string;
		studentNumber: string;
		className: string;
		organization: string;
	};
	evidence: { id: string; name: string }[];
	history?: {
		action?: string;
		before?: string;
		after?: string;
		reason?: string;
		score?: string;
		at: string;
	}[];
};
const claimStatuses = [
	"PENDING",
	"PENDING_COUNSELOR",
	"PENDING_COLLEGE",
	"RESCORING",
	"RETURNED",
	"APPROVED",
	"ABANDONED",
	"REVOKED",
	"REJECTED",
];
const actionLabels: Record<string, string> = {
	SUBMITTED: "学生提交",
	RESUBMIT: "学生重新提交",
	ABANDON: "学生放弃",
	SUBMITSCORE: "辅导员评分",
	RETURN: "退回学生修改",
	APPROVE: "学院审核通过",
	RESCORE: "退回辅导员重评",
	REVOKE: "管理员撤销",
};
function studentLine(student: Claim["student"], includeName = false) {
	return [includeName ? student.name : "", student.studentNumber, student.className]
		.filter(Boolean)
		.join(" · ");
}
export function Claims({
	term,
	role,
	page,
	status,
	initialClaims,
}: {
	term: {
		id: string;
		phase: string;
		disposition?: string;
		revision: number;
		scheme: Scheme;
	};
	role: "ADMIN" | "COLLEGE" | "COUNSELOR" | "STUDENT";
	page: number;
	status: string;
	initialClaims: { items: Claim[]; total: number; page: number };
}) {
	const claims = useRemote<{ items: Claim[]; total: number; page: number }>(
		`/api/claims?termId=${term.id}&page=${page}&status=${encodeURIComponent(status)}`,
		initialClaims,
	);
	const [submissionOpen, setSubmissionOpen] = useState(false);
	const [submissionSession, setSubmissionSession] = useState(0);
	const [selected, setSelected] = useState<Claim | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [success, setSuccess] = useState("");
	const [ids, setIds] = useState<string[]>([]);
	const [uploading, setUploading] = useState(false);
	const [dirty, setDirty] = useState(false);
	const [resubmit, setResubmit] = useState(false);
	const active =
		term.phase === "ACTIVE" &&
		(!term.disposition || term.disposition === "NORMAL");
	const activityNodes = term.scheme.nodes.filter((n) => n.kind === "ACTIVITY");
	const nodeName = (nodeId: string | null) =>
		(nodeId && term.scheme.nodes.find((n) => n.id === nodeId)?.name) || "—";
	const stageNotice =
		term.disposition && term.disposition !== "NORMAL"
			? {
					title:
						term.disposition === "VOID"
							? "本周期已作废，成果申报只读"
							: "本周期已归档，成果申报只读",
					description: "可以查看原有申报和处理记录。",
				}
			: term.phase === "CONFIGURATION"
				? {
						title: "本周期配置中，尚未开放成果申报",
						description:
							"管理员完成评分方案配置并启用周期后，即可提交或处理成果申报。",
					}
				: term.phase === "CHECKING"
					? {
							title: "本周期核对中，成果申报已关闭",
							description:
								"请核对已发布的结果。如有疑问，请通过成绩异议提交问题和证明。",
						}
					: {
							title: "本周期已锁定，成果申报已关闭",
							description:
								role === "ADMIN"
									? "当前记录可查看；已通过的申报仍可在详情中按规则撤销。"
									: role === "STUDENT"
										? "当前记录可查看；如需更正成绩，请通过成绩异议提交问题和证明。"
										: "当前记录可查看，不能新增、评分或审核。如需更正，请联系管理员。",
						};
	function beginSubmission() {
		if (role !== "STUDENT" || !active) return;
		setIds([]);
		setUploading(false);
		setDirty(false);
		setError("");
		setSubmissionSession((value) => value + 1);
		setSubmissionOpen(true);
	}
	function closeModal(close: () => void) {
		if (busy || uploading) return;
		if (dirty && !window.confirm("放弃尚未保存的内容？")) return;
		setDirty(false);
		close();
	}
	function refresh() {
		claims.reload();
		setSelected(null);
		setDirty(false);
		setIds([]);
		setResubmit(false);
	}
	async function change(payload: Record<string, unknown>, message: string) {
		if (!selected || busy) return;
		setBusy(true);
		setError("");
		try {
			await requestJson(
				`/api/claims/${selected.id}`,
				{ termId: term.id, revision: selected.revision, ...payload },
				"PATCH",
			);
			setSuccess(message);
			refresh();
		} catch (err) {
			setError((err as Error).message);
		} finally {
			setBusy(false);
		}
	}
	const createAction =
		role === "STUDENT" && active ? (
			<Button onClick={beginSubmission}>
				<Plus data-icon="inline-start" />
				新建成果申报
			</Button>
		) : undefined;
	const columns: ColumnDef<DataTableFeatures, Claim>[] = [
		{
			id: "title",
			header: "成果",
			cell: ({ row }) => (
				<div>
					<p className="font-medium">{row.original.title}</p>
					<p className="text-xs text-muted-foreground">
						发生于 {row.original.occurredOn.slice(0, 10)}
					</p>
				</div>
			),
		},
		...(role === "STUDENT"
			? []
			: [
					{
						id: "student",
						header: "学生",
						cell: ({ row }: { row: { original: Claim } }) => (
							<div>
								<p>{row.original.student.name}</p>
								{studentLine(row.original.student) && (
									<p className="text-xs text-muted-foreground">
										{studentLine(row.original.student)}
									</p>
								)}
							</div>
						),
					} satisfies ColumnDef<DataTableFeatures, Claim>,
				]),
		{
			id: "score",
			header: "评分",
			cell: ({ row }) =>
				row.original.score === null ? (
					<span className="text-muted-foreground">待评分</span>
				) : (
					<div>
						<p>{row.original.score} 分</p>
						<p className="text-xs text-muted-foreground">
							{nodeName(row.original.scoreNodeId)}
						</p>
					</div>
				),
		},
		{
			accessorKey: "status",
			header: "状态",
			cell: ({ row }) => (
				<Badge variant="outline">
					{statusLabels[row.original.status] || row.original.status}
				</Badge>
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
				<Button
					variant="ghost"
					size="sm"
					onClick={() => {
						setSelected(row.original);
						setError("");
						setResubmit(false);
					}}
				>
					{role === "STUDENT"
						? "查看"
						: role === "COUNSELOR"
							? ["PENDING_COUNSELOR", "RESCORING"].includes(row.original.status)
								? "评分"
								: "查看"
							: role === "COLLEGE"
								? row.original.status === "PENDING_COLLEGE"
									? "审核"
									: "查看"
								: "查看"}
				</Button>
			),
		},
	];
	const directoryDescription = {
		STUDENT: "查看本人申报的评分、审核意见和处理进度。",
		COUNSELOR: "仅显示负责班级学生的申报；评分后提交学院。",
		COLLEGE: "仅显示本学院学生的申报；可通过或退回处理。",
		ADMIN: "查看全校申报和审核记录；已通过的申报可在详情撤销。",
	}[role];
	return (
		<>
			<Feedback error={error} success={success} />
			{!active && (
				<Alert className="mb-4">
					<AlertTitle>{stageNotice.title}</AlertTitle>
					<AlertDescription>{stageNotice.description}</AlertDescription>
				</Alert>
			)}
			<RemoteState {...claims} />
			{claims.data && (
				<TemplateDirectory
					description={`共 ${claims.data.total} 条记录。${directoryDescription}`}
					data={claims.data.items}
					columns={columns}
					empty={
						role === "STUDENT"
							? {
									title: "暂无成果申报",
									description:
										"提交成果和证明后，辅导员会评分并由学院审核。",
								}
							: role === "COUNSELOR"
								? {
										title: "当前没有申报记录",
										description:
											"学生提交成果后，会按负责班级显示在这里；可切换状态查看历史。",
									}
								: role === "COLLEGE"
									? {
											title: "当前没有申报记录",
											description:
												"辅导员评分并提交后，会按学院显示在这里；可切换状态查看历史。",
										}
									: {
											title: "当前没有申报记录",
											description:
												"学生提交、辅导员评分后，会在这里显示；可切换状态查看历史。",
										}
					}
					actions={createAction}
					filters={
						<form
							action="/claims"
							className="flex flex-wrap items-end gap-3"
						>
							<input type="hidden" name="termId" value={term.id} />
							<Field className="w-full sm:w-48">
								<FieldLabel htmlFor="claim-filter">申报状态</FieldLabel>
								<NativeSelect
									id="claim-filter"
									name="status"
									defaultValue={status}
								>
									<NativeSelectOption value="">全部状态</NativeSelectOption>
									{claimStatuses.map((s) => (
										<NativeSelectOption key={s} value={s}>
											{s === "PENDING" ? "处理中" : statusLabels[s]}
										</NativeSelectOption>
									))}
								</NativeSelect>
							</Field>
							<Button type="submit" variant="outline">筛选</Button>
						</form>
					}
					pagination={{
						page: claims.data.page,
						total: claims.data.total,
						href: (p) =>
							`/claims?termId=${term.id}&status=${status}&page=${p}`,
					}}
					mobile={(row) => (
						<div className="flex flex-col gap-3">
							<div className="flex justify-between gap-2">
								<p className="font-medium">{row.title}</p>
								<Badge variant="outline">
									{statusLabels[row.status] || row.status}
								</Badge>
							</div>
							<p className="text-sm text-muted-foreground">
								发生于 {row.occurredOn.slice(0, 10)} ·{" "}
								{row.score === null
									? "待评分"
									: `拟认定 ${row.score} 分（${nodeName(row.scoreNodeId)}）`}
							</p>
							{role !== "STUDENT" && (
								<p className="text-xs text-muted-foreground">
									{studentLine(row.student, true)}
								</p>
							)}
							<Button
								className="self-start"
								variant="outline"
								onClick={() => {
									setSelected(row);
									setResubmit(false);
									setError("");
								}}
							>
								{role === "STUDENT" ? "查看" : "处理"}
							</Button>
						</div>
					)}
				/>
			)}
			<Dialog
				open={submissionOpen}
				onOpenChange={(open) => {
					if (!open)
						closeModal(() => {
							setSubmissionOpen(false);
							setIds([]);
						});
				}}
			>
				<DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-4xl">
					<DialogHeader>
						<DialogTitle>新建成果申报</DialogTitle>
						<DialogDescription>
							填写成果、发生日期、说明和 1 至 5 份证明；分数由辅导员按评分方案评定，学生不用填分。
						</DialogDescription>
					</DialogHeader>
					<form
						key={submissionSession}
						className="flex flex-col gap-5"
						onChange={() => setDirty(true)}
						onSubmit={async (e) => {
							e.preventDefault();
							if (busy || uploading || role !== "STUDENT" || !active) return;
							setBusy(true);
							setError("");
							const f = new FormData(e.currentTarget);
							try {
								await requestJson("/api/claims", {
									termId: term.id,
									title: f.get("title"),
									occurredOn: f.get("occurredOn"),
									note: f.get("note"),
									evidenceIds: ids,
								});
								setSubmissionOpen(false);
								setSuccess("成果申报已提交，请等待辅导员评分和学院审核。");
								refresh();
							} catch (err) {
								setError((err as Error).message);
							} finally {
								setBusy(false);
							}
						}}
					>
						<Feedback error={error} />
						<TemplateEditor
							preview={
								<Card>
									<CardHeader>
										<CardTitle>申报与审核流程</CardTitle>
										<CardDescription>
											两级审核 · 分数由辅导员评定
										</CardDescription>
									</CardHeader>
									<CardContent>
										<ol className="list-decimal pl-5 text-sm leading-7 text-muted-foreground">
											<li>提交成果、发生日期、说明和证明；</li>
											<li>辅导员核对材料，选择计分项并评分；</li>
											<li>学院审核通过后计入成绩；</li>
											<li>退回时可补充材料重新提交，或放弃本次申报。</li>
										</ol>
									</CardContent>
								</Card>
							}
						>
							<FieldGroup>
								<Field>
									<FieldLabel htmlFor="claim-title">成果名称</FieldLabel>
									<Input
										id="claim-title"
										name="title"
										required
										maxLength={120}
										placeholder="例如：全国大学生数学竞赛省一等奖"
									/>
									<FieldDescription>
										简要概括成果内容，方便老师识别。
									</FieldDescription>
								</Field>
								<Field>
									<FieldLabel htmlFor="claim-date">发生日期</FieldLabel>
									<Input
										id="claim-date"
										name="occurredOn"
										type="date"
										required
									/>
								</Field>
								<Field>
									<FieldLabel htmlFor="claim-note">说明</FieldLabel>
									<Textarea
										id="claim-note"
										name="note"
										required
										minLength={2}
										maxLength={2000}
										rows={4}
										placeholder="说明成果内容、取得方式和本人贡献。"
									/>
								</Field>
								<EvidenceUpload
									onChange={(nextIds) => {
										setIds(nextIds);
										setDirty(true);
									}}
									onBusy={setUploading}
								/>
							</FieldGroup>
						</TemplateEditor>
						<Button
							type="submit"
							disabled={busy || uploading || !ids.length}
						>
							提交
						</Button>
					</form>
				</DialogContent>
			</Dialog>
			<Sheet
				open={!!selected}
				onOpenChange={(open) => {
					if (!open) closeModal(() => setSelected(null));
				}}
			>
				<SheetContent className="w-full overflow-y-auto sm:max-w-xl">
					<SheetHeader>
						<SheetTitle>{selected?.title}</SheetTitle>
						<SheetDescription>
							{selected && studentLine(selected.student, true)}
						</SheetDescription>
					</SheetHeader>
					{selected && (
						<div className="flex flex-col gap-5 px-5 pb-6">
							<Feedback error={error} />
							<Badge variant="outline" className="self-start">
								{statusLabels[selected.status] || selected.status}
							</Badge>
							{selected.student.organization && (
								<p className="text-sm text-muted-foreground">
									{selected.student.organization}
								</p>
							)}
							<dl className="grid grid-cols-2 gap-4 text-sm">
								<div>
									<dt className="text-xs text-muted-foreground">发生日期</dt>
									<dd className="mt-1">{selected.occurredOn.slice(0, 10)}</dd>
								</div>
								<div>
									<dt className="text-xs text-muted-foreground">提交时间</dt>
									<dd className="mt-1">{dateText(selected.createdAt)}</dd>
								</div>
								<div>
									<dt className="text-xs text-muted-foreground">
										辅导员评分
									</dt>
									<dd className="mt-1">
										{selected.score === null
											? "尚未评分"
											: `${selected.score} 分 · ${nodeName(selected.scoreNodeId)}`}
									</dd>
								</div>
								<div>
									<dt className="text-xs text-muted-foreground">评分人</dt>
									<dd className="mt-1">{selected.scorer?.name || "—"}</dd>
								</div>
							</dl>
							{selected.projectName && (
								<p className="text-sm text-muted-foreground">
									关联的历史认定项目：{selected.projectName}
								</p>
							)}
							<p className="whitespace-pre-wrap text-sm leading-7">
								{selected.note}
							</p>
							<div className="flex flex-col gap-2">
								{selected.evidence.map((evidence) => (
									<EvidenceViewer key={evidence.id} evidence={evidence} />
								))}
							</div>
							{selected.reviewReason && (
								<p className="whitespace-pre-wrap text-sm">
									审核意见：{selected.reviewReason}
								</p>
							)}
							<Separator />
							{active && role === "STUDENT" && selected.status === "RETURNED" && !resubmit && (
								<div className="flex flex-wrap gap-2">
									<Button
										onClick={() => {
											setResubmit(true);
											setIds([]);
											setError("");
										}}
									>
										补充材料并重新提交
									</Button>
									<Button
										variant="outline"
										disabled={busy}
										onClick={() =>
											change(
												{ action: "abandon" },
												"申报已放弃，不再进入审核。",
											)
										}
									>
										放弃申报
									</Button>
								</div>
							)}
							{active && role === "STUDENT" && selected.status === "RETURNED" && resubmit && (
								<form
									className="flex flex-col gap-4"
									onChange={() => setDirty(true)}
									onSubmit={async (e) => {
										e.preventDefault();
										if (busy || uploading || !ids.length) return;
										const f = new FormData(e.currentTarget);
										await change(
											{
												action: "resubmit",
												title: f.get("title"),
												occurredOn: f.get("occurredOn"),
												note: f.get("note"),
												evidenceIds: ids,
											},
											"已重新提交，等待辅导员评分。",
										);
									}}
								>
									<FieldGroup>
										<Field>
											<FieldLabel htmlFor="resubmit-title">
												成果名称
											</FieldLabel>
											<Input
												id="resubmit-title"
												name="title"
												defaultValue={selected.title}
												required
												maxLength={120}
											/>
										</Field>
										<Field>
											<FieldLabel htmlFor="resubmit-date">
												发生日期
											</FieldLabel>
											<Input
												id="resubmit-date"
												name="occurredOn"
												type="date"
												defaultValue={selected.occurredOn.slice(0, 10)}
												required
											/>
										</Field>
										<Field>
											<FieldLabel htmlFor="resubmit-note">
												说明
											</FieldLabel>
											<Textarea
												id="resubmit-note"
												name="note"
												defaultValue={selected.note}
												required
												minLength={2}
												maxLength={2000}
												rows={4}
											/>
											<FieldDescription>
												请按退回意见补充说明和证明，重新提交后会重新评分。
											</FieldDescription>
										</Field>
										<EvidenceUpload
											key={selected.id}
											onChange={setIds}
											onBusy={setUploading}
										/>
									</FieldGroup>
									<div className="flex flex-wrap gap-2">
										<Button
											type="submit"
											disabled={busy || uploading || !ids.length}
										>
											重新提交
										</Button>
										<Button
											type="button"
											variant="outline"
											disabled={busy}
											onClick={() =>
												change(
													{ action: "abandon" },
													"申报已放弃，不再进入审核。",
												)
											}
										>
											放弃申报
										</Button>
									</div>
								</form>
							)}
							{active &&
								role === "STUDENT" &&
								selected.status === "PENDING_COUNSELOR" && (
									<Button
										variant="outline"
										disabled={busy}
										onClick={() =>
											change(
												{ action: "abandon" },
												"申报已放弃，不再进入审核。",
											)
										}
									>
										放弃申报
									</Button>
								)}
							{active &&
								role === "COUNSELOR" &&
								["PENDING_COUNSELOR", "RESCORING"].includes(
									selected.status,
								) && (
									<>
										<form
											className="flex flex-col gap-4"
											onChange={() => setDirty(true)}
											onSubmit={async (e) => {
												e.preventDefault();
												if (busy) return;
												const f = new FormData(e.currentTarget);
												await change(
													{
														action: "submitScore",
														nodeId: f.get("nodeId"),
														score: f.get("score"),
													},
													"已评分并提交学院审核。",
												);
											}}
										>
											<FieldGroup>
												<Field>
													<FieldLabel htmlFor="score-node">
														计分项
													</FieldLabel>
													<SearchableSelect
														id="score-node"
														name="nodeId"
														required
														defaultValue={selected.scoreNodeId || ""}
														placeholder="选择计分项"
														searchPlaceholder="搜索计分项"
														options={activityNodes.map((n) => ({
															value: n.id,
															label: n.name,
															description: `${n.minimum} 至 ${n.maximum} 分`,
														}))}
													/>
												</Field>
												<Field>
													<FieldLabel htmlFor="score-value">
														分数
													</FieldLabel>
													<Input
														id="score-value"
														name="score"
														inputMode="decimal"
														required
														defaultValue={selected.score ?? ""}
													/>
													<FieldDescription>
														分数须在评分项范围内，0 分也有效。提交后进入学院审核。
													</FieldDescription>
												</Field>
											</FieldGroup>
											<Button type="submit" disabled={busy}>
												提交评分
											</Button>
										</form>
										<form
											className="flex flex-col gap-4"
											onSubmit={async (e) => {
												e.preventDefault();
												if (busy) return;
												const f = new FormData(e.currentTarget);
												await change(
													{ action: "return", reason: f.get("reason") },
													"已退回学生修改。",
												);
											}}
										>
											<Field>
												<FieldLabel htmlFor="counselor-return-reason">
													退回原因
												</FieldLabel>
												<Textarea
													id="counselor-return-reason"
													name="reason"
													required
													minLength={2}
													maxLength={1000}
													rows={3}
												/>
											</Field>
											<Button
												type="submit"
												variant="outline"
												disabled={busy}
											>
												退回学生修改
											</Button>
										</form>
									</>
								)}
							{active && role === "COLLEGE" && selected.status === "PENDING_COLLEGE" && (
								<>
									{selected.score === null ? (
										<Alert>
											<AlertTitle>尚未评分</AlertTitle>
											<AlertDescription>
												该申报还没有分数，不能通过；请退回辅导员重评。
											</AlertDescription>
										</Alert>
									) : (
										<Button
											disabled={busy}
											onClick={() =>
												change(
													{ action: "approve" },
													"已通过，申报计入成绩。",
												)
											}
										>
											通过（{selected.score} 分）
										</Button>
									)}
									<form
										className="flex flex-col gap-4"
										onSubmit={async (e) => {
											e.preventDefault();
											if (busy) return;
											const f = new FormData(e.currentTarget);
											const action = (
												(e.nativeEvent as SubmitEvent)
													.submitter as HTMLButtonElement
											).value;
											await change(
												{ action, reason: f.get("reason") },
												action === "rescore"
													? "已退回辅导员重评。"
													: "已退回学生修改。",
											);
										}}
									>
										<Field>
											<FieldLabel htmlFor="college-return-reason">
												退回原因
											</FieldLabel>
											<Textarea
												id="college-return-reason"
												name="reason"
												required
												minLength={2}
												maxLength={1000}
												rows={3}
											/>
											<FieldDescription>
												退回学生：由学生补充材料；退回辅导员：重新评分。
											</FieldDescription>
										</Field>
										<div className="flex flex-wrap gap-2">
											<Button
												type="submit"
												variant="outline"
												value="return"
												disabled={busy}
											>
												退回学生修改
											</Button>
											<Button
												type="submit"
												variant="outline"
												value="rescore"
												disabled={busy}
											>
												退回辅导员重评
											</Button>
										</div>
									</form>
								</>
							)}
							{active && role === "ADMIN" && selected.status === "APPROVED" && (
								<form
									className="flex flex-col gap-4"
									onSubmit={async (e) => {
										e.preventDefault();
										if (busy) return;
										const f = new FormData(e.currentTarget);
										await change(
											{ action: "revoke", reason: f.get("reason") },
											"已撤销该申报，结果将不再计入。",
										);
									}}
								>
									<Field>
										<FieldLabel htmlFor="admin-revoke-reason">
											撤销原因
										</FieldLabel>
										<Textarea
											id="admin-revoke-reason"
											name="reason"
											required
											minLength={2}
											maxLength={1000}
											rows={3}
										/>
									</Field>
									<Button type="submit" variant="outline" disabled={busy}>
										撤销
									</Button>
								</form>
							)}
							{!!selected.history?.length && (
								<section className="flex flex-col gap-3">
									<h3 className="font-medium text-sm">处理记录</h3>
									{selected.history.map((item, index) => (
										<div key={index} className="border-l pl-3">
											<p className="text-sm">
												{actionLabels[item.action || ""] ||
													statusLabels[item.after || ""] ||
													item.action ||
													"状态变更"}
											</p>
											{typeof item.score === "string" && (
												<p className="text-sm text-muted-foreground">
													评分：{item.score} 分
												</p>
											)}
											{item.reason && (
												<p className="whitespace-pre-wrap text-sm text-muted-foreground">
													{item.reason}
												</p>
											)}
											<p className="text-xs text-muted-foreground">
												{dateText(item.at)}
											</p>
										</div>
									))}
								</section>
							)}
						</div>
					)}
				</SheetContent>
			</Sheet>
		</>
	);
}
