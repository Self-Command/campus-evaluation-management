"use client";
// Complete dashboard/profile page, header, overview and personal-details adapted to results.
import { useState, useEffect, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
	Card,
	CardHeader,
	CardTitle,
	CardDescription,
	CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogDescription,
} from "@/components/ui/dialog";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { useRemote } from "@/components/dashboard/use-remote";
import { RemoteState } from "@/components/dashboard/remote-state";
import { Feedback, requestJson } from "@/components/dashboard/feedback";
import { EvidenceViewer } from "@/components/dashboard/evidence-viewer";
import { EvidenceUpload } from "@/components/dashboard/evidence-upload";
import { dateText, phaseLabels } from "@/lib/business-labels";
import { InputHistory } from "@/components/dashboard/input-history";
type NodeKind = "SUM" | "WEIGHTED" | "ACTIVITY" | "GRADE";
type NodeResult = {
	id: string;
	name: string;
	parentId: string | null;
	kind?: NodeKind;
	weight?: string;
	order?: number;
	complete: boolean;
	gross?: string;
	capped?: string;
	normalized?: string;
	deduction?: string;
	beforeFloor?: string;
	score?: string;
	parentContribution: string;
	normalization?: { rawMaximum: string | null; targetMaximum: string | null } | null;
};
type Result = {
	term: {
		id: string;
		name: string;
		phase: string;
		revision: number;
		inputRevision: number;
	};
	student: {
		id: string;
		name: string;
		login: string;
		profile?: { college: string; major: string; className: string };
	};
	result: {
		total: string | null;
		provisionalTotal: string;
		complete: boolean;
		missing: { id: string; name: string }[];
		details: NodeResult[];
	};
	participations: {
		id: string;
		activityId: string;
		name: string;
		points: string;
		approvedSourceCount?: number;
		sources?: { id: string; evidence: { evidenceId: string }[] }[];
	}[];
	claims?: {
		id: string;
		name: string;
		points: string;
		factKey?: string;
		evidenceIds?: string[];
	}[];
	grades?: {
		id: string;
		nodeId: string;
		name: string;
		value: string;
		revision: number;
	}[];
	deductions: {
		id: string;
		name: string;
		nodeName: string;
		amount: string;
		coefficient: string;
		reason: string;
	}[];
	publication?: {
		id: string;
		sequence: number;
		publishedAt: string;
		checkingEndsAt: string;
		requireConfirmation: boolean;
	};
	resultHash?: string;
	confirmation?: { confirmedAt?: string; createdAt?: string } | null;
	rank?: number | null;
	population?: number;
};
type Explanation = {
	lead: string;
	parts: { name: string; value: string }[];
	steps: string[];
	conclusion: string;
	relation: string;
};
function stageDiffers(a?: string, b?: string) {
	if (a === undefined || b === undefined) return false;
	return Math.abs(Number(a) - Number(b)) > 1e-9;
}
function explanation(
	item: NodeResult,
	parent: NodeResult | undefined,
	children: NodeResult[],
): Explanation {
	const score = item.score ?? "—";
	const name = item.parentId === null ? "综合测评成绩" : item.name;
	const parts = children.map((child) => ({
		name: child.name,
		value: child.complete ? `${child.score ?? "—"} 分` : "未录入",
	}));
	const steps: string[] = [];
	const lead =
		item.parentId === null
			? "这是你本学期各项得分的总和。"
			: item.kind === "GRADE"
				? "这一项是辅导员录入并经过学院审核的成绩。"
				: item.kind === "ACTIVITY"
					? "这一项来自你通过审核的活动和成果。"
					: `这一项由下面 ${children.length} 项加起来。`;
	if (stageDiffers(item.capped, item.gross)) steps.push(`超过这一项的分数上限，只按 ${item.capped} 分计算。`);
	if (item.normalization) steps.push(`把 ${item.normalization.rawMaximum ?? "—"} 分满分折算成 ${item.normalization.targetMaximum ?? "—"} 分，得到 ${item.normalized} 分。`);
	if (Number(item.deduction ?? 0) > 0) steps.push(`再扣掉纪律扣分 ${item.deduction} 分。`);
	if (stageDiffers(item.score, item.beforeFloor)) steps.push(`有最低计入分，所以按 ${item.score} 分计算。`);
	const conclusion = item.complete
		? `${name}：${score} 分。`
		: `${name}：还有成绩没录完，暂时不计入总分。`;
	const relation = !parent
		? "这就是你的综合测评总成绩。"
		: parent.kind === "WEIGHTED"
			? `其中 ${Number(item.weight ?? 0) * 100}% 计入「${parent.name}」，也就是 ${item.parentContribution} 分。`
			: `这 ${score} 分全部计入「${parent.name}」。`;
	return { lead, parts, steps, conclusion, relation };
}

