"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { useUnsavedChanges } from "@/components/dashboard/use-unsaved-changes";
import { dateText } from "@/lib/business-labels";
import { useState } from "react";
import type { DataTableFeatures } from "@/lib/data-table-features";
import {
	Card,
	CardHeader,
	CardTitle,
	CardDescription,
	CardContent,
	CardAction,
} from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { SearchableSelect } from "@/components/dashboard/searchable-select";
import {
	Table,
	TableHeader,
	TableHead,
	TableRow,
	TableBody,
	TableCell,
} from "@/components/ui/table";
import { Feedback } from "@/components/dashboard/feedback";
import { RecordList } from "@/components/dashboard/record-list";
import type { Scheme } from "@/lib/scoring/types";
type PreviewRow = {
	line: number;
	login: string;
	name: string;
	college: string;
	collegeCode: string;
	major: string;
	className: string;
	score: string | null;
	before: string | null;
	state: string;
	message: string;
	duplicateCandidates?: {
		userId: string;
		login: string;
		name: string;
		studentNumber: string;
		disabled: boolean;
		likely: boolean;
	}[];
	fileDuplicateOf?: number;
};
type Preview = {
	id: string;
	kind: "INITIAL" | "CORRECTION";
	errors: number;
	changes: number;
	unresolved: number;
	expiresAt: string;
	baselineRevision: number;
	rosterCommitted: boolean;
	rows: PreviewRow[];
};
type ImportResult = {
	created?: number;
	written?: number;
	submitted?: number;
	submittedForReview?: boolean;
	updated?: number;
	unchanged?: number;
	skipped: number;
	kind?: "INITIAL" | "CORRECTION";
	rosterRevision?: number;
	replay: boolean;
	targetRole?: AccountRole;
	credentials?: { login: string; initialPassword: string }[];
};
type AccountRole = "STUDENT" | "COUNSELOR" | "COLLEGE";
const accountRoleLabels: Record<AccountRole, string> = {
	STUDENT: "学生",
	COUNSELOR: "辅导员",
	COLLEGE: "学院管理人员",
};
const accountRoleHints: Record<AccountRole, string> = {
	STUDENT:
		"学生账号使用学号登录，必须匹配已启用班级及其责任辅导员；同班同名不同学号需逐条确认。",
	COUNSELOR:
		"辅导员账号绑定学院，导入后不会自动分配班级；请再到班级目录为其设置负责班级。",
	COLLEGE:
		"学院管理人员账号绑定学院，可维护本院专业、班级和审核，不能维护其他学院。",
};
const labels: Record<string, string> = {
	login: "学号",
	name: "姓名",
	college: "学院",
	collegeCode: "学院编码",
	major: "专业",
	className: "班级",
	value: "成绩",
};
const states: Record<string, string> = {
	NEW: "新增",
	EXISTING: "沿用已有记录",
	UNCHANGED: "无变化",
	UPDATE: "更新得分",
	SKIP: "跳过",
	SAME: "相同",
	OVERWRITE: "覆盖",
	ERROR: "错误",
	DUPLICATE: "待确认重复",
};
const participationHeaders = ["学号", "姓名", "学院", "专业", "班级"];
type RawPreview = {
	id: string;
	errors: number;
	unresolved?: number;
	expiresAt: string;
	changes?: number;
	baselineRevision?: number;
	rosterCommitted?: boolean;
	kind?: "INITIAL" | "CORRECTION";
	rows: Record<string, unknown>[];
};
type DuplicateResolution = {
	action: "" | "KEEP_BOTH" | "SKIP" | "USE_EXISTING";
	reason: string;
};
function text(value: unknown) {
	return typeof value === "string" ? value : value == null ? "" : String(value);
}
function normalizePreview(
	kind: "accounts" | "grades" | "participation",
	data: RawPreview,
): Preview {
	const rows = data.rows.map((raw) => {
		const identity =
			kind === "accounts" && raw.data && typeof raw.data === "object"
				? (raw.data as Record<string, unknown>)
				: raw;
		const score = identity.score ?? raw.score ?? raw.value ?? null;
		const before = identity.before ?? raw.before ?? null;
		const rawCandidates = Array.isArray(raw.duplicateCandidates)
			? raw.duplicateCandidates
			: Array.isArray(identity.duplicateCandidates)
				? identity.duplicateCandidates
				: [];
		return {
			line: Number(raw.line ?? 0),
			login: text(identity.login),
			name: text(identity.name),
			college: text(identity.college),
			collegeCode: text(identity.collegeCode ?? raw.collegeCode),
			major: text(identity.major),
			className: text(identity.className),
			score: score == null ? null : text(score),
			before: before == null ? null : text(before),
			state: text(raw.state),
			message: text(raw.message),
			duplicateCandidates: rawCandidates
				.filter(
					(candidate): candidate is Record<string, unknown> =>
						!!candidate && typeof candidate === "object",
				)
				.map((candidate) => ({
					userId: text(candidate.userId),
					login: text(candidate.login),
					name: text(candidate.name),
					studentNumber: text(candidate.studentNumber),
					disabled: candidate.disabled === true,
					likely: candidate.likely === true,
				})),
			fileDuplicateOf:
				(raw.fileDuplicateOf ?? identity.fileDuplicateOf) == null
					? undefined
					: Number(raw.fileDuplicateOf ?? identity.fileDuplicateOf),
		};
	});
	return {
		id: data.id,
		errors: data.errors,
		changes:
			data.changes ??
			rows.filter((row) =>
				["NEW", "UPDATE", "OVERWRITE"].includes(row.state),
			).length,
		unresolved: data.unresolved ?? 0,
		expiresAt: data.expiresAt,
		baselineRevision: data.baselineRevision ?? 0,
		rosterCommitted: !!data.rosterCommitted,
		kind: data.kind ?? "INITIAL",
		rows,
	};
}
export function ImportWizard({
	kind,
	term,
	activityId,
	activityName,
	rosterCommitted = false,
	hasActiveEvidence = true,
	points = "0",
}: {
	kind: "accounts" | "grades" | "participation";
	term?: { id: string; name: string; scheme: Scheme };
	activityId?: string;
	activityName?: string;
	rosterCommitted?: boolean;
	hasActiveEvidence?: boolean;
	points?: string;
}) {
	const router = useRouter();
	const [accountRole, setAccountRole] = useState<AccountRole>("STUDENT");
	const [file, setFile] = useState<File | null>(null);
	const [fileKey, setFileKey] = useState(0);
	const [headers, setHeaders] = useState<string[]>([]);
	const [mapping, setMapping] = useState<Record<string, number>>({});
	const [nodeId, setNodeId] = useState(
		term?.scheme.nodes.find((n) => n.kind === "GRADE")?.id || "",
	);
	const [note, setNote] = useState("");
	const [reason, setReason] = useState("");
	const [preview, setPreview] = useState<Preview | null>(null);
	const [resolutions, setResolutions] = useState<
		Record<number, DuplicateResolution>
	>({});
	const [result, setResult] = useState<ImportResult | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [sealed, setSealed] = useState(!!rosterCommitted);
	useUnsavedChanges(!!file && !result);
	const staffBatch = kind === "accounts" && accountRole !== "STUDENT";
	const fields =
		kind === "accounts"
			? staffBatch
				? ["login", "name", "collegeCode", "college"]
				: ["login", "name", "college", "major", "className"]
			: kind === "grades"
				? ["login", "name", "college", "major", "className", "value"]
				: [];
	function fieldLabel(field: string) {
		if (field === "login" && staffBatch) return "登录账号";
		return labels[field] ?? field;
	}
	const endpoint = {
		accounts: "/api/admin/account-import",
		grades: "/api/grade-import",
		participation: "/api/participation-import",
	}[kind];
	const mode: "INITIAL" | "CORRECTION" =
		kind === "participation" && (rosterCommitted || sealed)
			? "CORRECTION"
			: "INITIAL";
	const requiredParticipationHeaders = participationHeaders;
	const missingHeaders =
		kind === "participation"
			? requiredParticipationHeaders.filter(
					(header) => !headers.includes(header),
				)
			: [];
	const limits =
		kind === "participation"
			? "每批最多2000条、5MB"
			: kind === "grades"
				? "每批最多100条、1MB"
				: "每批最多100条、1MB";
	const duplicateRows =
		preview?.rows.filter((row) => row.state === "DUPLICATE") ?? [];
	const duplicateReady = duplicateRows.every((row) => {
		const resolution = resolutions[row.line];
		return (
			resolution?.action &&
			(resolution.action !== "KEEP_BOTH" ||
				resolution.reason.trim().length >= 10)
		);
	});
	const templateParams = new URLSearchParams({ kind });
	if (term?.id) templateParams.set("termId", term.id);
	if (kind === "grades" && nodeId) templateParams.set("nodeId", nodeId);
	if (kind === "accounts") templateParams.set("role", accountRole);
	if (kind === "participation" && activityId) {
		templateParams.set("activityId", activityId);
	}
	const templateHref = `/api/import-templates?${templateParams.toString()}`;
	function updateResolution(
		line: number,
		patch: Partial<DuplicateResolution>,
	) {
		setResolutions((current) => ({
			...current,
			[line]: {
				action: current[line]?.action ?? "",
				reason: current[line]?.reason ?? "",
				...patch,
			},
		}));
	}
	const previewColumns: ColumnDef<DataTableFeatures, PreviewRow>[] = [
		{ accessorKey: "line", header: "逻辑行" },
		{
			id: "student",
			header: staffBatch ? "登录账号 / 姓名" : "学号 / 姓名",
			cell: ({ row }) => (
				<div>
					<p>{row.original.login || "—"}</p>
					<p className="text-xs text-muted-foreground">
						{row.original.name || "—"}
					</p>
				</div>
			),
		},
		...(kind === "participation" ||
		kind === "grades" ||
		(kind === "accounts" && !staffBatch)
			? [
					{
						id: "organization",
						header: staffBatch ? "学院" : "学院 / 专业 / 班级",
						cell: ({ row }: { row: { original: PreviewRow } }) =>
							staffBatch ? (
								<div className="whitespace-normal">
									<p>{row.original.college || "—"}</p>
									<p className="text-xs text-muted-foreground">
										编码 {row.original.collegeCode || "—"}
									</p>
								</div>
							) : (
								<div className="whitespace-normal">
									<p>{row.original.college}</p>
									<p className="text-xs text-muted-foreground">
										{row.original.major} / {row.original.className}
									</p>
								</div>
							),
					},
				]
			: []),
		...(kind === "grades"
			? [
					{
						id: "score",
						header: "得分",
						cell: ({ row }: { row: { original: PreviewRow } }) => (
							<span className="whitespace-nowrap tabular-nums">
								{row.original.before ?? "未录"} →{" "}
								{row.original.score ?? "—"}
							</span>
						),
					},
				]
			: []),
		{
			id: "state",
			header: "状态",
			cell: ({ row }) => (
				<Badge variant="outline">
					{states[row.original.state] || row.original.state}
				</Badge>
			),
		},
		{
			accessorKey: "message",
			header: "说明",
			cell: ({ row }) => (
				<span className="block max-w-80 whitespace-normal break-words">
					{row.original.message}
				</span>
			),
		},
	];
	async function send(action: string) {
		const form = new FormData();
		form.set("action", action);
		if (term) form.set("termId", term.id);
		if (file) form.set("file", file);
		if (preview) form.set("id", preview.id);
		if (kind === "grades") {
			form.set("nodeId", nodeId);
			form.set("reason", reason);
			form.set("mapping", JSON.stringify(mapping));
		}
		if (kind === "accounts") {
			form.set("role", accountRole);
			form.set("mapping", JSON.stringify(mapping));
			form.set("note", note);
			form.set(
				"resolutions",
				JSON.stringify(
					Object.entries(resolutions)
						.filter(([, resolution]) => resolution.action)
						.map(([line, resolution]) => ({
							line: Number(line),
							action: resolution.action,
							...(resolution.reason.trim()
								? { reason: resolution.reason.trim() }
								: {}),
						})),
				),
			);
		}
		if (kind === "participation") {
			form.set("activityId", activityId!);
			form.set("kind", mode);
			form.set("note", note);
			form.set("reason", reason);
		}
		const response = await fetch(endpoint, { method: "POST", body: form });
		const data = await response.json();
		if (!response.ok) throw new Error(data.error || "导入请求失败");
		return data;
	}
	async function run(action: "columns" | "preview" | "commit") {
		if (busy) return;
		if (
			action === "preview" &&
			kind === "participation" &&
			missingHeaders.length
		) {
			setError(`名单表头缺少：${missingHeaders.join("、")}`);
			return;
		}
		setBusy(true);
		setError("");
		try {
			const data = await send(action);
			if (action === "columns") {
				setHeaders(data.headers);
				setMapping(
					Object.fromEntries(
						fields.map((field, i) => [
							field,
							Math.min(i, data.headers.length - 1),
						]),
					),
				);
				setPreview(null);
			} else if (action === "preview")
				{ setPreview(normalizePreview(kind, data as RawPreview)); setResolutions({}); }
			else {
				setResult(data);
				if (kind === "participation" && data.kind === "INITIAL")
					setSealed(true);
				setPreview(null);
			}
		} catch (err) {
			setError((err as Error).message);
			if (action === "commit") setPreview(null);
		} finally {
			setBusy(false);
		}
	}
	function clearDraft() {
		setFile(null);
		setFileKey((key) => key + 1);
		setHeaders([]);
		setMapping({});
		setPreview(null);
		setResolutions({});
		setError("");
	}
	function reset() {
		setResult(null);
		setNote("");
		setReason("");
		clearDraft();
		router.refresh();
	}
	function changeAccountRole(next: AccountRole) {
		if (next === accountRole) return;
		if (
			(file || preview || result) &&
			!window.confirm("切换导入角色会清空当前文件、预览和结果，是否继续？")
		)
			return;
		setAccountRole(next);
		setResult(null);
		setNote("");
		clearDraft();
	}
	return (
		<>
			<div className="flex flex-wrap gap-2">
				{["上传文件", "核对表格列", "核对内容", "导入结果"].map((label, i) => (
					<Badge
						key={label}
						variant={
							i === (result ? 3 : preview ? 2 : headers.length ? 1 : 0)
								? "default"
								: "outline"
						}
					>
						{i + 1}. {label}
					</Badge>
				))}
			</div>
			<Feedback error={error} />
			{!result && (
				<div className="grid items-start gap-5 xl:grid-cols-2">
					<Card>
						<CardHeader>
							<CardTitle>模板与来源</CardTitle>
							<CardDescription>
								{term?.name ? `${term.name} · ` : ""}
								{activityName ? `${activityName} · ` : ""}
								{kind === "accounts"
									? staffBatch
										? `支持 CSV 或 XLSX，${limits}。登录账号列须为文本；学院编码与学院名称须匹配同一所已启用学院。CSV 请使用 UTF-8。`
										: `支持 CSV 或 XLSX，${limits}。学号列须为文本，保留前导零；学院、专业、班级须匹配已启用班级。CSV 请使用 UTF-8。`
									: `支持 CSV 或 XLSX，${limits}。学号列须为文本，保留前导零；CSV 请使用 UTF-8。`}
								{kind === "participation" &&
									" 名单只读取模板中的中文表头，整批检查学号、班级、辅导员和活动范围，有任一错误则整批不写入。"}
							</CardDescription>
							<CardAction>
								<a
									href={templateHref}
									className={buttonVariants({
										variant: "outline",
										size: "sm",
									})}
								>
									下载模板
								</a>
							</CardAction>
						</CardHeader>
						<CardContent>
							<FieldGroup>
								{kind === "accounts" && (
									<div className="flex flex-col gap-3 rounded-lg border p-4">
										<div>
											<p className="text-sm font-medium">本批导入角色</p>
											<p className="mt-1 text-sm text-muted-foreground">
												一份文件只导入一种角色，学生、辅导员和学院管理人员请分批导入。
											</p>
										</div>
										<ToggleGroup
											variant="outline"
											size="sm"
											value={[accountRole]}
											disabled={busy}
											onValueChange={(value) => {
												const next = value[0] as AccountRole | undefined;
												if (next) changeAccountRole(next);
											}}
										>
											<ToggleGroupItem value="STUDENT">学生</ToggleGroupItem>
											<ToggleGroupItem value="COUNSELOR">辅导员</ToggleGroupItem>
											<ToggleGroupItem value="COLLEGE">
												学院管理人员
											</ToggleGroupItem>
										</ToggleGroup>
										<FieldDescription>
											{accountRoleHints[accountRole]}
										</FieldDescription>
									</div>
								)}
								{kind === "participation" && (
									<div className="flex flex-col gap-2 rounded-lg border p-4">
										<div className="flex flex-wrap items-center gap-2">
											<Badge variant={mode === "INITIAL" ? "default" : "secondary"}>
												{mode === "INITIAL" ? "首次提交名单" : "补录"}
											</Badge>
											<span className="text-sm text-muted-foreground">
												活动分值 {points} 分 · 名单不含个人得分列
											</span>
										</div>
										<p className="text-sm text-muted-foreground">
											{mode === "INITIAL"
												? "首次名单保存后，普通导入关闭；以后漏报或错报只能补录。"
												: "补录只能新增或更正，不能删除；移出名单请到参与名单页逐条填写原因。"}
										</p>
										{!hasActiveEvidence && (
											<div className="rounded-lg border border-dashed p-3">
												<p className="text-sm font-medium">
													尚未上传活动证明
												</p>
												<p className="mt-1 text-sm text-muted-foreground">
													请先在活动详情上传证明，再提交名单。
												</p>
												<Link
													href={`/activities/${activityId}?termId=${term?.id || ""}&tab=evidence`}
													className="mt-2 inline-block text-sm underline underline-offset-4"
												>
													前往活动证明
												</Link>
											</div>
										)}
									</div>
								)}
								<Field>
									<FieldLabel htmlFor="import-file">选择名单文件</FieldLabel>
									<Input
										key={fileKey}
										id="import-file"
										type="file"
										accept=".csv,.xlsx"
										disabled={busy}
										onChange={(e) => {
											setFile(e.target.files?.[0] || null);
											setHeaders([]);
											setPreview(null);
											setResolutions({});
										}}
									/>
									<FieldDescription>
										第一行是表头；预览显示的是从表头计起的逻辑行号。选择文件后即可读取表头。
									</FieldDescription>
								</Field>
								<Button
									className="self-start"
									disabled={busy || !file}
									onClick={() => void run("columns")}
								>
									{busy ? "正在处理…" : "读取文件列"}
								</Button>
								{headers.length > 0 && kind === "participation" && (
									<div className="flex flex-col gap-2 rounded-lg border p-4">
										<p className="text-sm font-medium">表头校验</p>
										<div className="flex flex-wrap gap-2">
											{requiredParticipationHeaders.map((header) => (
												<Badge
													key={header}
													variant={
														headers.includes(header) ? "outline" : "destructive"
													}
												>
													{header}
												</Badge>
											))}
										</div>
										{missingHeaders.length ? (
											<p className="text-sm text-destructive">
												缺少必需表头：{missingHeaders.join("、")}。请使用下载的模板重新填写。
											</p>
										) : (
											<p className="text-sm text-muted-foreground">
												表头完整。系统将逐人核对学号、姓名、学院、专业、班级、班级责任辅导员和活动范围。
											</p>
										)}
									</div>
								)}
								{headers.length > 0 && kind !== "participation" && (
									<>
										<div className="grid gap-5 sm:grid-cols-2">
											{fields.map((field) => (
												<Field key={field}>
													<FieldLabel htmlFor={`map-${field}`}>
														{fieldLabel(field)}对应列
													</FieldLabel>
													<NativeSelect
														id={`map-${field}`}
														value={mapping[field]}
														disabled={busy}
														onChange={(e) => {
															setMapping({
																...mapping,
																[field]: Number(e.target.value),
															});
															setPreview(null);
														}}
													>
														{headers.map((header, i) => (
															<NativeSelectOption key={i} value={i}>
																第{i + 1}列 · {header}
															</NativeSelectOption>
														))}
													</NativeSelect>
												</Field>
											))}
										</div>
										{kind === "grades" && (
											<Field>
												<FieldLabel htmlFor="import-node">成绩模块</FieldLabel>
												<SearchableSelect
													id="import-node"
													value={nodeId}
													disabled={busy}
													onValueChange={(value) => {
														setNodeId(value);
														setPreview(null);
													}}
													placeholder="请选择成绩模块"
													searchPlaceholder="搜索成绩模块"
													options={(term?.scheme.nodes ?? [])
														.filter((n) => n.kind === "GRADE")
														.map((n) => ({
															value: n.id,
															label: n.name,
														}))}
												/>
											</Field>
										)}
										{kind === "grades" && (
											<Field>
												<FieldLabel htmlFor="import-reason">
													录入或更正原因
												</FieldLabel>
												<Input
													id="import-reason"
													value={reason}
													disabled={busy}
													maxLength={1000}
													onChange={(e) => {
														setReason(e.target.value);
														setPreview(null);
													}}
												/>
											</Field>
										)}
										{kind === "accounts" && (
											<Field>
												<FieldLabel htmlFor="account-import-note">
													本批说明
												</FieldLabel>
												<Input
													id="account-import-note"
													value={note}
													disabled={busy}
													maxLength={500}
													onChange={(e) => {
														setNote(e.target.value);
														setPreview(null);
													}}
													placeholder={
														staffBatch
															? "说明本批辅导员或学院管理人员来源、名单依据或核对情况"
															: "说明本批学生来源、名单依据或核对情况"
													}
												/>
												<FieldDescription>
													说明随批次和审计记录保留，至少填写2个字。
												</FieldDescription>
											</Field>
										)}
									</>
								)}
								{kind === "participation" && headers.length > 0 && (
									<>
										<Field>
											<FieldLabel htmlFor="participation-note">
												名单说明
											</FieldLabel>
											<Input
												id="participation-note"
												value={note}
												disabled={busy}
												maxLength={2000}
												onChange={(e) => {
													setNote(e.target.value);
													setPreview(null);
												}}
												placeholder="说明名单来源、活动场次或签到依据"
											/>
											<FieldDescription>
												说明会随每条参与记录保留，供辅导员和学院核对。
											</FieldDescription>
										</Field>
										{mode === "CORRECTION" && (
											<Field>
												<FieldLabel htmlFor="participation-reason">
													补录原因
												</FieldLabel>
												<Input
													id="participation-reason"
													value={reason}
													disabled={busy}
													maxLength={1000}
													onChange={(e) => {
														setReason(e.target.value);
														setPreview(null);
													}}
													placeholder="说明漏报、错报或更正原因"
												/>
												<FieldDescription>
													补录只能新增漏报学生，不能删除或修改个人得分；活动按此分值计分。
												</FieldDescription>
											</Field>
										)}
									</>
								)}
								<Button
									className="self-start"
									disabled={
										busy ||
										(kind === "grades" && reason.trim().length < 2) ||
										(kind === "grades" && !nodeId) ||
										(kind === "accounts" && note.trim().length < 2) ||
										(kind === "participation" &&
											(note.trim().length < 2 ||
												(mode === "CORRECTION" && reason.trim().length < 2) ||
												missingHeaders.length > 0 ||
												!hasActiveEvidence))
									}
									onClick={() => void run("preview")}
								>
									检查文件
								</Button>
							</FieldGroup>
						</CardContent>
					</Card>
					{preview ? (
						<Card>
							<CardHeader>
								<CardTitle>核对导入内容</CardTitle>
								<CardDescription>
									共 {preview.rows.length} 条记录，{preview.changes} 条新增或更新，
									{preview.errors} 条错误
									{preview.unresolved > 0
										? `，${preview.unresolved} 条待确认重复`
										: ""}
									。预览有效至 {dateText(preview.expiresAt)}；有错误时整批不写入。
								</CardDescription>
							</CardHeader>
							<CardContent className="flex flex-col gap-5">
								{kind === "participation" && (
									<div className="flex flex-col gap-1 rounded-lg border p-3 text-sm">
										<p className="font-medium">
											{preview.kind === "INITIAL"
												? "首次名单：保存后关闭普通导入"
												: "补录：只能新增或更正"}
										</p>
										<p className="text-muted-foreground">
											名单版本 {preview.baselineRevision}。
											{preview.kind === "CORRECTION" &&
												" 要移出名单，请到参与名单页逐条填写原因。"}
										</p>
									</div>
								)}
								{preview.errors > 0 && (
									<p className="text-sm text-destructive">
										存在 {preview.errors} 条错误，本批次不会写入任何一行。每条错误标明逻辑行号与原因；修正对应单元格后重新检查。
									</p>
								)}
								{duplicateRows.length > 0 && (
									<div className="flex flex-col gap-3 rounded-lg border border-dashed p-4">
										<div>
											<p className="text-sm font-medium">
												{staffBatch ? "同学院同名待确认" : "同班同名待确认"}
											</p>
											<p className="mt-1 text-sm text-muted-foreground">
												{staffBatch
													? "同一学院已有同名同角色的账号。请逐行核对：确为不同人员时保留双方并填写理由，否则跳过或沿用现有账号。确认理由会保留在审计记录中。"
													: "默认禁止同班同名、学号不同的账号同时进入系统。请逐行核对：确为不同学生时保留双方并填写理由，否则跳过或沿用现有账号。确认理由会永久保留在审计记录中。"}
											</p>
										</div>
										{duplicateRows.map((row) => {
											const resolution = resolutions[row.line];
											const likely = row.duplicateCandidates?.some(
												(candidate) => candidate.likely,
											);
											return (
												<div
													key={row.line}
													className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-4"
												>
													<div className="flex flex-wrap items-start justify-between gap-2">
														<div className="min-w-0">
															<p className="text-sm font-medium">
																第{row.line}行 · {row.login || "—"} ·{" "}
																{row.name || "—"}
															</p>
															<p className="mt-1 text-sm text-muted-foreground">
																{row.message}
															</p>
														</div>
														<Badge
															variant={
																likely ? "destructive" : "outline"
															}
														>
															{likely
																? "登录账号仅差一位"
																: staffBatch
																	? "同学院同名"
																	: "同班同名"}
														</Badge>
													</div>
													{row.fileDuplicateOf ? (
														<p className="text-xs text-muted-foreground">
															同时与文件内第{row.fileDuplicateOf}行
															{staffBatch
																? "同学院同名但登录账号不同。"
																: "同班同名但学号不同。"}
														</p>
													) : null}
													{row.duplicateCandidates?.length ? (
														<ul className="flex flex-col gap-1 text-xs text-muted-foreground">
															{row.duplicateCandidates.map(
																(candidate) => (
																	<li key={candidate.userId}>
																		已有账号：{candidate.login} ·{" "}
																		{candidate.name} ·{" "}
																		{candidate.disabled
																			? "已停用"
																			: "启用中"}
																		{candidate.likely
																			? " · 学号仅差一位"
																			: ""}
																	</li>
																),
															)}
														</ul>
													) : null}
													<div className="grid gap-3 sm:grid-cols-2">
														<Field>
															<FieldLabel
																htmlFor={`duplicate-action-${row.line}`}
															>
																处理方式
															</FieldLabel>
															<NativeSelect
																id={`duplicate-action-${row.line}`}
																value={resolution?.action ?? ""}
																disabled={busy}
																onChange={(e) =>
																	updateResolution(row.line, {
																		action: e.target
																			.value as DuplicateResolution["action"],
																	})
																}
															>
																<NativeSelectOption value="">
																	请选择处理方式
																</NativeSelectOption>
																<NativeSelectOption value="KEEP_BOTH">
																	{staffBatch
																		? "保留双方（确认不同人员）"
																		: "保留双方（确认不同学生）"}
																</NativeSelectOption>
																<NativeSelectOption value="SKIP">
																	跳过本行（不建立账号）
																</NativeSelectOption>
																<NativeSelectOption value="USE_EXISTING">
																	沿用现有账号（不建立账号）
																</NativeSelectOption>
															</NativeSelect>
														</Field>
														{resolution?.action === "KEEP_BOTH" && (
															<Field>
																<FieldLabel
																	htmlFor={`duplicate-reason-${row.line}`}
																>
																	核对理由
																</FieldLabel>
																<Input
																	id={`duplicate-reason-${row.line}`}
																	value={resolution.reason}
																	disabled={busy}
																	maxLength={500}
																	onChange={(e) =>
																		updateResolution(row.line, {
																			reason: e.target.value,
																		})
																	}
																	placeholder={
																		staffBatch
																			? "如：两名辅导员同名，工号分别由学院核对"
																			: "如：两名学生同名，学号分别由辅导员核对"
																	}
																/>
																<FieldDescription>
																	至少10个字，说明如何确认不是同一人。
																</FieldDescription>
															</Field>
														)}
													</div>
												</div>
											);
										})}
									</div>
								)}
								<RecordList
									data={preview.rows}
									columns={previewColumns}
									searchText={(row) =>
										`${row.login} ${row.name} ${row.college} ${row.collegeCode} ${row.major} ${row.className} ${row.message}`
									}
									searchPlaceholder={
										staffBatch
											? "按登录账号、姓名或说明搜索"
											: "按学号、姓名或说明搜索"
									}
									tabs={[
										{
											value: "all",
											label: `全部 ${preview.rows.length}`,
											match: () => true,
										},
										{
											value: "changed",
											label: `有变更 ${preview.changes}`,
											match: (row) =>
												["NEW", "UPDATE", "OVERWRITE"].includes(
													row.state,
												),
										},
										{
											value: "errors",
											label: `错误 ${preview.errors}`,
											match: (row) => row.state === "ERROR",
										},
										...(preview.unresolved > 0
											? [
													{
														value: "duplicates",
														label: `待确认重复 ${preview.unresolved}`,
														match: (row: PreviewRow) =>
															row.state === "DUPLICATE",
													},
												]
											: []),
									]}
									emptyTitle="没有匹配的记录"
									emptyDescription="请调整搜索，或切换全部、有变更与错误。"
									tableClassName="max-h-[28rem]"
									mobile={(row) => (
										<div className="flex flex-col gap-2">
											<div className="flex justify-between gap-2">
												<span className="text-sm">
													逻辑行 {row.line} · {row.login || "—"}
												</span>
												<Badge variant="outline">
													{states[row.state] || row.state}
												</Badge>
											</div>
											<p className="text-sm">{row.name || "—"}</p>
											{kind === "participation" && (
												<p className="text-xs text-muted-foreground">
													{row.college} / {row.major} / {row.className}
												</p>
											)}
											{kind === "accounts" && !staffBatch && (
												<p className="text-xs text-muted-foreground">
													{row.college} / {row.major} / {row.className}
												</p>
											)}
											{staffBatch && (
												<p className="text-xs text-muted-foreground">
													{row.college} · 编码 {row.collegeCode || "—"}
												</p>
											)}
											{(kind === "participation" || kind === "grades") && (
												<p className="text-xs text-muted-foreground tabular-nums">
													得分 {row.before ?? "未录"} → {row.score ?? "—"}
												</p>
											)}
											<p className="text-sm text-muted-foreground">
												{row.message}
											</p>
										</div>
									)}
								/>
								<Button
									className="self-start"
									disabled={
										busy ||
										preview.errors > 0 ||
										(duplicateRows.length > 0 && !duplicateReady)
									}
									onClick={() => void run("commit")}
								>
									{busy ? "正在提交…" : "确认导入"}
								</Button>
							</CardContent>
						</Card>
					) : (
						<Card>
							<CardHeader>
								<CardTitle>导入预览</CardTitle>
								<CardDescription>
									{kind === "accounts"
										? "读取文件并核对表格列后，会列出新增、沿用、待确认重复和错误。"
										: "读取文件并核对表格列后，会列出新增、沿用、更新和错误。"}
								</CardDescription>
							</CardHeader>
							<CardContent>
								<p className="text-sm text-muted-foreground">
									{kind === "grades"
										? "有错误时整批不写入。确认前请核对全部内容；辅导员导入的成绩会先提交学院审核，学院通过后才替换有效成绩。"
										: kind === "participation"
											? "有错误时整批不写入。确认后名单进入辅导员审核，学院通过后才计分。"
											: "有错误时整批不写入。确认后创建账号并显示初始密码；待确认重复需逐条选择处理方式。"}
								</p>
							</CardContent>
						</Card>
					)}
				</div>
			)}
			{result && (
				<Card>
					<CardHeader>
						<CardTitle>导入已完成</CardTitle>
						<CardDescription>
							{result.submittedForReview
								? `已提交学院审核 ${result.submitted ?? 0} 条，跳过 ${result.skipped} 条；学院通过前有效成绩保持不变。`
								: result.submitted !== undefined
									? `提交 ${result.submitted} 条，更正 ${result.updated ?? 0} 条，无变化 ${result.unchanged ?? 0} 条，跳过 ${result.skipped} 条。`
									: kind === "accounts"
										? `创建${accountRoleLabels[result.targetRole ?? accountRole]}账号 ${result.created ?? 0} 个，跳过 ${result.skipped} 条。`
										: `写入 ${result.created ?? result.written ?? 0} 条，跳过 ${result.skipped} 条。`}
							{result.kind === "INITIAL" &&
								" 该活动首次名单已保存，后续漏报或错报请使用补录。"}
							{result.rosterRevision !== undefined &&
								` 当前名单版本 ${result.rosterRevision}。`}
							{result.replay
								? "这是已提交批次的重放结果，没有重复写入。"
								: ""}
						</CardDescription>
					</CardHeader>
					<CardContent className="flex flex-col gap-4">
						{!!result.credentials?.length && (
							<>
								<p className="text-sm">
									初始密码仅显示本次，请通过安全渠道交付；刷新后无法再次查看。
								</p>
								<div className="max-h-96 overflow-auto">
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>
													{(result.targetRole ?? accountRole) === "STUDENT"
														? "学号"
														: "登录账号"}
												</TableHead>
												<TableHead>初始密码</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{result.credentials.map((credential) => (
												<TableRow key={credential.login}>
													<TableCell>{credential.login}</TableCell>
													<TableCell className="font-mono">
														{credential.initialPassword}
													</TableCell>
												</TableRow>
											))}
										</TableBody>
									</Table>
								</div>
							</>
						)}
						{(result.targetRole ?? accountRole) === "COUNSELOR" &&
							(result.created ?? 0) > 0 && (
								<div className="flex flex-col gap-2 rounded-lg border border-dashed p-4">
									<p className="text-sm font-medium">辅导员还没有负责班级</p>
									<p className="text-sm text-muted-foreground">
										账号已创建并绑定学院。请到学院与班级目录，为需要该辅导员负责的班级设置责任辅导员；分配前，该辅导员看不到班级学生。
									</p>
									<Link
										href="/organizations"
										className={buttonVariants({
											variant: "outline",
											size: "sm",
											className: "self-start",
										})}
									>
										前往学院与班级
									</Link>
								</div>
							)}
						{kind === "participation" && term?.id && activityId && (
							<div className="flex flex-wrap gap-2">
								<Link
									href={`/activities/${activityId}?termId=${term.id}&tab=participants`}
									className={buttonVariants({ variant: "outline", size: "sm" })}
								>
									查看参与名单
								</Link>
								<Link
									href={`/recognitions?termId=${term.id}&status=PENDING`}
									className={buttonVariants({ variant: "outline", size: "sm" })}
								>
									查看待审记录
								</Link>
							</div>
						)}
						<Button
							variant="outline"
							className="self-start"
							onClick={reset}
						>
							{kind === "participation" ? "继续补录或更正" : "继续导入"}
						</Button>
					</CardContent>
				</Card>
			)}
		</>
	);
}
