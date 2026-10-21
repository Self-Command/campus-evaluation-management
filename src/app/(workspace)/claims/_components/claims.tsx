"use client";
import { EvidenceViewer } from "@/components/dashboard/evidence-viewer";
// Complete users directory plus invoice form, retaining template header, filtering, table and editor panels.
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
import Link from "next/link";
import { ActivityAssociation } from "./activity-association";
import { ScoringCorrection } from "@/components/dashboard/scoring-correction";
export type Project = {
	id: string;
	revision: number;
	name: string;
	description: string;
	nodeId: string;
	points: string;
	enabled: boolean;
};
export type Claim = {
	activityId?: string | null;
	activity?: { id: string; name: string } | null;
	id: string;
	revision: number;
	status: string;
	factKey: string;
	occurredOn: string;
	note: string;
	reviewReason?: string | null;
	createdAt: string;
	project: Project;
	student: { id: string; name: string; login: string };
	evidence: {
		id?: string;
		name?: string;
		evidence?: { id: string; name: string };
	}[];
	history?: {
		id?: string;
		action?: string;
		after?: string;
		reason?: string;
		at: string;
	}[];
};
export function Claims({
	term,
	role,
	page,
	status,
	initialProjects,
	initialClaims,
}: {
	term: {
		id: string;
		phase: string;
		disposition?: string;
		revision: number;
		scheme: Scheme;
	};
	role: "ADMIN" | "STUDENT";
	page: number;
	status: string;
	initialProjects: Project[];
	initialClaims: { items: Claim[]; total: number; page: number };
}) {
	const projects = useRemote<Project[]>(
		`/api/projects?termId=${term.id}`,
		initialProjects,
	);
	const claims = useRemote<{ items: Claim[]; total: number; page: number }>(
		`/api/claims?termId=${term.id}&page=${page}&status=${encodeURIComponent(status)}`,
		initialClaims,
	);
	const [edit, setEdit] = useState<Project | "new" | null>(null);
	const [submit, setSubmit] = useState<Project | null>(null);
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
	const [correction, setCorrection] = useState<Project | null>(null);
	const active =
		term.phase === "ACTIVE" &&
		(!term.disposition || term.disposition === "NORMAL");
	const enabledProjects = (projects.data ?? []).filter(
		(project) => project.enabled,
	);
	const stageNotice =
		term.disposition && term.disposition !== "NORMAL"
			? {
					title:
						term.disposition === "VOID"
							? "本周期已作废，个人申报只读"
							: "本周期已归档，个人申报只读",
					description: "可以查询原有申报与处理记录。",
				}
			: term.phase === "CONFIGURATION"
				? {
						title: "本周期配置中，尚未开放个人申报",
						description:
							"请等待管理员完成评分制度配置并启用周期后，再提交个人申报。",
					}
				: term.phase === "CHECKING"
					? {
							title: "本周期核对中，个人申报已关闭",
							description:
								"请核对已发布的测评结果。如对结果有疑问，请通过结果异议提交问题和证明材料。",
						}
					: {
							title: "本周期已锁定，个人申报已关闭",
							description:
								"当前记录可查询，不能新增或补交申报。如需更正，请联系管理员按更正流程处理。",
						};
	function beginSubmission(project: Project | null = null) {
		if (
			role !== "STUDENT" ||
			!active ||
			!enabledProjects.length ||
			(project && !project.enabled)
		)
			return;
		setSubmit(project);
		setIds([]);
		setUploading(false);
		setDirty(false);
		setError("");
		setSubmissionSession((value) => value + 1);
		setSubmissionOpen(true);
	}
	function beginProject() {
		if (role !== "ADMIN" || !active) return;
		setEdit("new");
		setDirty(false);
		setError("");
	}
	const createAction = active ? (
		role === "ADMIN" ? (
			<Button onClick={beginProject}>
				<Plus data-icon="inline-start" />
				新建认定项目
			</Button>
		) : enabledProjects.length ? (
			<Button onClick={() => beginSubmission()}>
				<Plus data-icon="inline-start" />
				新建个人申报
			</Button>
		) : undefined
	) : undefined;
	function closeModal(close: () => void) {
		if (busy || uploading) return;
		if (dirty && !window.confirm("放弃尚未保存的内容？")) return;
		setDirty(false);
		close();
	}
	function refresh() {
		projects.reload();
		claims.reload();
		setSelected(null);
		setDirty(false);
		setIds([]);
		setResubmit(false);
	}
	const columns: ColumnDef<DataTableFeatures, Claim>[] = [
		{
			id: "student",
			header: "学生",
			cell: ({ row }) => (
				<div>
					<p className="font-medium">{row.original.student.name}</p>
					<p className="text-xs text-muted-foreground">
						{row.original.student.login}
					</p>
				</div>
			),
		},
		{
			id: "project",
			header: "项目 / 事实",
			cell: ({ row }) => (
				<div>
					<p>{row.original.project.name}</p>
					<p className="text-xs text-muted-foreground">
						{row.original.factKey}
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
					查看材料
				</Button>
			),
		},
	];
	const projectColumns: ColumnDef<DataTableFeatures, Project>[] = [
		{
			accessorKey: "name",
			header: "认定项目",
			cell: ({ row }) => (
				<div>
					<p className="font-medium">{row.original.name}</p>
					<p className="max-w-sm truncate text-xs text-muted-foreground">
						{row.original.description}
					</p>
				</div>
			),
		},
		{
			accessorKey: "points",
			header: "固定分值",
			cell: ({ row }) => `${row.original.points} 分`,
		},
		{
			id: "node",
			header: "计分模块",
			cell: ({ row }) =>
				term.scheme.nodes.find((n) => n.id === row.original.nodeId)?.name ||
				"—",
		},
		{
			accessorKey: "enabled",
			header: "状态",
			cell: ({ row }) => (
				<Badge variant="outline">
					{row.original.enabled ? "启用" : "停用"}
				</Badge>
			),
		},
		{
			id: "actions",
			header: "操作",
			cell: ({ row }) =>
				active ? (
					<div className="flex flex-wrap gap-2">
						<Button
							size="sm"
							variant="outline"
							disabled={role === "STUDENT" && !row.original.enabled}
							onClick={() => {
								setError("");
								setDirty(false);
								setIds([]);
								if (role === "ADMIN") setEdit(row.original);
								else beginSubmission(row.original);
							}}
						>
							{role === "ADMIN" ? "编辑项目" : "提交申报"}
						</Button>
						{role === "ADMIN" && (
							<Button
								size="sm"
								variant="ghost"
								onClick={() => setCorrection(row.original)}
							>
								计分更正
							</Button>
						)}
					</div>
				) : null,
		},
	];
	return (
		<>
			<Feedback error={error} success={success} />
			{!active && (
				<Alert className="mb-4">
					<AlertTitle>{stageNotice.title}</AlertTitle>
					<AlertDescription>
						{role === "ADMIN"
							? `${stageNotice.description}认定项目维护与申报审核仅在申报开放阶段进行。`
							: stageNotice.description}
					</AlertDescription>
				</Alert>
			)}
			{role === "STUDENT" &&
				!projects.loading &&
				!projects.error &&
				!enabledProjects.length && (
					<Alert className="mb-4">
						<AlertTitle>暂无可申报项目</AlertTitle>
						<AlertDescription>
							当前周期尚无启用的认定项目，请联系管理员确认项目开放安排。项目启用且周期开放后，可在此新建个人申报。
						</AlertDescription>
					</Alert>
				)}
			<Tabs defaultValue="claims">
				<TabsList>
					<TabsTrigger value="claims">申报记录</TabsTrigger>
					<TabsTrigger value="projects">
						{role === "STUDENT" ? "可申报项目" : "认定项目"}
					</TabsTrigger>
				</TabsList>
				<TabsContent className="mt-4" value="claims">
					<RemoteState {...projects} />
					<RemoteState {...claims} />
					{claims.data && (
						<TemplateDirectory
							title={role === "ADMIN" ? "个人申报审核" : "我的个人申报"}
							description={`共 ${claims.data.total} 条记录，同一项目的同一事实只认定一次。`}
							data={claims.data.items}
							columns={columns}
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
											{[
												"PENDING",
												"APPROVED",
												"REJECTED",
												"NEEDS_CHANGES",
												"WITHDRAWN",
												"REVOKED",
											].map((s) => (
												<NativeSelectOption key={s} value={s}>
													{statusLabels[s]}
												</NativeSelectOption>
											))}
										</NativeSelect>
									</Field>
									<Button variant="outline">筛选</Button>
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
										<p className="font-medium">{row.project.name}</p>
										<Badge variant="outline">{statusLabels[row.status]}</Badge>
									</div>
									<p className="text-sm">{row.factKey}</p>
									<p className="text-xs text-muted-foreground">
										{row.student.name} · {row.student.login}
									</p>
									<Button
										className="self-start"
										variant="outline"
										onClick={() => {
											setSelected(row);
											setResubmit(false);
											setError("");
										}}
									>
										查看材料
									</Button>
								</div>
							)}
						/>
					)}
				</TabsContent>
				<TabsContent className="mt-4" value="projects">
					<RemoteState {...projects} />
					{projects.data && (
						<TemplateDirectory
							title={role === "STUDENT" ? "可申报项目" : "认定项目"}
							description="项目分值由管理员统一配置，申报时填写事实与材料。"
							data={projects.data}
							columns={projectColumns}
							actions={role === "ADMIN" ? createAction : undefined}
							mobile={(row) => (
								<div className="flex flex-col gap-3">
									<div className="flex justify-between gap-2">
										<p className="font-medium">{row.name}</p>
										<Badge variant="outline">{row.points} 分</Badge>
									</div>
									<p className="text-sm text-muted-foreground">
										{row.description}
									</p>
									{active && (
										<div className="flex flex-wrap gap-2">
											<Button
												className="self-start"
												variant="outline"
												disabled={role === "STUDENT" && !row.enabled}
												onClick={() => {
													setDirty(false);
													setIds([]);
													if (role === "ADMIN") setEdit(row);
													else beginSubmission(row);
												}}
											>
												{role === "ADMIN" ? "编辑项目" : "提交申报"}
											</Button>
											{role === "ADMIN" && (
												<Button
													variant="outline"
													onClick={() => setCorrection(row)}
												>
													计分更正
												</Button>
											)}
										</div>
									)}
								</div>
							)}
						/>
					)}
				</TabsContent>
			</Tabs>
			{correction && (
				<ScoringCorrection
					key={`${correction.id}-${correction.revision}`}
					term={term}
					kind="project"
					item={correction}
					open={!!correction}
					onOpenChange={(open) => {
						if (!open) setCorrection(null);
					}}
					onCommitted={() => {
						setCorrection(null);
						setSuccess("认定项目计分已更正，请重新核对并发布结果。");
						refresh();
					}}
				/>
			)}
			<Dialog
				open={!!edit}
				onOpenChange={(open) => {
					if (!open) closeModal(() => setEdit(null));
				}}
			>
				<DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-4xl">
					<DialogHeader>
						<DialogTitle>
							{edit === "new" ? "新建认定项目" : "编辑认定项目"}
						</DialogTitle>
						<DialogDescription>
							有申报后不能直接变更计分模块与分值；停用不会取消已有有效事实。
						</DialogDescription>
					</DialogHeader>
					{edit && (
						<form
							className="flex flex-col gap-5"
							onChange={() => setDirty(true)}
							onSubmit={async (e) => {
								e.preventDefault();
								if (busy) return;
								setBusy(true);
								setError("");
								const f = new FormData(e.currentTarget);
								try {
									await requestJson("/api/projects", {
										termId: term.id,
										id: edit === "new" ? undefined : edit.id,
										revision: edit === "new" ? undefined : edit.revision,
										name: f.get("name"),
										description: f.get("description"),
										nodeId: f.get("nodeId"),
										points: f.get("points"),
										enabled: f.get("enabled") === "true",
									});
									setEdit(null);
									setSuccess("认定项目已保存。");
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
											<CardTitle>认定规则</CardTitle>
											<CardDescription>固定分值 · 活动累计模块</CardDescription>
										</CardHeader>
										<CardContent>
											<p className="text-sm text-muted-foreground">
												学生提交事实标识、发生日期与证明材料，经审核通过后按项目分值计入。同一事实在本周期内只认定一次。
											</p>
										</CardContent>
									</Card>
								}
							>
								<FieldGroup>
									<Field>
										<FieldLabel htmlFor="project-name">项目名称</FieldLabel>
										<Input
											id="project-name"
											name="name"
											defaultValue={edit === "new" ? "" : edit.name}
											required
											maxLength={120}
										/>
									</Field>
									<Field>
										<FieldLabel htmlFor="project-description">
											认定说明
										</FieldLabel>
										<Textarea
											id="project-description"
											name="description"
											defaultValue={edit === "new" ? "" : edit.description}
											required
											maxLength={2000}
											rows={4}
										/>
									</Field>
									<Field>
										<FieldLabel htmlFor="project-node">计分模块</FieldLabel>
										<NativeSelect
											id="project-node"
											name="nodeId"
											defaultValue={edit === "new" ? "" : edit.nodeId}
											required
										>
											<NativeSelectOption value="">
												选择活动累计模块
											</NativeSelectOption>
											{term.scheme.nodes
												.filter((n) => n.kind === "ACTIVITY")
												.map((n) => (
													<NativeSelectOption key={n.id} value={n.id}>
														{n.name}
													</NativeSelectOption>
												))}
										</NativeSelect>
									</Field>
									<Field>
										<FieldLabel htmlFor="project-points">固定分值</FieldLabel>
										<Input
											id="project-points"
											name="points"
											defaultValue={edit === "new" ? "" : edit.points}
											inputMode="decimal"
											required
										/>
									</Field>
									<Field>
										<FieldLabel htmlFor="project-enabled">项目状态</FieldLabel>
										<NativeSelect
											id="project-enabled"
											name="enabled"
											defaultValue={
												edit === "new" ? "true" : String(edit.enabled)
											}
										>
											<NativeSelectOption value="true">启用</NativeSelectOption>
											<NativeSelectOption value="false">
												停用
											</NativeSelectOption>
										</NativeSelect>
									</Field>
								</FieldGroup>
							</TemplateEditor>
							<Button type="submit" disabled={busy}>
								保存项目
							</Button>
						</form>
					)}
				</DialogContent>
			</Dialog>
			<Dialog
				open={submissionOpen}
				onOpenChange={(open) => {
					if (!open)
						closeModal(() => {
							setSubmissionOpen(false);
							setSubmit(null);
							setIds([]);
						});
				}}
			>
				<DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-4xl">
					<DialogHeader>
						<DialogTitle>提交个人申报</DialogTitle>
						<DialogDescription>
							先选择认定项目，再填写事实、发生日期、申报说明及1至5份证明材料。
						</DialogDescription>
					</DialogHeader>
					<form
						key={submissionSession}
						className="flex flex-col gap-5"
						onChange={() => setDirty(true)}
						onSubmit={async (e) => {
							e.preventDefault();
							if (
								busy ||
								uploading ||
								!submit ||
								!active ||
								role !== "STUDENT" ||
								!submit.enabled ||
								projects.loading ||
								!!projects.error ||
								!enabledProjects.some((project) => project.id === submit.id) ||
								ids.length < 1 ||
								ids.length > 5
							)
								return;
							setBusy(true);
							setError("");
							const f = new FormData(e.currentTarget);
							try {
								await requestJson("/api/claims", {
									termId: term.id,
									projectId: submit.id,
									factKey: f.get("factKey"),
									occurredOn: f.get("occurredOn"),
									note: f.get("note"),
									evidenceIds: ids,
									activityId: f.get("activityId") || undefined,
								});
								setSubmit(null);
								setSubmissionOpen(false);
								setSuccess("个人申报已提交，请等待审核。");
								refresh();
							} catch (err) {
								setError((err as Error).message);
							} finally {
								setBusy(false);
							}
						}}
					>
						<Feedback error={error} />
						<RemoteState {...projects} />
						{submit &&
							!projects.loading &&
							!projects.error &&
							!enabledProjects.some((project) => project.id === submit.id) && (
								<Alert>
									<AlertTitle>所选项目已停用或不可用</AlertTitle>
									<AlertDescription>
										已填写的内容和证明材料已保留，请重新选择可申报项目。若没有可选项目，请联系管理员。
									</AlertDescription>
								</Alert>
							)}
						<TemplateEditor
							preview={
								<Card>
									<CardHeader>
										<CardTitle>{submit?.name || "选择认定项目"}</CardTitle>
										<CardDescription>
											{submit
												? `固定认定分值 ${submit.points} 分`
												: "选择后查看项目认定规则与固定分值"}
										</CardDescription>
									</CardHeader>
									<CardContent>
										{submit ? (
											<div className="flex flex-col gap-4">
												<p className="whitespace-pre-wrap text-sm leading-7">
													{submit.description}
												</p>
												<p className="text-sm text-muted-foreground">
													计分模块：
													{term.scheme.nodes.find(
														(node) => node.id === submit.nodeId,
													)?.name || "—"}
												</p>
											</div>
										) : (
											<p className="text-sm text-muted-foreground">
												请从左侧选择可申报项目。同一事实在本周期内只认定一次，分值以管理员配置为准。
											</p>
										)}
									</CardContent>
								</Card>
							}
						>
							<FieldGroup>
								<Field>
									<FieldLabel htmlFor="claim-project">认定项目</FieldLabel>
									<NativeSelect
										id="claim-project"
										name="projectId"
										required
										value={submit?.id || ""}
										disabled={busy || projects.loading || !!projects.error}
										onChange={(event) =>
											setSubmit(
												enabledProjects.find(
													(project) => project.id === event.target.value,
												) || null,
											)
										}
									>
										<NativeSelectOption value="">
											选择可申报项目
										</NativeSelectOption>
										{enabledProjects.map((project) => (
											<NativeSelectOption key={project.id} value={project.id}>
												{project.name} · {project.points} 分
											</NativeSelectOption>
										))}
									</NativeSelect>
									<FieldDescription>
										切换项目会保留已填写的事实、说明及证明材料，请确认材料符合所选项目规则。
									</FieldDescription>
								</Field>
								<fieldset disabled={!submit || busy}>
									<FieldGroup>
										<Field>
											<FieldLabel htmlFor="claim-key">事实标识</FieldLabel>
											<Input
												id="claim-key"
												name="factKey"
												required
												maxLength={120}
											/>
											<FieldDescription>
												填写成果名称、证书编号等可区分本次事实的信息。
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
										<ActivityAssociation termId={term.id} disabled={busy} />
										<Field>
											<FieldLabel htmlFor="claim-note">申报说明</FieldLabel>
											<Textarea
												id="claim-note"
												name="note"
												required
												minLength={2}
												maxLength={2000}
												rows={4}
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
								</fieldset>
							</FieldGroup>
						</TemplateEditor>
						<Button
							type="submit"
							disabled={
								busy ||
								uploading ||
								!submit ||
								!ids.length ||
								projects.loading ||
								!!projects.error ||
								!enabledProjects.some((project) => project.id === submit.id)
							}
						>
							提交申报
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
						<SheetTitle>{selected?.project.name}</SheetTitle>
						<SheetDescription>
							{selected?.student.name} · {selected?.student.login}
						</SheetDescription>
					</SheetHeader>
					{selected && (
						<div className="flex flex-col gap-5 px-5 pb-6">
							<Feedback error={error} />
							<Badge variant="outline" className="self-start">
								{statusLabels[selected.status]}
							</Badge>
							<dl className="grid grid-cols-2 gap-4 text-sm">
								<div>
									<dt className="text-xs text-muted-foreground">事实标识</dt>
									<dd className="mt-1 break-words">{selected.factKey}</dd>
								</div>
								<div>
									<dt className="text-xs text-muted-foreground">发生日期</dt>
									<dd className="mt-1">{selected.occurredOn.slice(0, 10)}</dd>
								</div>
							</dl>
							<p className="whitespace-pre-wrap text-sm leading-7">
								{selected.note}
							</p>
							{selected.activityId && (
								<Link
									href={`/activities/${selected.activityId}`}
									className="text-sm underline"
								>
									关联活动：{selected.activity?.name || "查看活动详情"}
								</Link>
							)}
							<div className="flex flex-col gap-2">
								{selected.evidence.map((item) => {
									const evidence = item.evidence || item;
									return evidence.id ? (
										<EvidenceViewer
											key={evidence.id}
											evidence={{
												id: evidence.id,
												name: evidence.name || "证明材料",
											}}
										/>
									) : null;
								})}
							</div>
							{selected.reviewReason && (
								<p className="whitespace-pre-wrap text-sm">
									审核意见：{selected.reviewReason}
								</p>
							)}
							<Separator />
							{active &&
								((role === "ADMIN" &&
									["PENDING", "NEEDS_CHANGES", "APPROVED"].includes(
										selected.status,
									)) ||
									(role === "STUDENT" &&
										(selected.status === "PENDING" ||
											["REJECTED", "NEEDS_CHANGES", "WITHDRAWN"].includes(
												selected.status,
											)))) && (
									<form
										className="flex flex-col gap-4"
										onChange={() => setDirty(true)}
										onSubmit={async (e) => {
											e.preventDefault();
											if (busy || uploading) return;
											const f = new FormData(e.currentTarget);
											const action = (
												(e.nativeEvent as SubmitEvent)
													.submitter as HTMLButtonElement
											).value;
											setBusy(true);
											setError("");
											try {
												await requestJson(
													`/api/claims/${selected.id}`,
													{
														termId: term.id,
														revision: selected.revision,
														action: [
															"APPROVED",
															"REJECTED",
															"NEEDS_CHANGES",
														].includes(action)
															? "review"
															: action,
														status: [
															"APPROVED",
															"REJECTED",
															"NEEDS_CHANGES",
														].includes(action)
															? action
															: undefined,
														reason:
															role === "ADMIN" ? f.get("reason") : undefined,
														note:
															action === "resubmit" ? f.get("note") : undefined,
														evidenceIds:
															action === "resubmit" ? ids : undefined,
													},
													"PATCH",
												);
												setSuccess("申报状态已更新。");
												refresh();
											} catch (err) {
												setError((err as Error).message);
											} finally {
												setBusy(false);
											}
										}}
									>
										{role === "ADMIN" ? (
											<>
												<FieldGroup>
													<Field>
														<FieldLabel htmlFor="claim-review-reason">
															审核、结束或撤销理由
														</FieldLabel>
														<Textarea
															id="claim-review-reason"
															name="reason"
															required
															minLength={2}
															maxLength={1000}
															rows={4}
														/>
													</Field>
												</FieldGroup>
												<div className="flex flex-wrap gap-2">
													{selected.status === "PENDING" ? (
														<>
															<Button
																type="submit"
																value="APPROVED"
																disabled={busy}
															>
																通过
															</Button>
															<Button
																type="submit"
																variant="outline"
																value="NEEDS_CHANGES"
																disabled={busy}
															>
																要求补充
															</Button>
															<Button
																type="submit"
																variant="outline"
																value="REJECTED"
																disabled={busy}
															>
																驳回
															</Button>
														</>
													) : selected.status === "APPROVED" ? (
														<Button
															type="submit"
															variant="outline"
															value="revoke"
															disabled={busy}
														>
															撤销有效认定
														</Button>
													) : null}
													{["PENDING", "NEEDS_CHANGES"].includes(
														selected.status,
													) && (
														<Button
															type="submit"
															variant="outline"
															value="close"
															disabled={busy}
														>
															填写理由并结束申报
														</Button>
													)}
												</div>
											</>
										) : selected.status === "PENDING" ? (
											<Button
												type="submit"
												variant="outline"
												value="withdraw"
												disabled={busy}
											>
												撤回申报
											</Button>
										) : resubmit ? (
											<>
												<FieldGroup>
													<Field>
														<FieldLabel htmlFor="claim-resubmit-note">
															补充说明
														</FieldLabel>
														<Textarea
															id="claim-resubmit-note"
															name="note"
															defaultValue={selected.note}
															required
															minLength={2}
															maxLength={2000}
															rows={4}
														/>
													</Field>
													<EvidenceUpload
														key={submit?.id || selected?.id || "new"}
														onChange={setIds}
														onBusy={setUploading}
													/>
												</FieldGroup>
												<Button
													type="submit"
													value="resubmit"
													disabled={busy || uploading || !ids.length}
												>
													重新提交
												</Button>
											</>
										) : (
											<Button
												type="button"
												variant="outline"
												onClick={() => {
													setResubmit(true);
													setIds([]);
												}}
											>
												补充并重新提交
											</Button>
										)}
										{role === "STUDENT" &&
											selected.status === "NEEDS_CHANGES" && (
												<Button
													type="submit"
													value="withdraw"
													formNoValidate
													variant="outline"
													disabled={busy || uploading}
												>
													放弃补充并撤回申报
												</Button>
											)}
									</form>
								)}
							{!!selected.history?.length && (
								<section className="flex flex-col gap-3">
									<h3 className="font-medium text-sm">处理历史</h3>
									{selected.history.map((item, index) => (
										<div key={item.id || index} className="border-l pl-3">
											<p className="text-sm">
												{statusLabels[item.after || ""] ||
													item.action ||
													"状态变更"}
											</p>
											<p className="whitespace-pre-wrap text-sm text-muted-foreground">
												{item.reason}
											</p>
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
