"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { Button, buttonVariants } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useRemote } from "@/components/dashboard/use-remote";
import { RemoteState } from "@/components/dashboard/remote-state";
import { Feedback, requestJson } from "@/components/dashboard/feedback";
import { EvidenceUpload, type EvidenceLimits } from "@/components/dashboard/evidence-upload";
import { dateText } from "@/lib/business-labels";
import { ResultSummary } from "./result-summary";
import { ScoreBreakdown } from "./score-breakdown";
import { SourceRecords } from "./source-records";
import type { ResultData } from "./result-types";

function VersionItem({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex min-w-0 flex-col gap-1">
			<dt className="text-muted-foreground text-xs">{label}</dt>
			<dd className="break-words text-sm">{value}</dd>
		</div>
	);
}

export function ResultView({
	termId,
	role,
	login,
	evidenceLimits,
}: {
	termId: string;
	role: "ADMIN" | "STUDENT";
	login: string;
	evidenceLimits: EvidenceLimits;
}) {
	const search = useSearchParams();
	const directoryHref = `/results?${new URLSearchParams({
		termId,
		q: search.get("q") || "",
		page: search.get("page") || "1",
		college: search.get("college") || "",
		major: search.get("major") || "",
		className: search.get("className") || "",
	})}`;
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = window.setInterval(() => setNow(Date.now()), 30000);
		return () => window.clearInterval(timer);
	}, []);

	const remote = useRemote<ResultData>(
		role === "STUDENT" || login
			? `/api/results?termId=${termId}&studentLogin=${encodeURIComponent(login)}`
			: null,
	);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [success, setSuccess] = useState("");
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [appealOpen, setAppealOpen] = useState(false);
	const [detailsOpen, setDetailsOpen] = useState(false);
	const [ids, setIds] = useState<string[]>([]);
	const [uploading, setUploading] = useState(false);
	const data = remote.data;

	async function confirmResult() {
		if (!data?.publication || !data.resultHash) return;
		setBusy(true);
		setError("");
		setSuccess("");
		try {
			await requestJson(`/api/results/${data.publication.id}/confirm`, {
				termId,
				resultHash: data.resultHash,
			});
			setSuccess("本版成绩已确认。");
			setConfirmOpen(false);
			remote.reload();
		} catch (err) {
			setError((err as Error).message);
			setConfirmOpen(false);
		} finally {
			setBusy(false);
		}
	}

	function openAppeal() {
		setIds([]);
		setError("");
		setAppealOpen(true);
	}

	return (
		<>
			{role === "ADMIN" && (
				<form action="/results" className="flex flex-wrap items-end gap-3">
					<input name="termId" type="hidden" value={termId} />
					{["q", "page", "college", "major", "className"].map((key) => (
						<input
							key={key}
							name={key}
							type="hidden"
							value={search.get(key) || ""}
						/>
					))}
					<FieldGroup className="sm:w-80">
						<Field>
							<FieldLabel htmlFor="result-login">学生学号</FieldLabel>
							<Input
								defaultValue={login}
								id="result-login"
								maxLength={64}
								name="login"
								required
							/>
						</Field>
					</FieldGroup>
					<Button className="min-h-11 sm:min-h-8" type="submit">
						查询成绩
					</Button>
					<Link
						className={buttonVariants({
							variant: "outline",
							className: "min-h-11 sm:min-h-8",
						})}
						href={directoryHref}
					>
						返回学生名单
					</Link>
				</form>
			)}

			<RemoteState {...remote} />
			<Feedback error={error} success={success} />

			{data && (
				<div className="flex min-w-0 max-w-full flex-col gap-6 py-2">
					<ResultSummary
						busy={busy}
						data={data}
						now={now}
						onAppeal={openAppeal}
						onConfirm={() => setConfirmOpen(true)}
						onDetails={() => setDetailsOpen(true)}
						role={role}
					/>
					<ScoreBreakdown details={data.result.details} />
					<SourceRecords data={data} termId={termId} />
					<footer className="flex flex-col gap-1 border-t pt-4 text-muted-foreground text-xs">
						<p>辅导员负责成绩录入与更正，学院负责审核，学校负责发布。</p>
						<p>页面显示以系统当前版本为准；导出的表格用于留存和线下核对。</p>
					</footer>
				</div>
			)}

			<AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>确认本版成绩？</AlertDialogTitle>
						<AlertDialogDescription>
							请先核对全部计分依据。确认后仍可在核对截止前提出异议。
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>再核对一下</AlertDialogCancel>
						<AlertDialogAction disabled={busy} onClick={() => void confirmResult()}>
							{busy ? "正在确认…" : "确认成绩"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			<Dialog
				open={detailsOpen}
				onOpenChange={(open) => {
					if (!busy) setDetailsOpen(open);
				}}
			>
				<DialogContent className="sm:max-w-lg">
					<DialogHeader>
						<DialogTitle>成绩说明</DialogTitle>
						<DialogDescription>
							{data?.term.name}
							{data?.publication
								? ` · 第 ${data.publication.sequence} 版`
								: " · 尚未发布"}
						</DialogDescription>
					</DialogHeader>
					{data && (
						<>
							<dl className="grid gap-4 sm:grid-cols-2">
								<VersionItem
									label="评分方案"
									value={`第 ${data.term.revision} 版`}
								/>
								<VersionItem
									label="成绩更新"
									value={`共 ${data.term.inputRevision} 次`}
								/>
								<VersionItem
									label="发布批次"
									value={
										data.publication
											? `第 ${data.publication.sequence} 版`
											: "尚未发布"
									}
								/>
								<VersionItem
									label="发布时间"
									value={
										data.publication
											? dateText(data.publication.publishedAt)
											: "尚未发布"
									}
								/>
								<VersionItem
									label="核对截止"
									value={
										data.publication
											? dateText(data.publication.checkingEndsAt)
											: "发布后确定"
									}
								/>
								<VersionItem
									label="确认要求"
									value={
										data.publication
											? data.publication.requireConfirmation
												? "需要确认"
												: "无需确认"
											: "发布后确定"
									}
								/>
								<VersionItem
									label="确认状态"
									value={
										data.confirmation
											? `已确认于 ${dateText(
													data.confirmation.confirmedAt ||
														data.confirmation.createdAt ||
														data.publication?.publishedAt ||
														new Date(),
												)}`
											: data.publication
												? data.publication.requireConfirmation
													? data.term.phase === "LOCKED"
														? "未确认，周期已锁定"
														: "待确认"
													: "无需确认"
												: "未发布"
									}
								/>
								<VersionItem
									label="本页查看"
									value={
										role === "STUDENT"
											? "本人成绩"
											: `${data.student.name}的成绩`
									}
								/>
							</dl>
							<div className="flex flex-col gap-2 rounded-lg bg-muted/50 p-3 text-sm">
								<p>每次重新发布都会生成新版本，之前的确认只对原版本有效。</p>
								<p>成绩更正由辅导员提交、学院审核；学校负责发布。</p>
								<p>导出表格用于留存和线下核对，以系统当前显示为准。</p>
							</div>
						</>
					)}
					<DialogFooter className="flex-wrap sm:justify-between">
						{data?.publication ? (
							<Link
								className={buttonVariants({ variant: "outline" })}
								href={`/appeals?termId=${termId}`}
							>
								查看我的异议
							</Link>
						) : (
							<span />
						)}
						<DialogClose render={<Button variant="outline" />}>关闭</DialogClose>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog
				open={appealOpen}
				onOpenChange={(open) => {
					if (!busy && !uploading) setAppealOpen(open);
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>提出成绩异议</DialogTitle>
						<DialogDescription>
							说明需要核对的项目和理由，提交后由管理员处理。处理期间不需要重复提交。
						</DialogDescription>
					</DialogHeader>
					<form
						className="flex flex-col gap-5"
						key={appealOpen ? "open" : "closed"}
						onSubmit={async (event) => {
							event.preventDefault();
							if (busy || uploading || !data?.publication) return;
							setBusy(true);
							setError("");
							const form = new FormData(event.currentTarget);
							try {
								await requestJson("/api/appeals", {
									termId,
									publicationId: data.publication.id,
									resultHash: data.resultHash,
									target: form.get("target"),
									reason: form.get("reason"),
									evidenceIds: ids,
								});
								setAppealOpen(false);
								setSuccess("异议已提交，可在“我的异议”中查看处理进度。");
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
									defaultValue="综合测评成绩"
									id="appeal-target"
									maxLength={120}
									name="target"
									required
								/>
							</Field>
							<Field>
								<FieldLabel htmlFor="appeal-reason">异议说明</FieldLabel>
								<Textarea
									id="appeal-reason"
									maxLength={2000}
									minLength={2}
									name="reason"
									required
									rows={4}
								/>
							</Field>
							<EvidenceUpload onChange={setIds} onBusy={setUploading} limits={evidenceLimits} />
						</FieldGroup>
						<Button
							className="min-h-11 sm:min-h-8"
							disabled={busy || uploading}
							type="submit"
						>
							提交异议
						</Button>
					</form>
				</DialogContent>
			</Dialog>
		</>
	);
}
