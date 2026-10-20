"use client";
// invoice.tsx + invoice-form.tsx + invoice-preview.tsx: same two-column editor and real impact preview.
import { type ReactNode, useState } from "react";
import { TemplateEditor } from "./template-editor";
import { useUnsavedChanges } from "./use-unsaved-changes";
import { Feedback, requestJson } from "./feedback";
import {
	Card,
	CardHeader,
	CardTitle,
	CardDescription,
	CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
	Field,
	FieldGroup,
	FieldLabel,
	FieldDescription,
} from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
	Table,
	TableHeader,
	TableHead,
	TableBody,
	TableRow,
	TableCell,
} from "@/components/ui/table";
type Preview = {
	token: string;
	revision?: number;
	affectedStudents: number;
	changes: {
		studentId: string;
		login: string;
		name: string;
		before: unknown;
		after: unknown;
	}[];
	errors: string[];
};
function resultText(value: unknown): string {
	if (value === null || value === undefined) return "不完整";
	if (typeof value !== "object") return String(value);
	const item = value as Record<string, unknown>;
	if ("total" in item)
		return item.total === null
			? `暂计 ${String(item.provisionalTotal ?? "—")}`
			: String(item.total);
	return JSON.stringify(value);
}
export function CorrectionReview({
	termId,
	revision,
	payload,
	children,
	onCommitted,
	onBusyChange,
}: {
	termId: string;
	revision: number;
	payload: Record<string, unknown>;
	children: ReactNode;
	onCommitted: () => void;
	onBusyChange?: (busy: boolean) => void;
}) {
	const signature = JSON.stringify(payload);
	const [initialSignature] = useState(signature);
	const [state, setState] = useState<{
		signature: string;
		preview: Preview;
	} | null>(null);
	const preview = state?.signature === signature ? state.preview : null;
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [reason, setReason] = useState("");
	useUnsavedChanges(
		signature !== initialSignature || reason.length > 0 || busy,
	);
	function working(value: boolean) {
		setBusy(value);
		onBusyChange?.(value);
	}
	return (
		<form
			className="flex flex-col gap-5"
			onSubmit={async (event) => {
				event.preventDefault();
				if (busy || !preview?.token || preview.errors.length) return;
				working(true);
				setError("");
				try {
					await requestJson(`/api/terms/${termId}/correction`, {
						action: "commit",
						...payload,
						token: preview.token,
						revision: preview.revision ?? revision,
						reason,
					});
					onCommitted();
				} catch (err) {
					setState(null);
					setError((err as Error).message);
				} finally {
					working(false);
				}
			}}
		>
			<Feedback error={error} />
			<TemplateEditor
				preview={
					<Card>
						<CardHeader>
							<CardTitle>更正影响预览</CardTitle>
							<CardDescription>
								旧发布和结算快照保持原记录；新输入须重新发布并核对。
							</CardDescription>
						</CardHeader>
						<CardContent className="flex flex-col gap-4">
							{preview ? (
								<>
									<p className="text-2xl tabular-nums">
										影响 {preview.affectedStudents} 位学生
									</p>
									<Feedback error={preview.errors.join(" ")} />
									<div className="hidden overflow-x-auto md:block">
										<Table>
											<TableHeader>
												<TableRow>
													<TableHead>学生</TableHead>
													<TableHead>更正前</TableHead>
													<TableHead>更正后</TableHead>
												</TableRow>
											</TableHeader>
											<TableBody>
												{preview.changes.map((item) => (
													<TableRow key={item.studentId}>
														<TableCell>
															{item.name}
															<p className="text-xs text-muted-foreground">
																{item.login}
															</p>
														</TableCell>
														<TableCell className="max-w-48 break-words whitespace-normal">
															{resultText(item.before)}
														</TableCell>
														<TableCell className="max-w-48 break-words whitespace-normal">
															{resultText(item.after)}
														</TableCell>
													</TableRow>
												))}
											</TableBody>
										</Table>
									</div>
									<div className="flex flex-col gap-3 md:hidden">
										{preview.changes.map((item) => (
											<div key={item.studentId} className="border-b pb-3">
												<p className="text-sm font-medium">
													{item.name} · {item.login}
												</p>
												<p className="break-words text-sm">
													更正前 {resultText(item.before)}
												</p>
												<p className="break-words text-sm">
													更正后 {resultText(item.after)}
												</p>
											</div>
										))}
									</div>
									{!preview.changes.length && (
										<p className="text-sm text-muted-foreground">
											本次更正没有改变学生计算结果。
										</p>
									)}
								</>
							) : (
								<p className="text-sm text-muted-foreground">
									核对更正内容后运行全量影响检查，再填写理由提交。
								</p>
							)}
						</CardContent>
					</Card>
				}
			>
				<Tabs value="correction">
					<TabsList className="w-full">
						<TabsTrigger value="correction">更正内容与理由</TabsTrigger>
					</TabsList>
				</Tabs>
				<fieldset disabled={busy} className="min-w-0">
					{children}
				</fieldset>
				<FieldGroup>
					<Field>
						<FieldLabel htmlFor="correction-reason">更正理由</FieldLabel>
						<Textarea
							id="correction-reason"
							value={reason}
							onChange={(event) => setReason(event.target.value)}
							minLength={2}
							maxLength={1000}
							required
							rows={4}
						/>
						<FieldDescription>
							更正仅在申报与审核阶段开放；已核对或锁定周期须先填写理由重开。
						</FieldDescription>
					</Field>
				</FieldGroup>
				<Button
					type="button"
					variant="outline"
					disabled={busy}
					onClick={async () => {
						working(true);
						setError("");
						try {
							setState({
								signature,
								preview: await requestJson<Preview>(
									`/api/terms/${termId}/correction`,
									{ action: "preview", ...payload },
								),
							});
						} catch (err) {
							setState(null);
							setError((err as Error).message);
						} finally {
							working(false);
						}
					}}
				>
					{busy ? "正在核对…" : "预览全量影响"}
				</Button>
				<Button
					type="submit"
					disabled={
						busy ||
						!preview?.token ||
						!!preview.errors.length ||
						reason.trim().length < 2
					}
				>
					填写理由并提交更正
				</Button>
			</TemplateEditor>
		</form>
	);
}
