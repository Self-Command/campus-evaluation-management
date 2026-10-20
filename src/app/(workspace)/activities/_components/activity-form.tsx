"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
	NativeSelect,
	NativeSelectOption,
} from "@/components/ui/native-select";
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
import {
	AudienceEditor,
	emptyAudience,
	type Audience,
	type AudiencePreview,
} from "./audience-editor";
import type { Scheme } from "@/lib/scoring/types";
export type Activity = {
	id: string;
	termId: string;
	ownerId: string;
	name: string;
	organizer: string;
	content: string;
	requirements: string;
	startsAt: string;
	endsAt: string;
	nodeId: string;
	points: string;
	confirmed: boolean;
	revision: number;
	publishedAt?: string | null;
	publishRevision?: number;
	scoreMode?: "FIXED" | "INDIVIDUAL";
	audience?: Audience | null;
	canSubmit?: boolean;
	ownParticipation?: {
		id: string;
		registeredAt: string;
		registrationSnapshot: Record<string, unknown> | null;
		score: string | null;
		revision: number;
		sources: {
			id: string;
			status: string;
			reviewReason?: string | null;
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
	onSaved,
}: {
	term: { id: string; scheme: Scheme };
	activity?: Activity;
	onSaved: (id: string) => void;
}) {
	const [dirty, setDirty] = useState(false);
	useUnsavedChanges(dirty);
	const [draft, setDraft] = useState({
		name: activity?.name || "活动名称",
		organizer: activity?.organizer || "组织单位",
		points: activity?.points || "—",
	});
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [audience, setAudience] = useState<Audience>(
		activity?.audience || emptyAudience,
	);
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
				if (busy) return;
				const f = new FormData(e.currentTarget);
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
							requirements: f.get("requirements"),
							nodeId: activity?.confirmed ? activity.nodeId : f.get("nodeId"),
							points: activity?.confirmed ? activity.points : f.get("points"),
							scoreMode: activity?.confirmed
								? activity.scoreMode || "FIXED"
								: f.get("scoreMode"),
							audience,
							startsAt: new Date(String(f.get("startsAt"))).toISOString(),
							endsAt: new Date(String(f.get("endsAt"))).toISOString(),
						},
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
							<p className="text-sm text-muted-foreground">认定分值</p>
							<p className="text-3xl tabular-nums">{draft.points} 分</p>
							<p className="text-sm text-muted-foreground">
								{activity?.confirmed
									? "本活动分值已确认。"
									: "保存草稿后由管理员确认分值，再核对范围并发布。"}
							</p>
							<Separator />
							<p className="text-sm font-medium">发布范围交集</p>
							<p className="text-3xl tabular-nums">
								{audiencePreview ? `${audiencePreview.count} 人` : "尚未核对"}
							</p>
							<p className="text-sm text-muted-foreground">
								已选 {audience.colleges.length} 个学院、
								{audience.classes.length} 个完整班级、
								{audience.studentIds.length} 位指定学生。
							</p>
							<Feedback error={audiencePreview?.errors.join(" ")} />
							{audiencePreview?.students.map((student) => (
								<p key={student.id} className="text-sm">
									{student.name} · {student.login}
									<span className="block text-xs text-muted-foreground">
										{student.college} / {student.major} / {student.className}
									</span>
								</p>
							))}
							{audiencePreview && (
								<p className="text-xs text-muted-foreground">
									仅列前20人，交集总人数以核对结果为准。
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
								{checking ? "正在核对…" : "核对发布范围"}
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
							<FieldLabel htmlFor="activity-score-mode">
								活动计分方式
							</FieldLabel>
							<NativeSelect
								id="activity-score-mode"
								name="scoreMode"
								defaultValue={activity?.scoreMode || "FIXED"}
								disabled={activity?.confirmed}
							>
								<NativeSelectOption value="FIXED">
									固定分：参与者使用同一分值
								</NativeSelectOption>
								<NativeSelectOption value="INDIVIDUAL">
									逐人分：按已登记学生分别录入
								</NativeSelectOption>
							</NativeSelect>
						</Field>
						<Field>
							<FieldLabel htmlFor="activity-node">计分模块</FieldLabel>
							<NativeSelect
								id="activity-node"
								name="nodeId"
								defaultValue={activity?.nodeId}
								disabled={activity?.confirmed}
								required
							>
								<NativeSelectOption value="">
									选择活动累计模块
								</NativeSelectOption>
								{term.scheme.nodes
									.filter((n) => n.kind === "ACTIVITY")
									.map((n) => (
										<NativeSelectOption key={n.id} value={n.id}>
											{n.name}
										</NativeSelectOption>
									))}
							</NativeSelect>
						</Field>
						<Field>
							<FieldLabel htmlFor="activity-points">
								固定分值 / 逐人分上限
							</FieldLabel>
							<Input
								id="activity-points"
								name="points"
								inputMode="decimal"
								defaultValue={activity?.points}
								disabled={activity?.confirmed}
								required
							/>
						</Field>
					</div>
					<Field>
						<FieldLabel htmlFor="activity-content">活动内容</FieldLabel>
						<Textarea
							id="activity-content"
							name="content"
							defaultValue={activity?.content}
							required
							maxLength={5000}
							rows={4}
						/>
					</Field>
					<Field>
						<FieldLabel htmlFor="activity-requirements">参加要求</FieldLabel>
						<Textarea
							id="activity-requirements"
							name="requirements"
							defaultValue={activity?.requirements}
							maxLength={2000}
							rows={3}
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
			<Button type="submit" disabled={busy}>
				{busy ? "正在保存…" : activity ? "保存活动信息" : "保存活动草稿"}
			</Button>
		</form>
	);
}
