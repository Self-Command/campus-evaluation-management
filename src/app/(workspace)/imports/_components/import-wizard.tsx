"use client";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUnsavedChanges } from "@/components/dashboard/use-unsaved-changes";
import { dateText } from "@/lib/business-labels";
import { useState } from "react";
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
import {
	Table,
	TableHeader,
	TableHead,
	TableRow,
	TableBody,
	TableCell,
} from "@/components/ui/table";
import { Feedback } from "@/components/dashboard/feedback";
import { EvidenceUpload } from "@/components/dashboard/evidence-upload";
import type { Scheme } from "@/lib/scoring/types";
type Preview = {
	id: string;
	errors: number;
	expiresAt: string;
	rows: {
		line: number;
		login?: string;
		name?: string;
		data?: { login: string; name: string };
		state: string;
		message: string;
		before?: string | null;
		value?: string;
	}[];
};
type ImportResult = {
	created?: number;
	written?: number;
	submitted?: number;
	skipped: number;
	replay: boolean;
	credentials?: { login: string; initialPassword: string }[];
};
const labels: Record<string, string> = {
	login: "学号",
	name: "姓名",
	college: "学院",
	major: "专业",
	className: "班级",
	value: "成绩",
};
const states: Record<string, string> = {
	NEW: "新增",
	EXISTING: "补充来源",
	SKIP: "跳过",
	SAME: "相同",
	OVERWRITE: "覆盖",
	ERROR: "错误",
};
export function ImportWizard({
	kind,
	term,
	activityId,
}: {
	kind: "accounts" | "grades" | "participation";
	term?: { id: string; name: string; scheme: Scheme };
	activityId?: string;
}) {
	const [file, setFile] = useState<File | null>(null);
	const [headers, setHeaders] = useState<string[]>([]);
	const [mapping, setMapping] = useState<Record<string, number>>({});
	const [nodeId, setNodeId] = useState(
		term?.scheme.nodes.find((n) => n.kind === "GRADE")?.id || "",
	);
	const [reason, setReason] = useState("");
	const [ids, setIds] = useState<string[]>([]);
	const [uploading, setUploading] = useState(false);
	const [preview, setPreview] = useState<Preview | null>(null);
	const [result, setResult] = useState<ImportResult | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	useUnsavedChanges(!!file && !result);
	const fields =
		kind === "accounts"
			? ["login", "name", "college", "major", "className"]
			: kind === "grades"
				? ["login", "value"]
				: ["login"];
	const endpoint = {
		accounts: "/api/admin/account-import",
		grades: "/api/grade-import",
		participation: "/api/participation-import",
	}[kind];
	async function send(action: string) {
		const form = new FormData();
		form.set("action", action);
		if (term) form.set("termId", term.id);
		if (activityId) form.set("activityId", activityId);
		if (file) form.set("file", file);
		if (preview) form.set("id", preview.id);
		form.set("nodeId", nodeId);
		form.set("reason", reason);
		form.set("note", reason);
		form.set("evidenceIds", JSON.stringify(ids));
		form.set("mapping", JSON.stringify(mapping));
		form.set("column", String(mapping.login ?? 0));
		form.set("valueColumn", String(mapping.value ?? 1));
		const res = await fetch(endpoint, { method: "POST", body: form });
		const data = await res.json();
		if (!res.ok) throw new Error(data.error || "导入请求失败");
		return data;
	}
	async function run(action: "columns" | "preview" | "commit") {
		if (busy) return;
		setBusy(true);
		setError("");
		try {
			const data = await send(action);
			if (action === "columns") {
				setHeaders(data.headers);
				setMapping(
					Object.fromEntries(
						fields.map((f, i) => [f, Math.min(i, data.headers.length - 1)]),
					),
				);
				setPreview(null);
			} else if (action === "preview") setPreview(data);
			else {
				setResult(data);
				setPreview(null);
			}
		} catch (err) {
			setError((err as Error).message);
			if (action === "commit") setPreview(null);
		} finally {
			setBusy(false);
		}
	}
	return (
		<>
			<div className="flex flex-wrap gap-2">
				{["上传文件", "映射与预检", "核对差异", "导入结果"].map((label, i) => (
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
								支持CSV或XLSX，每批最多100条。学号列须为文本，保留前导零；CSV请使用UTF-8。
								{kind === "participation" &&
									"参与名单按追加处理，遗漏行不会删除已登记学生；登记后本人立即可见，审核通过才计分。"}
							</CardDescription>
							<CardAction>
								<a
									href={`/api/import-templates?kind=${kind}`}
									className={buttonVariants({ variant: "outline", size: "sm" })}
								>
									下载模板 v1
								</a>
							</CardAction>
						</CardHeader>
						<CardContent>
							<Tabs value="source">
								<TabsList className="mb-4 w-full">
									<TabsTrigger value="source">文件与字段</TabsTrigger>
								</TabsList>
							</Tabs>
							<FieldGroup>
								<Field>
									<FieldLabel htmlFor="import-file">选择名单文件</FieldLabel>
									<Input
										id="import-file"
										type="file"
										accept=".csv,.xlsx"
										disabled={busy}
										onChange={(e) => {
											setFile(e.target.files?.[0] || null);
											setHeaders([]);
											setPreview(null);
										}}
									/>
									<FieldDescription>
										第一行是表头；预览显示的是从表头计起的逻辑行号。
									</FieldDescription>
								</Field>
								<Button
									className="self-start"
									disabled={busy || !file}
									onClick={() => void run("columns")}
								>
									{busy ? "正在处理…" : "读取文件列"}
								</Button>
								{headers.length > 0 && (
									<>
										<div className="grid gap-5 sm:grid-cols-2">
											{fields.map((field) => (
												<Field key={field}>
													<FieldLabel htmlFor={`map-${field}`}>
														{labels[field]}对应列
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
												<FieldLabel htmlFor="import-node">
													成绩目标模块
												</FieldLabel>
												<NativeSelect
													id="import-node"
													value={nodeId}
													disabled={busy}
													onChange={(e) => {
														setNodeId(e.target.value);
														setPreview(null);
													}}
												>
													{term?.scheme.nodes
														.filter((n) => n.kind === "GRADE")
														.map((n) => (
															<NativeSelectOption key={n.id} value={n.id}>
																{n.name}
															</NativeSelectOption>
														))}
												</NativeSelect>
											</Field>
										)}
										{kind !== "accounts" && (
											<Field>
												<FieldLabel htmlFor="import-reason">
													{kind === "participation"
														? "参与认定说明"
														: "成绩录入理由"}
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
										{kind === "participation" && (
											<EvidenceUpload
												onChange={(value) => {
													setIds(value);
													setPreview(null);
												}}
												onBusy={setUploading}
											/>
										)}
										<Button
											className="self-start"
											disabled={
												busy ||
												uploading ||
												(kind !== "accounts" && reason.trim().length < 2) ||
												(kind === "participation" && !ids.length) ||
												(kind === "grades" && !nodeId)
											}
											onClick={() => void run("preview")}
										>
											生成预检差异
										</Button>
									</>
								)}
							</FieldGroup>
						</CardContent>
					</Card>
					{preview ? (
						<Card>
							<CardHeader>
								<CardTitle>核对整批差异</CardTitle>
								<CardDescription>
									{preview.rows.length} 条记录，{preview.errors}{" "}
									条错误。预览有效至 {dateText(preview.expiresAt)}
									；有错误时整批不写入。
								</CardDescription>
							</CardHeader>
							<CardContent className="flex flex-col gap-5">
								<div className="flex max-h-96 flex-col divide-y overflow-auto md:hidden">
									{preview.rows.map((row) => (
										<div key={row.line} className="flex flex-col gap-2 py-3">
											<div className="flex justify-between gap-2">
												<span className="text-sm">
													逻辑行 {row.line} · {row.login || row.data?.login}
												</span>
												<Badge variant="outline">
													{states[row.state] || row.state}
												</Badge>
											</div>
											<p className="text-sm">{row.name || row.data?.name}</p>
											<p className="text-sm text-muted-foreground">
												{row.message}
											</p>
											{row.value !== undefined && (
												<p className="text-sm tabular-nums">
													{row.before ?? "未录入"} → {row.value}
												</p>
											)}
										</div>
									))}
								</div>
								<div className="hidden max-h-96 overflow-auto md:block">
									<Table>
										<TableHeader>
											<TableRow>
												{["逻辑行", "学号 / 姓名", "状态", "差异说明"].map(
													(h) => (
														<TableHead key={h}>{h}</TableHead>
													),
												)}
											</TableRow>
										</TableHeader>
										<TableBody>
											{preview.rows.map((row) => (
												<TableRow key={row.line}>
													<TableCell>{row.line}</TableCell>
													<TableCell>
														{row.login || row.data?.login}
														<br />
														{row.name || row.data?.name}
													</TableCell>
													<TableCell>
														<Badge variant="outline">
															{states[row.state] || row.state}
														</Badge>
													</TableCell>
													<TableCell className="whitespace-normal">
														{row.message}
														{row.value !== undefined && (
															<p className="text-xs text-muted-foreground">
																{row.before ?? "未录入"} → {row.value}
															</p>
														)}
													</TableCell>
												</TableRow>
											))}
										</TableBody>
									</Table>
								</div>
								<Button
									className="self-start"
									disabled={busy || preview.errors > 0 || uploading}
									onClick={() => void run("commit")}
								>
									{busy ? "正在提交…" : "确认整批导入"}
								</Button>
							</CardContent>
						</Card>
					) : (
						<Card>
							<CardHeader>
								<CardTitle>整批差异</CardTitle>
								<CardDescription>
									读取文件并完成列映射后，生成真实的新增、跳过、覆盖和错误清单。
								</CardDescription>
							</CardHeader>
							<CardContent>
								<p className="text-sm text-muted-foreground">
									有错误时整批不写入。确认前请核对全部差异；成绩覆盖会保留更正记录。
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
							写入 {result.created ?? result.written ?? result.submitted ?? 0}{" "}
							条，跳过 {result.skipped} 条。
							{result.replay ? "这是已提交批次的重放结果，没有重复写入。" : ""}
						</CardDescription>
					</CardHeader>
					<CardContent className="flex flex-col gap-4">
						{!!result.credentials?.length && (
							<>
								<p className="text-sm">
									初始密码仅显示本次，请通过安全渠道交付；刷新后无法再次查看。
								</p>
								<div className="overflow-auto">
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>学号</TableHead>
												<TableHead>初始密码</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{result.credentials.map((c) => (
												<TableRow key={c.login}>
													<TableCell>{c.login}</TableCell>
													<TableCell className="font-mono">
														{c.initialPassword}
													</TableCell>
												</TableRow>
											))}
										</TableBody>
									</Table>
								</div>
							</>
						)}
						<Button
							variant="outline"
							className="self-start"
							onClick={() => {
								setResult(null);
								setFile(null);
								setHeaders([]);
								setIds([]);
								setReason("");
								setPreview(null);
							}}
						>
							继续导入
						</Button>
					</CardContent>
				</Card>
			)}
		</>
	);
}