export function ResultView({
	termId,
	role,
	login,
}: {
	termId: string;
	role: "ADMIN" | "STUDENT";
	login: string;
}) {
	const search = useSearchParams();
	const directoryHref = `/results?${new URLSearchParams({ termId, q: search.get("q") || "", page: search.get("page") || "1", college: search.get("college") || "", major: search.get("major") || "", className: search.get("className") || "" })}`;
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = window.setInterval(() => setNow(Date.now()), 30000);
		return () => window.clearInterval(timer);
	}, []);
	const remote = useRemote<Result>(
		role === "STUDENT" || login
			? `/api/results?termId=${termId}&studentLogin=${encodeURIComponent(login)}`
			: null,
	);
	const [nodeId, setNodeId] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [success, setSuccess] = useState("");
	const [appeal, setAppeal] = useState(false);
	const [ids, setIds] = useState<string[]>([]);
	const [uploading, setUploading] = useState(false);
	const data = remote.data;
	const node =
		data?.result.details.find((n) => n.id === nodeId) ||
		data?.result.details.find((n) => !n.parentId) ||
		data?.result.details[0];
	const canCheck =
		data?.publication &&
		data.term.phase === "CHECKING" &&
		new Date(data.publication.checkingEndsAt).getTime() > now;
	const details = data?.result.details ?? [];
	const nodeById = new Map(details.map((item) => [item.id, item]));
	const childrenOf = new Map<string, NodeResult[]>();
	const roots: NodeResult[] = [];
	for (const item of details) {
		const parent = item.parentId ? nodeById.get(item.parentId) : undefined;
		if (parent) childrenOf.set(parent.id, [...(childrenOf.get(parent.id) ?? []), item]);
		else roots.push(item);
	}
	const byOrder = (a: NodeResult, b: NodeResult) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name, "zh-CN");
	for (const list of childrenOf.values()) list.sort(byOrder);
	roots.sort(byOrder);
	const selectedChildren = node ? (childrenOf.get(node.id) ?? []) : [];
	const detail = node
		? explanation(
				node,
				node.parentId ? nodeById.get(node.parentId) : undefined,
				selectedChildren,
			)
		: null;
	function moduleCard(item: NodeResult): ReactNode {
		const children = childrenOf.get(item.id) ?? [];
		const selected = node?.id === item.id;
		return (
			<Card key={item.id} className={selected ? "border-primary/60 ring-1 ring-primary/20" : undefined}>
				<button
					type="button"
					onClick={() => setNodeId(item.id)}
					aria-pressed={selected}
					className="w-full rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					<CardHeader className="gap-2">
						<div className="flex items-start justify-between gap-3">
							<div className="flex min-w-0 flex-col gap-1">
								<CardTitle className="text-base leading-tight">{item.name}</CardTitle>
								<CardDescription>
									{item.parentId === null
										? "你的综合测评总成绩"
										: item.kind === "GRADE"
											? "辅导员录入的成绩"
											: item.kind === "ACTIVITY"
												? "活动与成果得分"
												: `下面 ${children.length} 项加起来`}
								</CardDescription>
							</div>
							<div className="flex shrink-0 items-baseline gap-1">
								<span className="text-2xl font-semibold tabular-nums">
									{item.complete ? item.score : "—"}
								</span>
								<span className="text-muted-foreground text-xs">分</span>
							</div>
						</div>
					</CardHeader>
				</button>
				{children.length > 0 && (
					<CardContent className="ml-3 flex flex-col gap-3 border-l-2 border-dashed pl-3 sm:ml-5 sm:pl-4">
						{children.map((child) => moduleCard(child))}
					</CardContent>
				)}
			</Card>
		);
	}

	return (
		<>
			{role === "ADMIN" && (
				<form action="/results" className="flex flex-wrap items-end gap-3">
					<input type="hidden" name="termId" value={termId} />
					{["q", "page", "college", "major", "className"].map((key) => (
						<input
							key={key}
							type="hidden"
							name={key}
							value={search.get(key) || ""}
						/>
					))}
					<FieldGroup className="sm:w-80">
						<Field>
							<FieldLabel htmlFor="result-login">学生学号</FieldLabel>
							<Input
								id="result-login"
								name="login"
								defaultValue={login}
								required
								maxLength={64}
							/>
						</Field>
					</FieldGroup>
					<Button type="submit">查询成绩</Button>
					<Link
						href={directoryHref}
						className={buttonVariants({ variant: "outline" })}
					>
						返回学生名单
					</Link>
				</form>
			)}
			<RemoteState {...remote} />
			<Feedback error={error} success={success} />
			{data && (
				<div className="flex min-w-0 max-w-full flex-col gap-4 py-4">
					<div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
						<div className="flex min-w-0 items-center gap-4">
							<Avatar className="size-16">
								<AvatarFallback>{data.student.name.slice(0, 1)}</AvatarFallback>
							</Avatar>
							<div className="flex min-w-0 flex-col gap-2">
								<h1 className="truncate text-xl font-semibold sm:text-2xl">
									{data.student.name} 的测评
								</h1>
								<p className="text-muted-foreground text-sm">
									{data.student.login} · {data.student.profile?.college} ·{" "}
									{data.student.profile?.className}
								</p>
								<div className="flex flex-wrap gap-2">
									<Badge variant="outline">
										{phaseLabels[data.term.phase]}
									</Badge>
									<Badge variant="outline">
										{data.publication
											? `已发布第 ${data.publication.sequence} 版`
											: "当前成绩"}
									</Badge>
									<Badge variant="secondary">
										{data.result.complete ? "成绩完整" : "成绩未录完"}
									</Badge>
								</div>
							</div>
						</div>
						<div className="flex flex-wrap gap-2">
							{role === "STUDENT" && canCheck && (
								<>
									<Button
										disabled={busy || !!data.confirmation}
										onClick={async () => {
											if (busy) return;
											if (
												!window.confirm(
													`确认已核对“${data.term.name}”第 ${data.publication!.sequence} 版的全部计分依据？`,
												)
											)
												return;
											setBusy(true);
											setError("");
											try {
												await requestJson(
													`/api/results/${data.publication!.id}/confirm`,
													{
														termId,
														resultHash: data.resultHash,
													},
												);
												setSuccess("本版本已确认。");
												remote.reload();
											} catch (err) {
												setError((err as Error).message);
											} finally {
												setBusy(false);
											}
										}}
									>
										{data.confirmation ? "已确认本版" : "确认本版成绩"}
									</Button>
									<Button
										variant="outline"
										onClick={() => {
											setIds([]);
											setError("");
											setAppeal(true);
										}}
									>
										提出异议
									</Button>
								</>
							)}
							<Link
								href={`/appeals?termId=${termId}`}
								className={buttonVariants({ variant: "outline" })}
							>
								我的异议
							</Link>
						</div>
					</div>
					{!data.result.complete && (
						<Alert>
							<AlertTitle>还有成绩未录入</AlertTitle>
							<AlertDescription>
								{data.result.missing.map((n) => n.name).join("、")}
								。当前为暂计分，不作为最终成绩。
							</AlertDescription>
						</Alert>
					)}
					<div className="flex min-w-0 max-w-full flex-col gap-8">
						
						<div className="min-w-0 max-w-full">
							<section aria-label="成绩概览" className="flex flex-col gap-5">
								<div className="grid min-w-0 lg:grid-cols-[minmax(0,1fr)_auto_18rem]">
									<div className="flex min-w-0 flex-col gap-5 py-4 lg:pr-6">
										<h2 className="font-medium text-base">{data.term.name}</h2>
										<div className="flex flex-wrap items-end justify-between gap-6">
											<div className="flex flex-col gap-1">
												<p className="text-muted-foreground text-sm">综合测评成绩</p>
												<p className="flex items-baseline gap-2">
													<span className="text-5xl font-semibold tabular-nums">
														{data.result.complete
															? data.result.total
															: "暂不计分"}
													</span>
													{data.result.complete && (
														<span className="text-muted-foreground text-base">
															分
														</span>
													)}
												</p>
												{!data.result.complete && (
													<p className="text-muted-foreground text-sm">
														还有 {data.result.missing.length} 项没录完，当前暂计{" "}
														{data.result.provisionalTotal} 分
													</p>
												)}
											</div>
											<dl className="grid gap-6 sm:grid-cols-3">
												<div className="flex flex-col gap-1">
													<dt className="text-muted-foreground text-xs">
														班级名次
													</dt>
													<dd className="text-xl tabular-nums">
														{data.publication
															? `${data.rank ?? "无名次"} / ${data.population ?? "—"}`
															: "发布后可查"}
													</dd>
												</div>
												<div className="flex flex-col gap-1">
													<dt className="text-muted-foreground text-xs">
														成绩状态
													</dt>
													<dd className="text-sm">
														{phaseLabels[data.term.phase]}
													</dd>
												</div>
												<div className="flex flex-col gap-1">
													<dt className="text-muted-foreground text-xs">
														核对确认
													</dt>
													<dd className="text-sm">
														{data.confirmation
															? "已确认"
															: data.publication
																? "待确认"
																: "未发布"}
													</dd>
												</div>
											</dl>
										</div>
										<Separator />
										<div className="flex flex-col gap-2">
											<h2 className="font-medium text-base">成绩版本</h2>
											<p className="text-sm text-muted-foreground">
												评分方案第 {data.term.revision} 版 · 成绩第{" "}
												{data.term.inputRevision} 版
											</p>
											{data.publication && (
												<>
													<p className="text-sm">
														发布时间：{dateText(data.publication.publishedAt)}
													</p>
													<p className="text-sm">
														核对截止：
														{dateText(data.publication.checkingEndsAt)}
													</p>
													<p className="text-sm">
														{data.confirmation
															? `已确认：${dateText(data.confirmation.confirmedAt || data.confirmation.createdAt || data.publication.publishedAt)}`
															: "尚未确认"}
													</p>
												</>
											)}
										</div>
									</div>
									<Separator
										orientation="vertical"
										className="hidden lg:block"
									/>
									<div className="flex flex-col gap-3 py-4 lg:pl-6">
										<h2 className="font-medium text-base">接下来可以做什么</h2>
										<p className="text-sm text-muted-foreground">
											先看得分构成，再看计分依据。分数有问题在核对期内提出异议；辅导员负责录入与更正，学院负责审核。
										</p>
										{data.publication && (
											<p className="text-sm text-muted-foreground">
												确认只对应本次发布。更正后重新发布时，需要再次核对。
											</p>
										)}
									</div>
								</div>
							</section>
							<section aria-label="得分构成" className="flex flex-col gap-5 border-t pt-6">
								<div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_23rem]">
									<div className="flex min-w-0 flex-col gap-4">
										<div className="flex flex-col gap-1">
											<h2 className="font-medium text-base">得分构成</h2>
											<p className="text-sm text-muted-foreground">
												每一项得多少分、怎么来的都在这里。点一下任意一项，右边会用白话说明它是怎么算出来的。
											</p>
										</div>
										<div className="flex flex-col gap-3">{roots.map((item) => moduleCard(item))}</div>
									</div>
									{node && detail && (
										<Card className="self-start">
											<CardHeader>
												<CardTitle className="text-base">{node.name}</CardTitle>
												<CardDescription>{detail.lead}</CardDescription>
											</CardHeader>
											<CardContent className="flex flex-col gap-3">
												<div className="flex items-baseline gap-2">
													<span className="text-3xl font-semibold tabular-nums">
														{node.complete ? node.score : "—"}
													</span>
													<span className="text-muted-foreground text-sm">分</span>
												</div>
												{detail.parts.length > 0 && (
													<ul className="flex flex-col gap-1.5 border-t pt-3">
														{detail.parts.map((part) => (
															<li
																key={part.name}
																className="flex items-center justify-between gap-3 text-sm"
															>
																<span className="min-w-0 break-words">
																	{part.name}
																</span>
																<span className="shrink-0 tabular-nums">
																	{part.value}
																</span>
															</li>
														))}
													</ul>
												)}
												{detail.steps.length > 0 && (
													<ul className="flex list-disc flex-col gap-1 pl-5 text-muted-foreground text-sm">
														{detail.steps.map((step) => (
															<li key={step}>{step}</li>
														))}
													</ul>
												)}
												<p className="text-sm font-medium">{detail.conclusion}</p>
												<p className="text-muted-foreground text-sm">{detail.relation}</p>
											</CardContent>
										</Card>
									)}
								</div>
							</section>

							<section aria-label="计分依据" className="flex flex-col gap-5 border-t pt-6">
								<div className="flex flex-col gap-5">
									<h2 className="font-semibold text-lg">计分依据</h2>
									<p className="text-sm text-muted-foreground">
										下面每一项都可以展开查看材料；这里只列出已经通过审核、真正计入分数的记录。
									</p>
									<h2 className="font-medium text-base">已通过的活动参与</h2>
									{data.participations.length ? (
										data.participations.map((item) => (
											<div
												key={item.id}
												className="flex flex-wrap justify-between gap-3 border-b pb-3"
											>
												<Link
													href={`/activities/${item.activityId}`}
													className="text-sm underline"
												>
													{item.name}
												</Link>
												<span className="text-sm tabular-nums">
													{item.points} 分 · 计分一次
												</span>
												<div className="flex w-full flex-col gap-2">
													{[
														...new Set(
															(item.sources || []).flatMap((source) =>
																source.evidence.map((file) => file.evidenceId),
															),
														),
													].map((id, index) => (
														<EvidenceViewer
															key={id}
															evidence={{ id, name: `活动证明${index + 1}` }}
														/>
													))}
												</div>
											</div>
										))
									) : (
										<p className="text-sm text-muted-foreground">
											暂无已通过的活动参与。
										</p>
									)}
									<Separator />
									<h2 className="font-medium text-base">已通过的成果申报</h2>
									{data.claims?.length ? (
										data.claims.map((item) => (
											<div
												key={item.id}
												className="flex flex-wrap justify-between gap-3 text-sm"
											>
												<span>
													{item.name}
													{item.factKey ? ` · ${item.factKey}` : ""}
												</span>
												<span>{item.points} 分</span>
												<div className="flex w-full flex-col gap-2">
													{(item.evidenceIds || []).map((id, index) => (
														<EvidenceViewer
															key={id}
															evidence={{ id, name: `申报证明${index + 1}` }}
														/>
													))}
												</div>
											</div>
										))
									) : (
										<p className="text-sm text-muted-foreground">
											暂无已通过的成果申报。
										</p>
									)}
									<Separator />
									<h2 className="font-medium text-base">成绩录入</h2>
									{data.grades?.length ? (
										data.grades.map((item) => (
											<div
												key={item.id}
												className="flex flex-wrap items-center justify-between gap-3 border-b pb-3"
											>
												<div>
													<p className="text-sm">
														{item.name} · {item.value} 分
													</p>
													<p className="text-xs text-muted-foreground">
														成绩版本 {item.revision}
													</p>
												</div>
												<InputHistory
													termId={termId}
													kind="grade"
													id={item.id}
												/>
											</div>
										))
									) : (
										<p className="text-sm text-muted-foreground">
											暂无成绩记录。
										</p>
									)}
									<Separator />
									<h2 className="font-medium text-base">当前扣分</h2>
									{data.deductions.length ? (
										data.deductions.map((item) => (
											<div
												key={item.id}
												className="flex flex-col gap-1 border-b pb-3"
											>
												<div className="flex flex-wrap justify-between gap-3 text-sm">
													<span>{item.name}</span>
													<span>
														{item.amount} × {item.coefficient}
													</span>
												</div>
												<p className="text-sm text-muted-foreground">
													{item.nodeName} · {item.reason}
												</p>
												<div className="self-start">
													<InputHistory
														termId={termId}
														kind="deduction"
														id={item.id}
													/>
												</div>
											</div>
										))
									) : (
										<p className="text-sm text-muted-foreground">
											暂无有效扣分。
										</p>
									)}
								</div>
							</section>
						</div>
					</div>
				</div>
			)}
			<Dialog
				open={appeal}
				onOpenChange={(open) => {
					if (!busy && !uploading) setAppeal(open);
				}}
			>
				<DialogContent className="max-h-[90dvh] overflow-y-auto">
					<DialogHeader>
						<DialogTitle>提出成绩异议</DialogTitle>
						<DialogDescription>
							说明需要核对的总分、模块或参与记录，并提供必要证明。
						</DialogDescription>
					</DialogHeader>
					<form
						key={appeal ? "open" : "closed"}
						className="flex flex-col gap-5"
						onSubmit={async (e) => {
							e.preventDefault();
							if (busy || uploading || !data?.publication) return;
							setBusy(true);
							setError("");
							const form = new FormData(e.currentTarget);
							try {
								await requestJson("/api/appeals", {
									termId,
									publicationId: data.publication.id,
									resultHash: data.resultHash,
									target: form.get("target"),
									reason: form.get("reason"),
									evidenceIds: ids,
								});
								setAppeal(false);
								setSuccess("异议已提交，可在“我的成绩异议”中查看处理进度。");
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
								<FieldLabel htmlFor="appeal-target">异议项目</FieldLabel>
								<Input
									id="appeal-target"
									name="target"
									defaultValue={node?.name || "综合总分"}
									required
									maxLength={120}
								/>
							</Field>
							<Field>
								<FieldLabel htmlFor="appeal-reason">异议说明</FieldLabel>
								<Textarea
									id="appeal-reason"
									name="reason"
									required
									minLength={2}
									maxLength={2000}
									rows={4}
								/>
							</Field>
							<EvidenceUpload onChange={setIds} onBusy={setUploading} />
						</FieldGroup>
						<Button disabled={busy || uploading} type="submit">
							提交异议
						</Button>
					</form>
				</DialogContent>
			</Dialog>
		</>
	);
}
