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
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Feedback, requestJson } from "@/components/dashboard/feedback";
import { EvidenceUpload } from "@/components/dashboard/evidence-upload";
import { ActivityForm, type Activity } from "./activity-form";
import { dateText, phaseLabels, type AppRole } from "@/lib/business-labels";
import type { Scheme } from "@/lib/scoring/types";
import {
	ActivityParticipants,
	OwnParticipation,
} from "./activity-participants";
import { type AudiencePreview, classLabel } from "./audience-editor";
import { ScoringCorrection } from "@/components/dashboard/scoring-correction";
export function ActivityDetail({
	activity,
	term,
	user,
	returnHref,
}: {
	activity: Activity;
	term: {
		id: string;
		name: string;
		phase: string;
		revision: number;
		scheme: Scheme;
	};
	user: { id: string; role: AppRole };
	returnHref?: string;
}) {
	const [dirty, setDirty] = useState(false);
	useUnsavedChanges(dirty);
	const router = useRouter();
	const [edit, setEdit] = useState(false);
	const [submit, setSubmit] = useState(false);
	const [ids, setIds] = useState<string[]>([]);
	const [uploading, setUploading] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [success, setSuccess] = useState("");
	const active = term.phase === "ACTIVE";
	const owner = user.id === activity.ownerId && user.role !== "STUDENT";
	const params = useSearchParams();
	const [publishPreview, setPublishPreview] = useState<AudiencePreview | null>(
		null,
	);
	const [publishing, setPublishing] = useState(false);
	const [unpublish, setUnpublish] = useState(false);
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
							<div className="flex flex-wrap gap-2">
								<Badge variant="outline">{phaseLabels[term.phase]}</Badge>
								<Badge variant="outline">
									{activity.confirmed ? "分值已确认" : "分值待确认"}
								</Badge>
								<Badge variant="outline">
									{activity.publishedAt ? "已发布" : "草稿 / 已撤回"}
								</Badge>
							</div>
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
					defaultValue={
						params.has("participantPage") || params.has("participantQ")
							? "participants"
							: "overview"
					}
				>
					<div className="overflow-x-auto border-y">
						<TabsList
							variant="line"
							className="w-max min-w-full justify-start gap-4"
						>
							<TabsTrigger value="overview">活动详情</TabsTrigger>
							<TabsTrigger value="requirements">参加要求</TabsTrigger>
							{user.role !== "STUDENT" && (
								<TabsTrigger value="participants">
									参与名录与活动成绩
								</TabsTrigger>
							)}
							{activity.ownParticipation && (
								<TabsTrigger value="participation">本人参与与历史</TabsTrigger>
							)}
						</TabsList>
					</div>
					<div className="min-w-0 max-w-full">
						<TabsContent value="overview">
							<div className="grid min-w-0 lg:grid-cols-[minmax(0,1fr)_auto_18rem]">
								<div className="flex min-w-0 flex-col gap-5 py-4 lg:pr-6">
									<section className="flex flex-col gap-2">
										<h2 className="font-medium text-base">活动内容</h2>
										<p className="whitespace-pre-wrap text-sm leading-7">
											{activity.content}
										</p>
									</section>
									<Separator />
									<section className="flex flex-col gap-2">
										<h2 className="font-medium text-base">活动信息</h2>
										<dl className="grid gap-8 sm:grid-cols-2 xl:grid-cols-3">
											{[
												["组织单位", activity.organizer],
												["开始时间", dateText(activity.startsAt)],
												["结束时间", dateText(activity.endsAt)],
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
											<h2 className="text-base font-medium">已保存发布范围</h2>
											<p className="text-sm">
												学院：
												{activity.audience.colleges.join("、") || "尚未选择"}
											</p>
											<p className="text-sm">
												班级：
												{activity.audience.classes.map(classLabel).join("；") ||
													"尚未选择"}
											</p>
											<p className="text-sm">
												指定学生：{activity.audience.studentIds.length}{" "}
												人；三组同时满足才符合资格。
											</p>
										</section>
									)}
								</div>
								<Separator orientation="vertical" className="hidden lg:block" />
								<div className="flex min-w-0 max-w-full flex-col gap-4 py-4 lg:pl-6">
									<h2 className="font-medium text-base">参与认定</h2>
									<div>
										<p className="text-xs text-muted-foreground">
											{activity.scoreMode === "INDIVIDUAL"
												? "逐人录分上限"
												: "固定分值"}
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
									{active && (
										<>
											{(owner ||
												(user.role === "STUDENT" && activity.canSubmit)) && (
												<Button
													disabled={!activity.confirmed}
													onClick={() => {
														setError("");
														setIds([]);
														setSubmit(true);
													}}
												>
													{user.role === "STUDENT"
														? "提交本人申报"
														: "单人登记参与"}
												</Button>
											)}
											{owner && activity.confirmed && (
												<Link
													href={`/imports?kind=participation&termId=${term.id}&activityId=${activity.id}`}
													className={buttonVariants({ variant: "outline" })}
												>
													批量导入参与名单
												</Link>
											)}
											{user.role === "ADMIN" && !activity.confirmed && (
												<Button
													variant="outline"
													disabled={busy}
													onClick={async () => {
														setBusy(true);
														setError("");
														try {
															await requestJson("/api/activities", {
																termId: term.id,
																action: "confirm",
																id: activity.id,
																revision: activity.revision,
															});
															setSuccess("活动分值已确认。");
															router.refresh();
														} catch (err) {
															setError((err as Error).message);
														} finally {
															setBusy(false);
														}
													}}
												>
													确认活动分值
												</Button>
											)}
											{(owner || user.role === "ADMIN") && (
												<Button variant="outline" onClick={() => setEdit(true)}>
													编辑活动
												</Button>
											)}
											{owner && (
												<Button
													variant="outline"
													disabled={
														busy || !activity.confirmed || !activity.audience
													}
													onClick={async () => {
														if (!activity.audience) return;
														setBusy(true);
														setError("");
														try {
															setPublishPreview(
																await requestJson<AudiencePreview>(
																	"/api/activities/audience",
																	{
																		action: "preview",
																		termId: term.id,
																		audience: activity.audience,
																	},
																),
															);
															setPublishing(true);
														} catch (err) {
															setError((err as Error).message);
														} finally {
															setBusy(false);
														}
													}}
												>
													核对范围并发布
												</Button>
											)}
											{owner && activity.publishedAt && (
												<Button
													variant="outline"
													disabled={busy}
													onClick={() => setUnpublish(true)}
												>
													撤回活动发布
												</Button>
											)}
											{user.role === "ADMIN" && activity.confirmed && (
												<Button
													variant="outline"
													onClick={() => setCorrect(true)}
												>
													预览计分更正
												</Button>
											)}
										</>
									)}
									<Link
										href={`/recognitions?termId=${term.id}`}
										className={buttonVariants({ variant: "ghost" })}
									>
										查看认定记录
									</Link>
								</div>
							</div>
						</TabsContent>
						{user.role !== "STUDENT" && (
							<TabsContent value="participants" className="py-4">
								<ActivityParticipants
									key={`${activity.id}-${activity.revision}-${participantsVersion}`}
									activityId={activity.id}
									termId={term.id}
									owner={owner}
									active={active}
									individual={activity.scoreMode === "INDIVIDUAL"}
									points={activity.points}
								/>
							</TabsContent>
						)}
						{activity.ownParticipation && (
							<TabsContent value="participation">
								<OwnParticipation
									participation={activity.ownParticipation}
									individual={activity.scoreMode === "INDIVIDUAL"}
									points={activity.points}
								/>
							</TabsContent>
						)}
						<TabsContent value="requirements" className="py-4">
							<div className="flex flex-col gap-2">
								<h2 className="font-medium text-base">参加要求</h2>
								<p className="whitespace-pre-wrap text-sm leading-7 text-muted-foreground">
									{activity.requirements || "无额外要求"}
								</p>
							</div>
						</TabsContent>
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
				<DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-4xl">
					<DialogHeader>
						<DialogTitle>编辑活动</DialogTitle>
						<DialogDescription>
							已确认的分值与计分模块不能直接更改。
						</DialogDescription>
					</DialogHeader>
					<ActivityForm
						term={term}
						activity={activity}
						onSaved={() => {
							setEdit(false);
							router.refresh();
						}}
					/>
				</DialogContent>
			</Dialog>
			{user.role === "ADMIN" && (
				<ScoringCorrection
					key={`${activity.id}-${activity.revision}`}
					term={term}
					kind="activity"
					item={activity}
					open={correct}
					onOpenChange={setCorrect}
					onCommitted={() => {
						setCorrect(false);
						setSuccess("活动计分已更正，请重新核对并发布结果。");
						router.refresh();
					}}
				/>
			)}
			<Dialog
				open={submit}
				onOpenChange={(value) => {
					if (
						!busy &&
						!uploading &&
						(value || !dirty || window.confirm("放弃尚未提交的认定材料？"))
					) {
						setDirty(false);
						setSubmit(value);
					}
				}}
			>
				<DialogContent className="max-h-[90dvh] overflow-y-auto">
					<DialogHeader>
						<DialogTitle>
							{user.role === "STUDENT" ? "提交本人申报" : "单人登记参与"}
						</DialogTitle>
						<DialogDescription>
							提供参与事实与证明材料，审核通过后纳入测评。
						</DialogDescription>
					</DialogHeader>
					<form
						key={submit ? "open" : "closed"}
						className="flex flex-col gap-5"
						onChange={() => setDirty(true)}
						onSubmit={async (e) => {
							e.preventDefault();
							if (busy || uploading) return;
							setBusy(true);
							setError("");
							const f = new FormData(e.currentTarget);
							try {
								await requestJson("/api/activities", {
									action: "submit",
									termId: term.id,
									activityId: activity.id,
									studentLogin:
										user.role === "STUDENT" ? undefined : f.get("studentLogin"),
									note: f.get("note"),
									evidenceIds: ids,
								});
								setDirty(false);
								setSubmit(false);
								setSuccess("材料已提交，请等待审核。");
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
							{user.role !== "STUDENT" && (
								<Field>
									<FieldLabel htmlFor="recognition-student">
										学生学号
									</FieldLabel>
									<Input
										id="recognition-student"
										name="studentLogin"
										required
										maxLength={64}
									/>
								</Field>
							)}
							<Field>
								<FieldLabel htmlFor="recognition-note">参与说明</FieldLabel>
								<Textarea
									id="recognition-note"
									name="note"
									required
									maxLength={2000}
									rows={4}
								/>
							</Field>
							<EvidenceUpload onChange={setIds} onBusy={setUploading} />
						</FieldGroup>
						<Button type="submit" disabled={busy || uploading || !ids.length}>
							{busy ? "正在提交…" : "提交认定"}
						</Button>
					</form>
				</DialogContent>
			</Dialog>
			<Dialog
				open={publishing}
				onOpenChange={(open) => {
					if (!busy) setPublishing(open);
				}}
			>
				<DialogContent className="max-h-[90dvh] overflow-y-auto">
					<DialogHeader>
						<DialogTitle>核对范围并发布活动</DialogTitle>
						<DialogDescription>
							发布后仅当前有效身份命中三组交集的学生可浏览。活动分值确认与发布分别处理。
						</DialogDescription>
					</DialogHeader>
					<Feedback error={error || publishPreview?.errors.join(" ")} />
					<p className="text-2xl tabular-nums">
						交集 {publishPreview?.count ?? "—"} 人
					</p>
					{publishPreview?.students.map((student) => (
						<p key={student.id} className="text-sm">
							{student.name} · {student.login}
							<span className="block text-xs text-muted-foreground">
								{classLabel(student)}
							</span>
						</p>
					))}
					<p className="text-xs text-muted-foreground">
						最多展示前20人。学生归属或活动范围变化后，需要重新核对。
					</p>
					<Button
						disabled={
							busy ||
							!publishPreview?.token ||
							!publishPreview.count ||
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
									token: publishPreview.token,
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
						确认发布活动
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
						<DialogTitle>撤回活动发布</DialogTitle>
						<DialogDescription>
							撤回后不再出现在活动信息流，已登记参与和历史仍保留。
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
								setSuccess("活动发布已撤回，历史参与保留。");
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
								<FieldLabel htmlFor="unpublish-reason">撤回理由</FieldLabel>
								<Textarea
									id="unpublish-reason"
									name="reason"
									minLength={2}
									maxLength={1000}
									required
								/>
							</Field>
						</FieldGroup>
						<Button disabled={busy}>确认撤回发布</Button>
					</form>
				</DialogContent>
			</Dialog>
		</>
	);
}
