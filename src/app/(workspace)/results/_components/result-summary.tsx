"use client";

import { BadgeCheck, CircleAlert, CircleHelp, Download, Info, ListTree } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { dateText, phaseLabels } from "@/lib/business-labels";
import { scoreText, type ResultData } from "./result-types";

function deadlineOpen(data: ResultData, now: number) {
	return !!data.publication && new Date(data.publication.checkingEndsAt).getTime() > now;
}

function statusMetric(data: ResultData) {
	if (data.term.phase === "ACTIVE")
		return { value: "录入中", note: "发布后可确认、提异议" };
	if (data.term.phase === "CHECKING")
		return { value: "核对中", note: "可在截止前确认、提异议" };
	if (data.term.phase === "LOCKED")
		return { value: "已锁定", note: "成绩只读" };
	return { value: phaseLabels[data.term.phase] ?? "未知", note: "" };
}

function confirmationMetric(data: ResultData, now: number) {
	if (!data.publication)
		return { value: "未发布", note: "发布后才能确认" };
	if (data.confirmation)
		return {
			value: "已确认",
			note: dateText(
				data.confirmation.confirmedAt ||
					data.confirmation.createdAt ||
					data.publication.publishedAt,
			),
		};
	if (!data.publication.requireConfirmation)
		return { value: "无需确认", note: "本版不要求确认" };
	if (data.term.phase === "LOCKED") return { value: "未确认", note: "周期已锁定" };
	if (!deadlineOpen(data, now)) return { value: "已截止", note: "未在截止前确认" };
	return { value: "待确认", note: "核对无误后确认" };
}

function phaseNote(data: ResultData, now: number, canConfirm: boolean, canAppeal: boolean) {
	if (canConfirm) return "确认只代表你已核对本版，不影响你在截止前提出异议。";
	if (canAppeal)
		return data.confirmation
			? "本版已确认，如有疑问可在截止前提出异议。"
			: "本版不要求确认，如有疑问可在截止前提出异议。";
	if (data.term.phase === "ACTIVE") return "本周期尚未发布，发布后才能确认或提出异议。";
	if (data.term.phase === "CHECKING" && data.publication && !deadlineOpen(data, now))
		return "核对已截止，如有问题请联系辅导员更正。";
	if (data.term.phase === "CHECKING") return "可在核对截止前查看依据；需要时提出异议。";
	if (data.term.phase === "LOCKED") return "本周期已锁定，成绩和依据仅供查看。";
	return "";
}

