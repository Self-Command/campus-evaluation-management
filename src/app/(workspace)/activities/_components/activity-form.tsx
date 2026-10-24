"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel, FieldDescription } from "@/components/ui/field";
import { SearchableSelect } from "@/components/dashboard/searchable-select";
import { Feedback, requestJson } from "@/components/dashboard/feedback";
import { TemplateEditor } from "@/components/dashboard/template-editor";
import {
	Card,
	CardHeader,
	CardTitle,
	CardDescription,
	CardContent,
} from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUnsavedChanges } from "@/components/dashboard/use-unsaved-changes";
import { Separator } from "@/components/ui/separator";
import { RichTextEditor, type AttachmentItem, type UploadLimits } from "@/components/dashboard/rich-text-editor";
import {
	AudienceEditor,
	audienceSummary,
	emptyAudience,
	type Audience,
	type AudiencePreview,
} from "./audience-editor";
import type { Scheme } from "@/lib/scoring/types";
import type { AppRole } from "@/lib/business-labels";
export type Activity = {
	id: string;
	termId: string;
	ownerId: string;
	collegeId?: string | null;
	college?: { id: string; name: string; code?: string } | null;
	name: string;
	organizer: string;
	content: string;
	attachments?: AttachmentItem[];
	startsAt: string;
	endsAt: string;
	nodeId: string;
	points: string;
	confirmed: boolean;
	revision: number;
	publishedAt?: string | null;
	endedAt?: string | null;
	publishRevision?: number;
	audience?: Audience | null;
	canManage?: boolean;
	canReview?: boolean;
	rosterCommitted?: boolean;
	rosterRevision?: number;
	evidence?: {
		id: string;
		version: number;
		active: boolean;
		uploadedBy: string;
		note: string;
		createdAt: string;
		evidence: { id: string; name: string; mime: string; size: number };
	}[];
	canSubmit?: boolean;
	ownParticipation?: {
		id: string;
		registeredAt: string;
		registrationSnapshot: Record<string, unknown> | null;
		removedAt?: string | null;
		removalReason?: string | null;
		revision: number;
		sources: {
			id: string;
			status: string;
			evidence?: {
				evidence: { id: string; name: string; mime: string; size: number };
			}[];
			reviewReason?: string | null;
			createdAt?: string;
			history?: {
				action: string;
				at: string;
				reason?: string;
				before?: unknown;
				after?: unknown;
			}[];
		}[];
		history?: {
			action: string;
			at: string;
			reason?: string;
			before?: unknown;
			after?: unknown;
		}[];
	} | null;
};
function localTime(value?: string) {
	if (!value) return "";
	const date = new Date(value);
	return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
		.toISOString()
		.slice(0, 16);
}
export function ActivityForm({
	term,
	activity,
	role,
	colleges = [],
	limits,
	onSaved,
}: {
	term: { id: string; phase: string; disposition?: string; scheme: Scheme };
	activity?: Activity;
	role?: AppRole;
	colleges?: { id: string; name: string; code?: string }[];
	limits: UploadLimits;
	onSaved: (id: string) => void;
}) {
	const writable =
		term.phase === "ACTIVE" &&
		(!term.disposition || term.disposition === "NORMAL");
	const [dirty, setDirty] = useState(false);
	useUnsavedChanges(dirty);
	const [draft, setDraft] = useState({
		name: activity?.name || "活动名称",
		organizer: activity?.organizer || "组织单位",
		points: activity?.points || "—",
	});
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [audience, setAudience] = useState<Audience>(() => {
		if (activity?.audience) return activity.audience;
		if (role === "COLLEGE" && colleges.length === 1)
			return {
				scope: "COLLEGE",
				colleges: [colleges[0].name],
				classes: [],
			};
		return emptyAudience;
	});
	const [audiencePreview, setAudiencePreview] =
		useState<AudiencePreview | null>(null);
	const [checking, setChecking] = useState(false);
	return (
		<form
			className="flex flex-col gap-5"
			onChange={(e) => {
				setDirty(true);
				const form = e.currentTarget;
				setDraft({
					name:
						(form.elements.namedItem("name") as HTMLInputElement)?.value ||
						"活动名称",
					organizer:
						(form.elements.namedItem("organizer") as HTMLInputElement)?.value ||
						"组织单位",
					points:
						(form.elements.namedItem("points") as HTMLInputElement)?.value ||
						activity?.points ||
						"—",
				});
			}}
			onSubmit={async (e) => {
				e.preventDefault();
				if (busy || !writable) return;
				const f = new FormData(e.currentTarget);
				if (role === "ADMIN" && !activity && !f.get("collegeId"))
					return setError("请选择主办学院");
				if (!f.get("nodeId")) return setError("请选择计分项");
				setBusy(true);
				setError("");
				try {
					const result = await requestJson<{ id: string }>("/api/activities", {
						action: "save",
						termId: term.id,
						id: activity?.id,
						revision: activity?.revision,
						activity: {
							name: f.get("name"),
							organizer: f.get("organizer"),
							content: f.get("content"),
							nodeId: f.get("nodeId"),
							points: f.get("points"),
							audience,
							...(role === "ADMIN" ? { collegeId: f.get("collegeId") || undefined } : {}),
							startsAt: new Date(String(f.get("startsAt"))).toISOString(),
							endsAt: new Date(String(f.get("endsAt"))).toISOString(),
						},
						attachmentIds: f.getAll("attachmentIds").map(String),
					});
					setDirty(false);
					onSaved(result.id);
				} catch (err) {
					setError((err as Error).message);
					setBusy(false);
				}
			}}
		>
			<Feedback error={error} />
			<TemplateEditor
				preview={
					<Card>
						<CardHeader>
							<CardTitle>{draft.name}</CardTitle>
							<CardDescription>{draft.organizer}</CardDescription>
						</CardHeader>
						<CardContent className="flex flex-col gap-4">
							<p className="text-sm text-muted-foreground">活动得分</p>
							<p className="text-3xl tabular-nums">{draft.points} 分</p>
							<p className="text-sm text-muted-foreground">
								保存后核对范围并发布，发布后学生即可看到。
							</p>
							<Separator />
							<p className="text-sm font-medium">符合条件人数</p>
							<p className="text-3xl tabular-nums">
								{audiencePreview ? `${audiencePreview.count} 人` : "未核对"}
							</p>
							<p className="text-sm text-muted-foreground">
								{audienceSummary(audience)}。所有参与者按此分值计分。
							</p>
							<Feedback error={audiencePreview?.errors.join(" ")} />
							{audiencePreview && (
								<dl className="grid grid-cols-3 gap-3 text-sm">
									{[
										["学院", audiencePreview.collegeCount],
										["专业", audiencePreview.majorCount],
										["班级", audiencePreview.classCount],
									].map(([label, value]) => (
										<div key={label} className="rounded-lg border p-3">
											<dt className="text-muted-foreground">{label}</dt>
											<dd className="text-xl tabular-nums">{value}</dd>
										</div>
									))}
								</dl>
							)}
							{audiencePreview && (
								<p className="text-xs text-muted-foreground">
									这里只显示范围汇总，不显示学生名单。
								</p>
							)}
							<Button
								type="button"
								variant="outline"
								disabled={checking || busy}
								onClick={async () => {
									setChecking(true);
									setError("");
									try {
										setAudiencePreview(
											await requestJson<AudiencePreview>(
												"/api/activities/audience",
												{ action: "preview", termId: term.id, audience },
											),
										);
									} catch (err) {
										setError((err as Error).message);
										setAudiencePreview(null);
									} finally {
										setChecking(false);
									}
								}}
							>
								{checking ? "正在核对…" : "核对范围"}
							</Button>
						</CardContent>
					</Card>
				}
			>
				<Tabs value="activity">
					<TabsList className="w-full">
						<TabsTrigger value="activity">活动信息</TabsTrigger>
					</TabsList>
				</Tabs>
				<FieldGroup>
					{[
						["name", "活动名称", 120],
						["organizer", "组织单位", 120],
					].map(([key, label, max]) => (
						<Field key={key}>
							<FieldLabel htmlFor={`activity-${key}`}>{label}</FieldLabel>
							<Input
								id={`activity-${key}`}
								name={String(key)}
								defaultValue={activity?.[key as "name"]}
								required
								maxLength={Number(max)}
							/>
						</Field>
					))}
					<div className="grid gap-5 sm:grid-cols-2">
						{[
							["startsAt", "开始时间"],
							["endsAt", "结束时间"],
						].map(([key, label]) => (
							<Field key={key}>
								<FieldLabel htmlFor={`activity-${key}`}>{label}</FieldLabel>
								<Input
									id={`activity-${key}`}
									name={key}
									type="datetime-local"
									defaultValue={localTime(activity?.[key as "startsAt"])}
									required
								/>
							</Field>
						))}
					</div>
					<div className="grid gap-5 sm:grid-cols-2">
						<Field>
							<FieldLabel htmlFor="activity-college">主办学院</FieldLabel>
							{role === "ADMIN" && !activity ? (
								<SearchableSelect
									id="activity-college"
									name="collegeId"
									options={colleges.map((college) => ({
										value: college.id,
										label: college.name,
										description: college.code,
									}))}
									placeholder="选择主办学院"
									searchPlaceholder="搜索学院名称或编码"
								/>
							) : (
								<p className="flex min-h-9 items-center text-sm">
									{activity?.college?.name ||
										(role === "ADMIN"
											? "未设置，请在详情中移交"
											: "保存后归入当前学院")}
								</p>
							)}
							<FieldDescription>
								参与记录由主办学院维护，学生所在学院负责审核。
							</FieldDescription>
						</Field>
						<Field>
							<FieldLabel htmlFor="activity-node">计分项</FieldLabel>
							<SearchableSelect
								id="activity-node"
								name="nodeId"
								defaultValue={activity?.nodeId}
								placeholder="选择计分项"
								searchPlaceholder="搜索计分项"
								options={term.scheme.nodes
									.filter((n) => n.kind === "ACTIVITY")
									.map((n) => ({ value: n.id, label: n.name }))}
							/>
						</Field>
						<Field>
							<FieldLabel htmlFor="activity-points">活动分值</FieldLabel>
							<Input
								id="activity-points"
								name="points"
								inputMode="decimal"
								defaultValue={activity?.points}
								required
							/>
						</Field>
					</div>
					<Field>
						<FieldLabel htmlFor="activity-content">活动介绍</FieldLabel>
						<RichTextEditor
							name="content"
							defaultValue={activity?.content || ""}
							activityId={activity?.id}
							limits={limits}
							initialAttachments={activity?.attachments || []}
							disabled={!writable}
						/>
					</Field>
				</FieldGroup>
				<Separator />
				<AudienceEditor
					termId={term.id}
					value={audience}
					disabled={busy || checking}
					onChange={(next) => {
						setAudience(next);
						setDirty(true);
						setAudiencePreview(null);
					}}
				/>
			</TemplateEditor>
			<Button type="submit" disabled={busy || !writable}>
				{busy ? "正在保存…" : "保存活动"}
			</Button>
		</form>
	);
}
