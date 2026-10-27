"use client";
import {
	hasUnsavedChanges,
	useUnsavedChanges,
} from "@/components/dashboard/use-unsaved-changes";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
	DropdownMenu,
	DropdownMenuTrigger,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLinkItem,
	DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal } from "lucide-react";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Feedback, requestJson } from "@/components/dashboard/feedback";
import { SearchableSelect } from "@/components/dashboard/searchable-select";
import { EvidenceUpload } from "@/components/dashboard/evidence-upload";
import { EvidenceViewer } from "@/components/dashboard/evidence-viewer";
import { ActivityForm, type Activity } from "./activity-form";
import { dateText, phaseLabels, type AppRole } from "@/lib/business-labels";
import type { Scheme } from "@/lib/scoring/types";
import {
	ActivityParticipants,
	OwnParticipation,
} from "./activity-participants";
import {
	type AudiencePreview,
	classLabel,
	scopeLabels,
} from "./audience-editor";
import { ScoringCorrection } from "@/components/dashboard/scoring-correction";
import { MarkdownContent } from "@/components/dashboard/markdown-content";
import { formatBytes } from "@/lib/format-bytes";
import type { UploadLimits } from "@/components/dashboard/rich-text-editor";
import type { EvidenceLimits } from "@/components/dashboard/evidence-upload";
export function ActivityDetail({
	activity,
	term,
	user,
	colleges = [],
	limits,
	evidenceLimits,
	now,
	returnHref,
}: {
	activity: Activity;
	term: {
		id: string;
		name: string;
		phase: string;
		disposition?: string;
		revision: number;
		scheme: Scheme;
	};
	user: { id: string; role: AppRole };
	colleges?: { id: string; name: string; code?: string }[];
	limits: UploadLimits;
	evidenceLimits: EvidenceLimits;
	now: string;
	returnHref?: string;
}) {
	const [dirty, setDirty] = useState(false);
	useUnsavedChanges(dirty);
	const router = useRouter();
	const [edit, setEdit] = useState(false);
	const [ids, setIds] = useState<string[]>([]);
	const [uploading, setUploading] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [success, setSuccess] = useState("");
	const [evidenceOpen, setEvidenceOpen] = useState(false);
	const [reassignOpen, setReassignOpen] = useState(false);
	const active =
		term.phase === "ACTIVE" &&
		(!term.disposition || term.disposition === "NORMAL");
	const owner = !!activity.canManage;
	const canSeeParticipation =
		user.role !== "STUDENT" && (user.role !== "PUBLISHER" || owner);
	const canSeeEvidence =
		canSeeParticipation ||
		(user.role === "STUDENT" &&
			!!activity.ownParticipation?.registeredAt &&
			!activity.ownParticipation.removedAt);
	const visibleTabCount =
		1 +
		(canSeeParticipation ? 1 : 0) +
		(canSeeEvidence ? 1 : 0) +
		(activity.ownParticipation ? 1 : 0);
	const endedAt = activity.endedAt ? new Date(activity.endedAt).getTime() : null;
	const endsAtTime = new Date(activity.endsAt).getTime();
	const nowTime = new Date(now).getTime();
	const ended = endedAt !== null || endsAtTime < nowTime;
	const withdrawn = !activity.publishedAt && (activity.publishRevision ?? 0) > 0;
	const canEnd =
		active &&
		owner &&
		!!activity.publishedAt &&
		!activity.endedAt &&
		endsAtTime > nowTime;
	const canReopen =
		active && owner && !!activity.endedAt && endsAtTime > nowTime;
	const statusLabel = activity.publishedAt
		? ended
			? "已结束"
			: "进行中"
		: withdrawn
			? "已撤回"
			: "未发布";
	const statusHint =
		user.role === "STUDENT"
			? activity.ownParticipation
				? "学院已登记你的参与，可在“我的参与”查看审核进度和退回原因。"
				: "参加名单由学院统一登记；登记后这里会显示你的参与记录。"
			: !activity.publishedAt
				? withdrawn
					? "活动已撤回，学生暂时看不到。核对内容后可重新发布。"
					: "发布后，范围内学生才能看到。修改分值、计分项或范围会自动撤回发布。"
				: ended
					? activity.endedAt
						? `活动已于 ${dateText(activity.endedAt)} 结束，不再出现在学生“最新活动”中；参与记录、审核和成绩不受影响。`
						: "活动已结束，不再出现在学生“最新活动”中；参与记录和审核不受影响。"
					: !activity.rosterCommitted
						? "导入参与名单后进入辅导员审核，审核通过才计分。"
						: "名单已提交；可补录或更正名单，撤回后学生立即看不到。";
	async function openPublish() {
		if (!activity.audience) return;
		setBusy(true);
		setError("");
		try {
			setPublishPreview(
				await requestJson<AudiencePreview>("/api/activities/audience", {
					action: "preview",
					termId: term.id,
					audience: activity.audience,
				}),
			);
			setPublishing(true);
		} catch (err) {
			setError((err as Error).message);
		} finally {
			setBusy(false);
		}
	}
	const rosterHref = `/imports?kind=participation&termId=${term.id}&activityId=${activity.id}`;
	const nextStep = !active
		? null
		: !activity.publishedAt
			? owner
				? {
						label: withdrawn ? "重新发布" : "发布活动",
						run: openPublish,
					}
				: null
			: owner
				? {
						label: activity.rosterCommitted ? "补录或更正名单" : "导入参与名单",
						href: rosterHref,
					}
				: null;
	const params = useSearchParams();
	const requestedTab = params.get("tab");
	const initialTab =
		(requestedTab === "participants" && canSeeParticipation) ||
		(requestedTab === "evidence" && canSeeEvidence) ||
		(requestedTab === "participation" && !!activity.ownParticipation)
			? requestedTab
			: params.has("participantPage") ||
				  params.has("participantQ") ||
				  params.has("participantStatus") ||
				  params.has("participantRemoved")
				? "participants"
				: "overview";
	const [publishPreview, setPublishPreview] = useState<AudiencePreview | null>(
		null,
	);
	const [publishing, setPublishing] = useState(false);
	const [unpublish, setUnpublish] = useState(false);
	const [ending, setEnding] = useState<"end" | "reopen" | null>(null);
	const [correct, setCorrect] = useState(false);
	const [participantsVersion, setParticipantsVersion] = useState(0);
	return (
		<>
			<div className="flex min-w-0 max-w-full flex-col gap-4 py-4">
				<div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
					<div className="flex min-w-0 items-center gap-4">
						<Avatar className="size-16">
							<AvatarFallback>{activity.name.slice(0, 1)}</AvatarFallback>
						</Avatar>
						<div className="flex min-w-0 flex-col gap-2">
							<h1 className="break-words text-xl font-semibold sm:text-2xl">
								{activity.name}
							</h1>
							<p className="text-sm text-muted-foreground">
								{term.name} · {activity.organizer}
							</p>
							<div className="flex flex-wrap items-center gap-2">
								<Badge variant="outline">
									周期 · {phaseLabels[term.phase]}
								</Badge>
								<Badge variant={activity.publishedAt ? "default" : "secondary"}>
									{statusLabel}
								</Badge>
								<span className="text-xs text-muted-foreground">
									{activity.college?.name || "主办学院未设置"}
								</span>
							</div>
							{user.role === "PUBLISHER" && !activity.college && (
								<p className="max-w-2xl text-sm text-muted-foreground">
									该活动尚未设置主办学院。请联系管理员在活动详情中移交，之后才能维护参与记录、活动得分和证明。
								</p>
							)}
						</div>
					</div>
					<div className="flex items-center gap-2">
						<Link
							href={returnHref || `/activities?termId=${term.id}`}
							className={buttonVariants({ variant: "outline", size: "sm" })}
						>
							返回列表
						</Link>
					</div>
				</div>
				<Feedback error={error} success={success} />
				<Tabs
					className="min-h-0 min-w-0 max-w-full flex-1 gap-0"
					defaultValue={initialTab}
				>
					{visibleTabCount > 1 && (
						<div className="scrollbar-none touch-pan-x overflow-x-auto overscroll-x-contain border-y">
							<TabsList
								variant="line"
								className="w-max min-w-full justify-start gap-4"
							>
								<TabsTrigger value="overview">活动详情</TabsTrigger>
								{canSeeParticipation && (
									<TabsTrigger value="participants">参与名单</TabsTrigger>
								)}
								{canSeeEvidence && (
									<TabsTrigger value="evidence">活动证明</TabsTrigger>
								)}
								{activity.ownParticipation && (
									<TabsTrigger value="participation">我的参与</TabsTrigger>
								)}
							</TabsList>
						</div>
					)}
					<div className="min-w-0 max-w-full">
						<TabsContent value="overview">
							<div className="grid min-w-0 lg:grid-cols-[minmax(0,1fr)_auto_18rem]">
								<div className="flex min-w-0 flex-col gap-5 py-4 lg:pr-6">
									<section className="flex flex-col gap-2">
										<h2 className="font-medium text-base">活动介绍</h2>
										<MarkdownContent markdown={activity.content} />
										{!!activity.attachments?.filter((item) => item.kind !== "IMAGE").length && (
											<div className="mt-2 flex flex-col gap-2 rounded-md border bg-muted/20 p-3">
												<p className="text-xs text-muted-foreground">附件</p>
												{activity.attachments.filter((item) => item.kind !== "IMAGE").map((item) => (
													<a key={item.id} className="flex items-center justify-between gap-3 text-sm hover:underline" href={item.url} target="_blank" rel="noopener noreferrer">
														<span className="min-w-0 truncate">{item.name}</span>
														<span className="shrink-0 text-xs text-muted-foreground">{formatBytes(item.size)}</span>
													</a>
												))}
											</div>
										)}
									</section>
									<Separator />
									<section className="flex flex-col gap-2">
										<h2 className="font-medium text-base">活动信息</h2>
										<dl className="grid gap-8 sm:grid-cols-2 xl:grid-cols-3">
											{[
												["主办学院", activity.college?.name || "未设置"],
												["组织单位", activity.organizer],
												["开始时间", dateText(activity.startsAt)],
												["结束时间", dateText(activity.endsAt)],
												...(activity.endedAt
													? [["实际结束", dateText(activity.endedAt)]]
													: []),
											].map(([label, value]) => (
												<div key={label} className="flex flex-col gap-1">
													<dt className="text-xs text-muted-foreground">
														{label}
													</dt>
													<dd className="break-words text-sm">{value}</dd>
												</div>
											))}
										</dl>
									</section>
									{user.role !== "STUDENT" && activity.audience && (
										<section className="flex flex-col gap-3">
											<Separator />
											<h2 className="text-base font-medium">发布范围</h2>
											<p className="text-sm">
												范围方式：{scopeLabels[activity.audience.scope]}
											</p>
											{activity.audience.scope === "COLLEGE" && (
												<p className="text-sm">
													学院：
													{activity.audience.colleges.join("、") ||
														"尚未选择"}
												</p>
											)}
											{activity.audience.scope === "CLASS" && (
												<p className="text-sm">
													班级：
													{activity.audience.classes
														.map(classLabel)
														.join("；") || "尚未选择"}
												</p>
											)}
											<p className="text-sm">
												{activity.audience.scope === "ALL"
													? "全校在籍学生均可查看并参与。"
													: activity.audience.scope === "COLLEGE"
														? "所选学院的在籍学生均可查看并参与；多选学院为并集。"
														: "所选班级的在籍学生均可查看并参与；多选班级为并集。"}
											</p>
										</section>
									)}
								</div>
								<Separator orientation="vertical" className="hidden lg:block" />
								<div className="flex min-w-0 max-w-full flex-col gap-4 py-4 lg:pl-6">
									<h2 className="font-medium text-base">活动得分</h2>
									<div>
										<p className="text-xs text-muted-foreground">
											活动分值
										</p>
										<p className="mt-1 text-3xl tabular-nums">
											{activity.points}
											<span className="ml-2 text-sm">分</span>
										</p>
									</div>
									<p className="text-sm text-muted-foreground">
										{
											term.scheme.nodes.find((n) => n.id === activity.nodeId)
												?.name
										}
									</p>
									<div className="flex flex-col gap-1 rounded-md border bg-muted/40 p-3">
										<p className="text-xs text-muted-foreground">当前状态</p>
										<p className="text-sm font-medium">{statusLabel}</p>
										<p className="text-xs leading-5 text-muted-foreground">{statusHint}</p>
										{!active && user.role !== "STUDENT" && (
											<p className="text-xs text-muted-foreground">
												当前阶段或周期状态只读，需管理员重开后才能操作。
											</p>
										)}
									</div>
									{nextStep &&
										("href" in nextStep && nextStep.href ? (
											<Link href={nextStep.href} className={buttonVariants()}>
												{nextStep.label}
											</Link>
										) : (
											<Button disabled={busy} onClick={nextStep.run}>
												{nextStep.label}
											</Button>
										))}
									{canEnd && (
										<Button
											variant="outline"
											disabled={busy}
											onClick={() => {
												setError("");
												setEnding("end");
											}}
										>
											结束活动
										</Button>
									)}
									{canReopen && (
										<Button
											variant="outline"
											disabled={busy}
											onClick={() => {
												setError("");
												setEnding("reopen");
											}}
										>
											重新开放活动
										</Button>
									)}
									{active && (owner || user.role === "ADMIN") && (
										<DropdownMenu>
											<DropdownMenuTrigger render={<Button variant="outline" />}>
												更多操作
												<MoreHorizontal />
											</DropdownMenuTrigger>
											<DropdownMenuContent align="end" className="w-48">
												{owner && activity.publishedAt && (
													<DropdownMenuLinkItem render={<Link href={rosterHref} />}>
														{activity.rosterCommitted ? "补录或更正名单" : "导入参与名单"}
													</DropdownMenuLinkItem>
												)}
												{owner && (
													<DropdownMenuItem
														onClick={() => {
															setError("");
															setIds([]);
															setEvidenceOpen(true);
														}}
													>
														{activity.evidence?.some((row) => row.active)
															? "更换活动证明"
															: "上传活动证明"}
													</DropdownMenuItem>
												)}
												{(owner || user.role === "ADMIN") && (
													<DropdownMenuItem onClick={() => setEdit(true)}>
														编辑活动信息
													</DropdownMenuItem>
												)}
												{user.role === "ADMIN" && (
													<DropdownMenuItem onClick={() => setReassignOpen(true)}>
														移交主办学院
													</DropdownMenuItem>
												)}
												{user.role === "ADMIN" && activity.publishedAt && (
													<DropdownMenuItem onClick={() => setCorrect(true)}>
														预览得分更正
													</DropdownMenuItem>
												)}
												{owner && activity.publishedAt && (
													<>
														<DropdownMenuSeparator />
														<DropdownMenuItem
															variant="destructive"
															disabled={busy}
															onClick={() => setUnpublish(true)}
														>
															撤回活动
														</DropdownMenuItem>
													</>
												)}
											</DropdownMenuContent>
										</DropdownMenu>
									)}
									{!(user.role === "PUBLISHER" && !owner) && (
										<Link
											href={`/recognitions?termId=${term.id}`}
											className={buttonVariants({ variant: "ghost" })}
										>
											查看参与记录
										</Link>
									)}
								</div>
							</div>
						</TabsContent>
						{canSeeParticipation && (
							<TabsContent value="participants" className="py-4">
								<ActivityParticipants
									key={`${activity.id}-${activity.revision}-${participantsVersion}`}
									activityId={activity.id}
									termId={term.id}
									canManage={owner}
									active={active}
									points={activity.points}
									hostCollege={activity.college?.name || null}
									rosterCommitted={!!activity.rosterCommitted}
								/>
							</TabsContent>
						)}
						{canSeeEvidence && (
							<TabsContent value="evidence" className="py-4">
								<section className="flex flex-col gap-4">
									<div className="flex flex-wrap items-end justify-between gap-3">
										<div>
											<h2 className="text-base font-medium">活动证明</h2>
											<p className="mt-1 text-sm text-muted-foreground">
												{user.role === "STUDENT"
													? "主办学院上传的活动证明，仅供已登记参加本活动的学生查看和下载当前有效版本。"
													: "同一活动共用一份有效证明。更换后，按旧证明通过的活动参与会重新进入审核。"}
											</p>
										</div>
										{owner && (
											<Button
												variant="outline"
												onClick={() => {
													setError("");
													setIds([]);
													setEvidenceOpen(true);
												}}
											>
												上传新证明
											</Button>
										)}
									</div>
									<div className="flex flex-col gap-3">
										{activity.evidence?.length ? (
											activity.evidence.map((row) => (
												<div
													key={row.id}
													className="flex flex-col gap-2 rounded-lg border p-4"
												>
													<div className="flex flex-wrap items-center justify-between gap-2">
														<p className="text-sm font-medium">
															第 {row.version} 版 · {row.note}
														</p>
														<Badge variant={row.active ? "default" : "outline"}>
															{row.active ? "当前有效" : "历史版本"}
														</Badge>
													</div>
													<p className="text-xs text-muted-foreground">
														上传于 {dateText(row.createdAt)}
													</p>
													<EvidenceViewer evidence={row.evidence} />
												</div>
											))
										) : (
											<p className="text-sm text-muted-foreground">
												{user.role === "STUDENT"
													? "主办学院尚未上传活动证明。"
													: "尚未上传活动证明。导入参与名单前请先上传。"}
											</p>
										)}
									</div>
								</section>
							</TabsContent>
						)}
						{activity.ownParticipation && (
							<TabsContent value="participation">
								<OwnParticipation
									participation={activity.ownParticipation}
									points={activity.points}
								/>
							</TabsContent>
						)}
					</div>
				</Tabs>
			</div>
			<Dialog
				open={edit}
				onOpenChange={(value) => {
					if (
						!value &&
						hasUnsavedChanges() &&
						!window.confirm("放弃尚未保存的活动？")
					)
						return;
					setEdit(value);
				}}
			>
				<DialogContent className="sm:max-w-4xl">
					<DialogHeader>
						<DialogTitle>编辑活动</DialogTitle>
						<DialogDescription>
							修改分值、计分项或范围会自动撤回发布，需要重新发布。
						</DialogDescription>
					</DialogHeader>
					<ActivityForm
						term={term}
						activity={activity}
						role={user.role}
						colleges={colleges}
						limits={limits}
						onSaved={() => {
							setEdit(false);
							router.refresh();
						}}
					/>
				</DialogContent>
			</Dialog>
			{user.role === "ADMIN" &&
				(!term.disposition || term.disposition === "NORMAL") && (
					<ScoringCorrection
						key={`${activity.id}-${activity.revision}`}
						term={term}
						kind="activity"
						item={activity}
						open={correct}
						onOpenChange={setCorrect}
						onCommitted={() => {
							setCorrect(false);
							setSuccess("活动得分已更正，请重新核对并发布结果。");
							router.refresh();
						}}
					/>
				)}
			<Dialog
				open={evidenceOpen}
				onOpenChange={(value) => {
					if (
						!busy &&
						!uploading &&
						(value || !dirty || window.confirm("放弃尚未保存的活动证明？"))
					) {
						setDirty(false);
						setEvidenceOpen(value);
					}
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>上传活动证明</DialogTitle>
						<DialogDescription>
							活动证明由主办学院统一维护。新证明生效后，按旧证明通过的活动参与会重新进入审核。
						</DialogDescription>
					</DialogHeader>
					<form
						key={evidenceOpen ? "open" : "closed"}
						className="flex flex-col gap-5"
						onChange={() => setDirty(true)}
						onSubmit={async (e) => {
							e.preventDefault();
							if (busy || uploading || !active || ids.length !== 1) return;
							setBusy(true);
							setError("");
							const f = new FormData(e.currentTarget);
							try {
								await requestJson("/api/activities", {
									action: "evidence",
									termId: term.id,
									activityId: activity.id,
									revision: activity.revision,
									evidenceId: ids[0],
									note: f.get("note"),
									reason: f.get("reason") || undefined,
								});
								setDirty(false);
								setEvidenceOpen(false);
								setIds([]);
								setSuccess("活动证明已保存为当前有效版本。");
								setParticipantsVersion((version) => version + 1);
								router.refresh();
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
								<FieldLabel htmlFor="activity-evidence-note">
									证明说明
								</FieldLabel>
								<Textarea
									id="activity-evidence-note"
									name="note"
									required
									maxLength={500}
									rows={3}
									placeholder="说明证明对应的活动场次、名单或成绩"
								/>
								<FieldDescription>
									该说明会展示给参加活动的学生，请勿填写内部备注。
								</FieldDescription>
							</Field>
							{activity.evidence?.some((row) => row.active) && (
								<Field>
									<FieldLabel htmlFor="activity-evidence-reason">
										更换原因
									</FieldLabel>
									<Textarea
										id="activity-evidence-reason"
										name="reason"
										required
										minLength={2}
										maxLength={1000}
										rows={3}
									/>
								</Field>
							)}
							<EvidenceUpload onChange={setIds} onBusy={setUploading} limits={evidenceLimits} />
							{ids.length > 1 && (
								<p className="text-sm text-destructive">
									每次只能保存一份有效证明，请只保留一个文件。
								</p>
							)}
						</FieldGroup>
						<Button
							type="submit"
							disabled={busy || uploading || ids.length !== 1}
						>
							{busy ? "正在保存…" : "保存活动证明"}
						</Button>
					</form>
				</DialogContent>
			</Dialog>
			<Dialog
				open={reassignOpen}
				onOpenChange={(open) => {
					if (!busy) setReassignOpen(open);
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>移交活动主办学院</DialogTitle>
						<DialogDescription>
							移交后由新主办学院维护参与记录、活动得分和证明；已有参与和审核记录保留。
						</DialogDescription>
					</DialogHeader>
					<form
						className="flex flex-col gap-4"
						onSubmit={async (event) => {
							event.preventDefault();
							if (busy) return;
							setBusy(true);
							setError("");
							const form = new FormData(event.currentTarget);
							try {
								await requestJson("/api/activities", {
									action: "reassign",
									termId: term.id,
									id: activity.id,
									revision: activity.revision,
									collegeId: form.get("collegeId"),
									reason: form.get("reason"),
								});
								setReassignOpen(false);
								setSuccess("活动主办学院已移交。");
								router.refresh();
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
								<FieldLabel htmlFor="activity-reassign-college">
									新主办学院
								</FieldLabel>
								<SearchableSelect
									id="activity-reassign-college"
									name="collegeId"
									defaultValue={activity.collegeId || ""}
									required
									placeholder="选择学院"
									searchPlaceholder="搜索学院名称"
									options={colleges.map((college) => ({
										value: college.id,
										label: college.name,
									}))}
								/>
							</Field>
							<Field>
								<FieldLabel htmlFor="activity-reassign-reason">
									移交原因
								</FieldLabel>
								<Textarea
									id="activity-reassign-reason"
									name="reason"
									required
									minLength={2}
									maxLength={500}
									rows={3}
								/>
							</Field>
						</FieldGroup>
						<Button type="submit" disabled={busy}>确认移交</Button>
					</form>
				</DialogContent>
			</Dialog>
			<Dialog
				open={publishing}
				onOpenChange={(open) => {
					if (!busy) setPublishing(open);
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>确认范围并发布活动</DialogTitle>
						<DialogDescription>
							发布后，只有范围内的学生可以查看，发布即生效，无需管理员确认分值。
						</DialogDescription>
					</DialogHeader>
					<Feedback error={error || publishPreview?.errors.join(" ")} />
					{activity.audience && (
						<p className="text-sm">
							范围方式：
							<span className="font-medium">
								{scopeLabels[activity.audience.scope]}
							</span>
						</p>
					)}
					<dl className="grid grid-cols-2 gap-3 text-sm">
						{[
							["符合条件学生", publishPreview ? `${publishPreview.count} 人` : "—"],
							["涉及学院", publishPreview ? `${publishPreview.collegeCount} 个` : "—"],
							["涉及专业", publishPreview ? `${publishPreview.majorCount} 个` : "—"],
							["涉及班级", publishPreview ? `${publishPreview.classCount} 个` : "—"],
						].map(([label, value]) => (
							<div key={label} className="rounded-lg border p-3">
								<dt className="text-muted-foreground">{label}</dt>
								<dd className="text-xl tabular-nums">{value}</dd>
							</div>
						))}
					</dl>
					<p className="text-xs text-muted-foreground">
						这里只显示范围汇总，不显示学生名单。学生班级或活动范围变化后，需要重新核对。
					</p>
					<Button
						disabled={
							busy ||
							!publishPreview?.count ||
							!!publishPreview.errors.length
						}
						onClick={async () => {
							if (!publishPreview) return;
							setBusy(true);
							setError("");
							try {
								await requestJson("/api/activities", {
									action: "publish",
									termId: term.id,
									id: activity.id,
									revision: activity.revision,
								});
								setPublishing(false);
								setPublishPreview(null);
								setSuccess("活动已发布。");
								router.refresh();
							} catch (err) {
								setPublishPreview(null);
								setError((err as Error).message);
							} finally {
								setBusy(false);
							}
						}}
					>
						发布活动
					</Button>
				</DialogContent>
			</Dialog>
			<Dialog
				open={unpublish}
				onOpenChange={(open) => {
					if (!busy) setUnpublish(open);
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>撤回活动</DialogTitle>
						<DialogDescription>
							撤回后学生将看不到该活动，已登记的参与和审核记录保留。
						</DialogDescription>
					</DialogHeader>
					<form
						className="flex flex-col gap-4"
						onSubmit={async (event) => {
							event.preventDefault();
							if (busy) return;
							setBusy(true);
							setError("");
							const form = new FormData(event.currentTarget);
							try {
								await requestJson("/api/activities", {
									action: "unpublish",
									termId: term.id,
									id: activity.id,
									revision: activity.revision,
									reason: form.get("reason"),
								});
								setUnpublish(false);
								setSuccess("活动已撤回，历史参与保留。");
								router.refresh();
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
								<FieldLabel htmlFor="unpublish-reason">撤回原因</FieldLabel>
								<Textarea
									id="unpublish-reason"
									name="reason"
									minLength={2}
									maxLength={1000}
									required
								/>
							</Field>
						</FieldGroup>
						<Button type="submit" disabled={busy}>确认撤回</Button>
					</form>
				</DialogContent>
			</Dialog>
			<Dialog
				open={ending !== null}
				onOpenChange={(open) => {
					if (!busy && !open) setEnding(null);
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>
							{ending === "reopen" ? "重新开放活动" : "结束活动"}
						</DialogTitle>
						<DialogDescription>
							{ending === "reopen"
								? `活动会重新出现在符合条件学生的“最新活动”中，直到计划结束时间 ${dateText(activity.endsAt)}。`
								: `结束后，活动会立即从学生“最新活动”中移除；已登记的参与名单、审核记录和成绩不受影响。计划结束时间为 ${dateText(activity.endsAt)}。`}
						</DialogDescription>
					</DialogHeader>
					<Feedback error={error} />
					<Button
						disabled={busy}
						onClick={async () => {
							if (!ending) return;
							setBusy(true);
							setError("");
							try {
								await requestJson("/api/activities", {
									action: ending,
									termId: term.id,
									id: activity.id,
									revision: activity.revision,
								});
								setSuccess(
									ending === "reopen" ? "活动已重新开放。" : "活动已结束。",
								);
								setEnding(null);
								router.refresh();
							} catch (err) {
								setError((err as Error).message);
							} finally {
								setBusy(false);
							}
						}}
					>
						{busy
							? "正在处理…"
							: ending === "reopen"
								? "确认重新开放"
								: "确认结束活动"}
					</Button>
				</DialogContent>
			</Dialog>
		</>
	);
}