export function ResultSummary({
	data,
	role,
	now,
	busy,
	onConfirm,
	onAppeal,
	onDetails,
}: {
	data: ResultData;
	role: "ADMIN" | "STUDENT";
	now: number;
	busy: boolean;
	onConfirm: () => void;
	onAppeal: () => void;
	onDetails: () => void;
}) {
	const publication = data.publication;
	const open = deadlineOpen(data, now);
	const canConfirm =
		role === "STUDENT" &&
		data.term.phase === "CHECKING" &&
		!!publication?.requireConfirmation &&
		!data.confirmation &&
		open;
	const canAppeal =
		role === "STUDENT" && data.term.phase === "CHECKING" && !!publication && open;
	const status = statusMetric(data);
	const confirmation = confirmationMetric(data, now);
	const note = phaseNote(data, now, canConfirm, canAppeal);
	const rankValue = publication
		? `${data.rank ?? "—"} / ${data.population ?? "—"}`
		: "发布后可查";
	const finality = !data.result.complete
		? "暂计成绩"
		: data.term.phase === "ACTIVE"
			? "当前成绩"
			: "最终成绩";
	const exportHref = `/api/grades/export?${new URLSearchParams({
		termId: data.term.id,
		studentId: data.student.id,
	})}`;
	const exportLabel = role === "STUDENT" ? "导出我的成绩单" : "导出成绩明细表";

	return (
		<Card data-testid="result-summary">
			<CardHeader className="border-b">
				<CardTitle className="text-xl leading-none">综合测评成绩</CardTitle>
				<CardDescription className="flex flex-wrap gap-x-2 gap-y-1">
					<span>{data.term.name}</span>
					<span aria-hidden="true">·</span>
					<span>{data.student.name}</span>
					<span aria-hidden="true">·</span>
					<span>{data.student.login}</span>
					{data.student.profile && (
						<>
							<span aria-hidden="true">·</span>
							<span>{data.student.profile.college}</span>
							<span aria-hidden="true">·</span>
							<span>{data.student.profile.className}</span>
						</>
					)}
				</CardDescription>
				<CardAction className="flex flex-wrap items-center justify-end gap-2">
					<Badge data-testid="result-finality" variant={data.result.complete ? "default" : "secondary"}>
						{finality}
					</Badge>
					{publication && <Badge variant="outline">第 {publication.sequence} 版</Badge>}
				</CardAction>
			</CardHeader>

			<CardContent className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,34rem)] lg:items-start">
				<div className="flex flex-col gap-2">
					<p className="text-sm text-muted-foreground">总分</p>
					<p className="flex flex-wrap items-baseline gap-2">
						<span
							className="text-5xl font-semibold tracking-tight tabular-nums sm:text-6xl"
							data-testid="result-total-value"
						>
							{scoreText(
								data.result.complete
									? data.result.total
									: data.result.provisionalTotal,
							)}
						</span>
						<span className="text-muted-foreground text-base">分</span>
					</p>
					<p className="text-muted-foreground text-sm">
						{data.result.complete
							? publication
								? "本版成绩已完整录入。"
								: "各项分数已全部算出，发布后可确认。"
							: `暂计成绩，还有 ${data.result.missing.length} 项未录入。`}
					</p>
				</div>

				<dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
					<div className="flex min-w-0 flex-col gap-1" data-testid="result-metric-rank">
						<dt className="text-muted-foreground text-xs">班级排名</dt>
						<dd className="font-medium text-lg tabular-nums">{rankValue}</dd>
						<dd className="text-muted-foreground text-xs">
							{publication ? "本班本次发布" : "发布后按班级排名"}
						</dd>
					</div>
					<div className="flex min-w-0 flex-col gap-1" data-testid="result-metric-status">
						<dt className="text-muted-foreground text-xs">成绩状态</dt>
						<dd className="font-medium text-lg">{status.value}</dd>
						<dd className="text-muted-foreground text-xs">{status.note}</dd>
					</div>
					<div className="flex min-w-0 flex-col gap-1" data-testid="result-metric-confirmation">
						<dt className="text-muted-foreground text-xs">确认状态</dt>
						<dd className="font-medium text-lg">{confirmation.value}</dd>
						<dd className="text-muted-foreground text-xs">{confirmation.note}</dd>
					</div>
					<div className="flex min-w-0 flex-col gap-1" data-testid="result-metric-deadline">
						<dt className="text-muted-foreground text-xs">核对截止</dt>
						<dd className="font-medium text-sm tabular-nums">
							{publication ? dateText(publication.checkingEndsAt) : "发布后确定"}
						</dd>
						<dd className="text-muted-foreground text-xs">
							{publication
								? open
									? "截止前可确认或提异议"
									: "核对已截止"
								: "随发布批次确定"}
						</dd>
					</div>
				</dl>
			</CardContent>

			{!data.result.complete && (
				<CardContent>
					<Alert>
						<CircleAlert />
						<AlertTitle>还有 {data.result.missing.length} 项成绩未录入</AlertTitle>
						<AlertDescription>
							{data.result.missing.map((item) => item.name).join("、")}
							。录入完成前，页面显示暂计成绩，不作为最终结果。
						</AlertDescription>
					</Alert>
				</CardContent>
			)}

			<CardFooter className="flex flex-wrap items-center gap-2">
				{canConfirm && (
					<Button
						className="min-h-11 sm:min-h-8"
						disabled={busy}
						onClick={onConfirm}
					>
						<BadgeCheck data-icon="inline-start" />
						确认成绩
					</Button>
				)}
				{canAppeal && (
					<Button
						className="min-h-11 sm:min-h-8"
						disabled={busy}
						onClick={onAppeal}
						variant={canConfirm ? "outline" : "default"}
					>
						<CircleHelp data-icon="inline-start" />
						提出异议
					</Button>
				)}
				{!canConfirm && !canAppeal && (
					<a
						className={buttonVariants({ className: "min-h-11 sm:min-h-8" })}
						href="#score-breakdown"
					>
						<ListTree data-icon="inline-start" />
						查看计分依据
					</a>
				)}
				<a
					className={buttonVariants({
						variant: "outline",
						className: "min-h-11 sm:min-h-8",
					})}
					href={exportHref}
				>
					<Download data-icon="inline-start" />
					{exportLabel}
				</a>
				<Button
					className="min-h-11 sm:min-h-8"
					onClick={onDetails}
					variant="outline"
				>
					<Info data-icon="inline-start" />
					成绩说明
				</Button>
				{note && (
					<p className="w-full text-muted-foreground text-xs sm:ml-auto sm:w-auto sm:text-right">
						{note}
					</p>
				)}
			</CardFooter>
		</Card>
	);
}
