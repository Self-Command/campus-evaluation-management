"use client";
import { StudentDirectory } from "@/components/dashboard/student-directory";
import { TemplateEditor } from "@/components/dashboard/template-editor";
import { useUnsavedChanges } from "@/components/dashboard/use-unsaved-changes";
import { useState } from "react";
import Link from "next/link";
import {
	Card,
	CardHeader,
	CardTitle,
	CardDescription,
	CardContent,
	CardAction,
} from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
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
import { Feedback, requestJson } from "@/components/dashboard/feedback";
import type { Scheme } from "@/lib/scoring/types";
import { InputHistory } from "@/components/dashboard/input-history";
type Grade = { id: string; nodeId: string; value: string; revision: number };
type Deduction = {
	id: string;
	projectId: string;
	amount: string;
	reason: string;
	revoked: boolean;
	revision: number;
};
export type GradeManagerInitial = {
	student: { login: string; name: string };
	grades: Grade[];
	deductions: Deduction[];
};
export function GradeManager({
	term,
	mode = "grades",
	readOnly = false,
	initialData,
	initialError = "",
}: {
	term: { id: string; scheme: Scheme };
	mode?: "grades" | "deductions";
	readOnly?: boolean;
	initialData?: GradeManagerInitial;
	initialError?: string;
}) {
	const [choosing, setChoosing] = useState(false);
	const [dirty, setDirty] = useState(false);
	useUnsavedChanges(dirty);
	const [student, setStudent] = useState<{
		login: string;
		name: string;
	} | null>(initialData?.student || null);
	const [grades, setGrades] = useState<Grade[]>(initialData?.grades || []);
	const [deductions, setDeductions] = useState<Deduction[]>(
		initialData?.deductions || [],
	);
	const [node, setNode] = useState(
		term.scheme.nodes.find((n) => n.kind === "GRADE")?.id || "",
	);
	const [project, setProject] = useState(term.scheme.deductions[0]?.id || "");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState(initialError);
	const [success, setSuccess] = useState("");
	async function load(login: string) {
		const [g, d] = await Promise.all([
			requestJson<{
				student: { login: string; name: string };
				inputs: Grade[];
			}>(
				`/api/grades?termId=${term.id}&studentLogin=${encodeURIComponent(login)}`,
			),
			requestJson<{ records: Deduction[] }>(
				`/api/deductions?termId=${term.id}&studentLogin=${encodeURIComponent(login)}`,
			),
		]);
		setDirty(false);
		setStudent(g.student);
		setGrades(g.inputs);
		setDeductions(d.records);
	}
	const grade = grades.find((g) => g.nodeId === node);
	const deduction = deductions.find((d) => d.projectId === project);
	return (
		<>
			<div hidden={Boolean(student) && !choosing}>
				<StudentDirectory
					key={term.id}
					termId={term.id}
					busy={busy}
					title={mode === "grades" ? "学生成绩名录" : "学生扣分名录"}
					selectLabel={mode === "grades" ? "读取成绩" : "读取扣分"}
					actions={
						mode === "grades" && !readOnly ? (
							<Link
								href={`/imports?kind=grades&termId=${term.id}`}
								className={buttonVariants({ variant: "outline", size: "sm" })}
							>
								导入成绩
							</Link>
						) : undefined
					}
					onSelect={async (login) => {
						if (
							busy ||
							(dirty &&
								!window.confirm("切换学生将放弃尚未保存的输入，是否继续？"))
						)
							return;
						setBusy(true);
						setError("");
						setSuccess("");
						try {
							await load(login);
							setChoosing(false);
							const next = new URL(window.location.href);
							next.searchParams.set("termId", term.id);
							next.searchParams.set("login", login);
							window.history.replaceState(
								null,
								"",
								next.pathname + next.search,
							);
						} catch (err) {
							setError((err as Error).message);
						} finally {
							setBusy(false);
						}
					}}
				/>
			</div>
			<Feedback error={error} success={success} />
			{student && (
				<Card>
					<CardHeader>
						<CardTitle>
							{student.name} · {student.login}
						</CardTitle>
						<CardDescription>
							{readOnly
								? "当前阶段只读；更正须先填写理由重开本周期。"
								: mode === "grades"
									? "本周期的原始成绩输入与更正，均保留理由和修订。"
									: "本周期的扣分额、生效状态与业务理由，均保留修订。"}
						</CardDescription>
						<CardAction>
							<Button
								variant="outline"
								disabled={busy}
								onClick={() => {
									if (
										dirty &&
										!window.confirm("切换学生将放弃尚未保存的输入，是否继续？")
									)
										return;
									setDirty(false);
									setChoosing(true);
								}}
							>
								切换学生
							</Button>
						</CardAction>
					</CardHeader>
					<CardContent>
						{mode === "grades" && (
							<div>
								<TemplateEditor
									preview={
										<Card>
											<CardHeader>
												<CardTitle>当前成绩</CardTitle>
												<CardDescription>
													{student.name} · {student.login}
												</CardDescription>
											</CardHeader>
											<CardContent className="flex flex-col gap-3">
												<p className="text-3xl tabular-nums">
													{grade ? grade.value : "尚未录入"}
												</p>
												{grade && (
													<InputHistory
														termId={term.id}
														kind="grade"
														id={grade.id}
													/>
												)}
												<p className="text-sm text-muted-foreground">
													{grade
														? `输入修订 ${grade.revision}，保存后覆盖当前值。`
														: "未录入与零分分别记录。"}
												</p>
												<dl className="mt-3 flex flex-col gap-3 border-t pt-4">
													{term.scheme.nodes
														.filter((item) => item.kind === "GRADE")
														.map((item) => (
															<div
																key={item.id}
																className="flex justify-between gap-4 text-sm"
															>
																<dt>{item.name}</dt>
																<dd className="tabular-nums">
																	{grades.find(
																		(input) => input.nodeId === item.id,
																	)?.value ?? "未录入"}
																</dd>
															</div>
														))}
												</dl>
											</CardContent>
										</Card>
									}
								>
									{!node ? (
										<p className="text-sm text-muted-foreground">
											本方案没有成绩输入模块。
										</p>
									) : (
										<form
											key={`grade-${node}-${grade?.revision ?? "new"}`}
											className="flex min-w-0 flex-col gap-5"
											onChange={() => {
												if (!readOnly) setDirty(true);
											}}
											onSubmit={async (e) => {
												e.preventDefault();
												if (busy || readOnly) return;
												const f = new FormData(e.currentTarget);
												setBusy(true);
												setError("");
												setSuccess("");
												try {
													await requestJson("/api/grades", {
														termId: term.id,
														studentLogin: student.login,
														nodeId: node,
														value: f.get("value"),
														reason: f.get("reason"),
														revision: grade?.revision ?? null,
													});
													await load(student.login);
													setSuccess("成绩已保存。");
												} catch (err) {
													setError((err as Error).message);
												} finally {
													setBusy(false);
												}
											}}
										>
											<FieldGroup>
												<Field>
													<FieldLabel htmlFor="grade-node">成绩模块</FieldLabel>
													<NativeSelect
														id="grade-node"
														value={node}
														onChange={(e) => {
															if (
																dirty &&
																!window.confirm(
																	"切换模块将放弃未保存输入，是否继续？",
																)
															)
																return;
															setDirty(false);
															setNode(e.target.value);
														}}
													>
														{term.scheme.nodes
															.filter((n) => n.kind === "GRADE")
															.map((n) => (
																<NativeSelectOption key={n.id} value={n.id}>
																	{n.name}
																</NativeSelectOption>
															))}
													</NativeSelect>
												</Field>
												<Field>
													<FieldLabel htmlFor="grade-value">
														原始成绩
													</FieldLabel>
													<Input
														readOnly={readOnly}
														id="grade-value"
														name="value"
														defaultValue={grade?.value}
														inputMode="decimal"
														required
													/>
													<FieldDescription>
														当前值：{grade ? grade.value : "尚未录入"}。允许范围{" "}
														{
															term.scheme.nodes.find((n) => n.id === node)
																?.minimum
														}
														～
														{
															term.scheme.nodes.find((n) => n.id === node)
																?.maximum
														}
														。
													</FieldDescription>
												</Field>
												<Field>
													<FieldLabel htmlFor="grade-reason">
														录入或更正理由
													</FieldLabel>
													<Input
														readOnly={readOnly}
														id="grade-reason"
														name="reason"
														required
														minLength={2}
														maxLength={1000}
													/>
												</Field>
											</FieldGroup>
											<Button
												type="submit"
												disabled={busy || readOnly}
												className="self-start"
											>
												保存成绩
											</Button>
										</form>
									)}
								</TemplateEditor>
							</div>
						)}
						{mode === "deductions" && (
							<div>
								<TemplateEditor
									preview={
										<Card>
											<CardHeader>
												<CardTitle>当前扣分</CardTitle>
												<CardDescription>
													{student.name} · {student.login}
												</CardDescription>
											</CardHeader>
											<CardContent className="flex flex-col gap-3">
												<p className="text-3xl tabular-nums">
													{deduction ? deduction.amount : "无记录"}
												</p>
												{deduction && (
													<InputHistory
														termId={term.id}
														kind="deduction"
														id={deduction.id}
													/>
												)}
												<p className="text-sm">
													{deduction
														? deduction.revoked
															? "已撤销"
															: "生效中"
														: "尚无该项目扣分"}
												</p>
												<p className="whitespace-pre-wrap text-sm text-muted-foreground">
													{deduction?.reason}
												</p>
												<dl className="mt-3 flex flex-col gap-3 border-t pt-4">
													{term.scheme.deductions.map((item) => {
														const record = deductions.find(
															(entry) => entry.projectId === item.id,
														);
														return (
															<div
																key={item.id}
																className="flex flex-col gap-1 text-sm"
															>
																<dt className="font-medium">{item.name}</dt>
																<dd>
																	{record
																		? `${record.amount} · ${record.revoked ? "已撤销" : "生效中"}`
																		: "无记录"}
																</dd>
																{record && (
																	<dd className="text-muted-foreground">
																		{record.reason}
																	</dd>
																)}
															</div>
														);
													})}
												</dl>
											</CardContent>
										</Card>
									}
								>
									{!project ? (
										<p className="text-sm text-muted-foreground">
											本方案没有扣分项目。
										</p>
									) : (
										<form
											key={`deduction-${project}-${deduction?.revision ?? "new"}`}
											className="flex min-w-0 flex-col gap-5"
											onChange={() => {
												if (!readOnly) setDirty(true);
											}}
											onSubmit={async (e) => {
												e.preventDefault();
												if (busy || readOnly) return;
												const f = new FormData(e.currentTarget);
												const submitter = (e.nativeEvent as SubmitEvent)
													.submitter as HTMLButtonElement;
												setBusy(true);
												setError("");
												setSuccess("");
												try {
													await requestJson("/api/deductions", {
														termId: term.id,
														studentLogin: student.login,
														projectId: project,
														amount: f.get("amount"),
														reason: f.get("reason"),
														revision: deduction?.revision ?? null,
														revoked: submitter.value === "revoke",
													});
													await load(student.login);
													setSuccess(
														submitter.value === "revoke"
															? "扣分已撤销。"
															: "扣分已保存。",
													);
												} catch (err) {
													setError((err as Error).message);
												} finally {
													setBusy(false);
												}
											}}
										>
											<FieldGroup>
												<Field>
													<FieldLabel htmlFor="deduction-project">
														扣分项目
													</FieldLabel>
													<NativeSelect
														id="deduction-project"
														value={project}
														onChange={(e) => {
															if (
																dirty &&
																!window.confirm(
																	"切换扣分项目将放弃未保存输入，是否继续？",
																)
															)
																return;
															setDirty(false);
															setProject(e.target.value);
														}}
													>
														{term.scheme.deductions.map((d) => (
															<NativeSelectOption key={d.id} value={d.id}>
																{d.name}
															</NativeSelectOption>
														))}
													</NativeSelect>
												</Field>
												<Field>
													<FieldLabel htmlFor="deduction-amount">
														扣分额
													</FieldLabel>
													<Input
														readOnly={readOnly}
														id="deduction-amount"
														name="amount"
														defaultValue={deduction?.amount}
														inputMode="decimal"
														required
													/>
													<FieldDescription>
														当前记录：
														{deduction
															? `${deduction.amount}（${deduction.revoked ? "已撤销" : "生效中"}）`
															: "无记录"}
														；实际扣分额由项目系数折算。
													</FieldDescription>
												</Field>
												<Field>
													<FieldLabel htmlFor="deduction-reason">
														业务理由
													</FieldLabel>
													<Input
														readOnly={readOnly}
														id="deduction-reason"
														name="reason"
														required
														minLength={2}
														maxLength={1000}
													/>
												</Field>
											</FieldGroup>
											<div className="flex flex-wrap gap-3">
												<Button
													type="submit"
													value="save"
													disabled={busy || readOnly}
												>
													保存扣分
												</Button>
												{deduction && !deduction.revoked && (
													<Button
														type="submit"
														value="revoke"
														variant="outline"
														disabled={busy || readOnly}
													>
														撤销扣分
													</Button>
												)}
											</div>
										</form>
									)}
								</TemplateEditor>
							</div>
						)}
					</CardContent>
				</Card>
			)}
		</>
	);
}
