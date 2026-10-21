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
import {
	NativeSelect,
	NativeSelectOption,
} from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Feedback, requestJson } from "@/components/dashboard/feedback";
import { EvidenceUpload } from "@/components/dashboard/evidence-upload";
import { EvidenceViewer } from "@/components/dashboard/evidence-viewer";
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
	colleges = [],
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
									{activity.college?.name || "主办学院未设置"}
								</Badge>
								<Badge variant="outline">
									{activity.confirmed ? "分值已确认" : "分值未确认"}
								</Badge>
								<Badge variant="outline">
									{activity.publishedAt ? "已发布" : "未发布"}
								</Badge>
								<Badge variant="outline">
									{activity.rosterCommitted ? "名单已保存" : "名单待提交"}
								</Badge>
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
					defaultValue={
						params.has("participantPage") ||
						params.has("participantQ") ||
						params.has("participantStatus") ||
						params.has("participantRemoved")
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
							{canSeeParticipation && (
									<TabsTrigger value="participants">
										参与名单
									</TabsTrigger>
								)}
							{canSeeParticipation && (
									<TabsTrigger value="evidence">活动证明</TabsTrigger>
								)}
							{activity.ownParticipation && (
								<TabsTrigger value="participation">我的参与</TabsTrigger>
							)}
						</TabsList>
					</div>
					<div className="min-w-0 max-w-full">
						<TabsContent value="overview">
							<div className="grid min-w-0 lg:grid-cols-[minmax(0,1fr)_auto_18rem]">
								<div className="flex min-w-0 flex-col gap-5 py-4 lg:pr-6">
									<section className="flex flex-col gap-2">
										<h2 className="font-medium text-base">活动介绍</h2>
										<p className="whitespace-pre-wrap text-sm leading-7">
											{activity.content}
										</p>
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
												人。学院、班级和指定学生需同时满足。
											</p>
										</section>
									)}
								</div>
								<Separator orientation="vertical" className="hidden lg:block" />
								<div className="flex min-w-0 max-w-full flex-col gap-4 py-4 lg:pl-6">
									<h2 className="font-medium text-base">活动得分</h2>
									<div>
										<p className="text-xs text-muted-foreground">
											{activity.scoreMode === "INDIVIDUAL"
												? "每人单独录分"
												: "统一分值"}
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
											{owner && (
												<Button
													variant="outline"
													onClick={() => {
														setError("");
														setIds([]);
														setEvidenceOpen(true);
													}}
												>
													{activity.evidence?.some((row) => row.active)
														? "更换证明"
														: "上传证明"}
												</Button>
											)}
											{owner && activity.confirmed && (
												<Link
													href={`/imports?kind=participation&termId=${term.id}&activityId=${activity.id}`}
													className={buttonVariants({ variant: "outline" })}
												>
													{activity.rosterCommitted
														? "补录或更正名单"
														: "导入参与名单"}
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
													确认分值
												</Button>
											)}
											{(owner || user.role === "ADMIN") && (
												<Button variant="outline" onClick={() => setEdit(true)}>
													编辑活动
												</Button>
											)}
											{user.role === "ADMIN" && (
												<Button variant="outline" onClick={() => setReassignOpen(true)}>
													移交主办学院
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
													确认范围并发布
												</Button>
											)}
											{owner && activity.publishedAt && (
												<Button
													variant="outline"
													disabled={busy}
													onClick={() => setUnpublish(true)}
												>
													撤回活动
												</Button>
											)}
											{user.role === "ADMIN" && activity.confirmed && (
												<Button
													variant="outline"
													onClick={() => setCorrect(true)}
												>
													预览得分更正
												</Button>
											)}
										</>
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
									individual={activity.scoreMode === "INDIVIDUAL"}
									points={activity.points}
									hostCollege={activity.college?.name || null}
									rosterCommitted={!!activity.rosterCommitted}
								/>
							</TabsContent>
						)}
						{canSeeParticipation && (
							<TabsContent value="evidence" className="py-4">
								<section className="flex flex-col gap-4">
									<div className="flex flex-wrap items-end justify-between gap-3">
										<div>
											<h2 className="text-base font-medium">活动证明</h2>
											<p className="mt-1 text-sm text-muted-foreground">
												同一活动共用一份有效证明。更换后，按旧证明通过的活动参与会重新进入审核。
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
												尚未上传活动证明。导入参与名单前请先上传。
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
							已确认的分值和计分项不能直接更改。
						</DialogDescription>
					</DialogHeader>
					<ActivityForm
						term={term}
						activity={activity}
						role={user.role}
						colleges={colleges}
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
				<DialogContent className="max-h-[90dvh] overflow-y-auto">
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
							<EvidenceUpload onChange={setIds} onBusy={setUploading} />
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
								<NativeSelect
									id="activity-reassign-college"
									name="collegeId"
									defaultValue={activity.collegeId || ""}
									required
								>
									<NativeSelectOption value="">选择学院</NativeSelectOption>
									{colleges.map((college) => (
										<NativeSelectOption key={college.id} value={college.id}>
											{college.name}
										</NativeSelectOption>
									))}
								</NativeSelect>
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
				<DialogContent className="max-h-[90dvh] overflow-y-auto">
					<DialogHeader>
						<DialogTitle>确认范围并发布活动</DialogTitle>
						<DialogDescription>
							发布后，只有同时符合学院、班级和指定学生范围的学生可以查看。分值确认和发布是两个步骤。
						</DialogDescription>
					</DialogHeader>
					<Feedback error={error || publishPreview?.errors.join(" ")} />
					<p className="text-2xl tabular-nums">
						符合条件 {publishPreview?.count ?? "—"} 人
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
						仅展示前 20 人。学生班级或活动范围变化后，需要重新核对。
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
		</>
	);
}
