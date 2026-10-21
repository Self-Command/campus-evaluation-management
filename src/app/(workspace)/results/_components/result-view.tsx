"use client";
// Complete dashboard/profile page, header, overview and personal-details adapted to results.
import { useState, useEffect } from "react";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
type NodeResult = {
	id: string;
	name: string;
	parentId: string | null;
	complete: boolean;
	gross?: string;
	capped?: string;
	normalized?: string;
	deduction?: string;
	beforeFloor?: string;
	score?: string;
	parentContribution: string;
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
		data?.result.details[0];
	const canCheck =
		data?.publication &&
		data.term.phase === "CHECKING" &&
		new Date(data.publication.checkingEndsAt).getTime() > now;
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
					<Button>查询测评</Button>
					<Link
						href={directoryHref}
						className={buttonVariants({ variant: "outline" })}
					>
						返回学生名录
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
											? `发布版本 ${data.publication.sequence}`
											: "当前成绩"}
									</Badge>
									<Badge variant="secondary">
										{data.result.complete ? "成绩完整" : "待补齐"}
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
													`确认已核对“${data.term.name}”发布版本 ${data.publication!.sequence} 的全部计分依据？`,
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
										{data.confirmation ? "已确认本版本" : "确认本版本"}
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
								异议记录
							</Link>
						</div>
					</div>
					{!data.result.complete && (
						<Alert>
							<AlertTitle>必需成绩尚未补齐</AlertTitle>
							<AlertDescription>
								{data.result.missing.map((n) => n.name).join("、")}
								。暂计分不作为正式总分。
							</AlertDescription>
						</Alert>
					)}
					<Tabs
						className="min-h-0 min-w-0 max-w-full flex-1 gap-0"
						defaultValue="overview"
					>
						<div className="overflow-x-auto border-y">
							<TabsList
								variant="line"
								className="w-max min-w-full justify-start gap-4"
							>
								<TabsTrigger value="overview">总览</TabsTrigger>
								<TabsTrigger value="modules">模块计分</TabsTrigger>
								<TabsTrigger value="basis">认定与扣分依据</TabsTrigger>
							</TabsList>
						</div>
						<div className="min-w-0 max-w-full">
							<TabsContent value="overview">
								<div className="grid min-w-0 lg:grid-cols-[minmax(0,1fr)_auto_18rem]">
									<div className="flex min-w-0 flex-col gap-5 py-4 lg:pr-6">
										<h2 className="font-medium text-base">{data.term.name}</h2>
										<dl className="grid gap-8 sm:grid-cols-2 xl:grid-cols-3">
											<div className="flex flex-col gap-1">
												<dt className="text-muted-foreground text-xs">
													综合总分
												</dt>
												<dd className="text-3xl tabular-nums">
													{data.result.total ?? "待补齐"}
												</dd>
											</div>
											{!data.result.complete && (
												<div className="flex flex-col gap-1">
													<dt className="text-muted-foreground text-xs">
														暂计分
													</dt>
													<dd className="text-2xl tabular-nums">
														{data.result.provisionalTotal}
													</dd>
												</div>
											)}
											<div className="flex flex-col gap-1">
												<dt className="text-muted-foreground text-xs">
													本人名次 / 参评人数
												</dt>
												<dd className="text-xl tabular-nums">
													{data.publication
														? `${data.rank ?? "无名次"} / ${data.population ?? "—"}`
														: "发布后可查"}
												</dd>
											</div>
										</dl>
										<Separator />
										<div className="flex flex-col gap-2">
											<h2 className="font-medium text-base">版本与完整性</h2>
											<p className="text-sm text-muted-foreground">
												方案修订 {data.term.revision} · 输入修订{" "}
												{data.term.inputRevision}
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
															: "本版本尚未确认"}
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
										<h2 className="font-medium text-base">核对顺序</h2>
										<p className="text-sm text-muted-foreground">
											核对各模块原始分、封顶、折算及扣分，再检查有效认定事实。
										</p>
										{data.publication && (
											<p className="text-sm text-muted-foreground">
												确认只对应本次发布版本。更正后重新发布时，需要再次核对。
											</p>
										)}
									</div>
								</div>
							</TabsContent>
							<TabsContent value="modules" className="py-4">
								<div className="grid gap-5 xl:grid-cols-2">
									<div className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4">
										<h2 className="font-medium text-base">模块目录</h2>
										{data.result.details.map((n) => (
											<Button
												key={n.id}
												variant={node?.id === n.id ? "secondary" : "ghost"}
												className="h-auto min-h-11 justify-between whitespace-normal text-left"
												onClick={() => setNodeId(n.id)}
											>
												<span>{n.name}</span>
												<span className="shrink-0 tabular-nums">
													{n.complete ? n.score : "缺失"}
												</span>
											</Button>
										))}
									</div>
									{node && (
										<Card>
											<CardHeader>
												<CardTitle>{node.name}</CardTitle>
												<CardDescription>
													汇总 → 封顶 → 折算 → 扣分 → 最低计入分 → 向上贡献
												</CardDescription>
											</CardHeader>
											<CardContent>
												<dl className="grid gap-5 sm:grid-cols-2">
													{[
														["原始汇总", node.gross],
														["封顶后", node.capped],
														["折算后", node.normalized],
														["扣分", node.deduction],
														["下限前", node.beforeFloor],
														["计入分", node.score],
														["对上级贡献", node.parentContribution],
													].map(([label, value]) => (
														<div key={label} className="flex flex-col gap-1">
															<dt className="text-muted-foreground text-xs">
																{label}
															</dt>
															<dd className="text-lg tabular-nums">
																{value ?? "—"}
															</dd>
														</div>
													))}
												</dl>
											</CardContent>
										</Card>
									)}
								</div>
							</TabsContent>
							<TabsContent value="basis" className="py-4">
								<div className="flex flex-col gap-5">
									<h2 className="font-medium text-base">有效参与事实</h2>
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
											暂无审核通过的活动事实。
										</p>
									)}
									<Separator />
									<h2 className="font-medium text-base">有效个人申报</h2>
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
											暂无审核通过的个人申报。
										</p>
									)}
									<Separator />
									<h2 className="font-medium text-base">成绩输入</h2>
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
														输入修订 {item.revision}
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
											暂无成绩输入记录。
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
							</TabsContent>
						</div>
					</Tabs>
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
						<DialogTitle>提出测评异议</DialogTitle>
						<DialogDescription>
							说明需要核对的总分、模块或事实，并提供必要材料。
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
								setSuccess("异议已提交，可在异议记录查看处理进度。");
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
								<FieldLabel htmlFor="appeal-target">异议对象</FieldLabel>
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
