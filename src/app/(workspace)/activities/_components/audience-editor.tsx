"use client";
// Activity audience selector adapted from the template's client selector and
// task filter multi-select patterns. Long college/class lists stay searchable.
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Field,
	FieldGroup,
	FieldLabel,
	FieldDescription,
} from "@/components/ui/field";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "@/components/ui/toggle-group";
import { Feedback, requestJson } from "@/components/dashboard/feedback";
import { SearchableMultiSelect } from "@/components/dashboard/searchable-multi-select";
export type AudienceClass = {
	college: string;
	major: string;
	className: string;
};
export type AudienceScope = "ALL" | "COLLEGE" | "CLASS";
export type Audience = {
	scope: AudienceScope;
	colleges: string[];
	classes: AudienceClass[];
};
type Options = {
	colleges: string[];
	classes: AudienceClass[];
};
export type AudiencePreview = {
	count: number;
	collegeCount: number;
	majorCount: number;
	classCount: number;
	errors: string[];
};
export const scopeLabels: Record<AudienceScope, string> = {
	ALL: "全校",
	COLLEGE: "按学院",
	CLASS: "按班级",
};
export const emptyAudience: Audience = {
	scope: "COLLEGE",
	colleges: [],
	classes: [],
};
export const classKey = (value: AudienceClass) =>
	JSON.stringify([value.college, value.major, value.className]);
export const classLabel = (value: AudienceClass) =>
	`${value.college} / ${value.major} / ${value.className}`;
export function audienceSummary(value: Audience) {
	if (value.scope === "ALL") return "全校所有在籍学生";
	if (value.scope === "COLLEGE")
		return value.colleges.length
			? `已选 ${value.colleges.length} 个学院`
			: "尚未选择学院";
	return value.classes.length
		? `已选 ${value.classes.length} 个班级`
		: "尚未选择班级";
}

export function AudienceEditor({
	termId,
	value,
	onChange,
	disabled,
}: {
	termId: string;
	value: Audience;
	onChange: (value: Audience) => void;
	disabled?: boolean;
}) {
	const [retry, setRetry] = useState(0);
	const key = JSON.stringify({ termId, retry });
	const [state, setState] = useState<{
		key: string;
		data: Options | null;
		error: string;
	} | null>(null);
	useEffect(() => {
		let cancelled = false;
		requestJson<Options>("/api/activities/audience", {
			action: "options",
			termId,
		})
			.then((data) => {
				if (!cancelled) setState({ key, data, error: "" });
			})
			.catch((error) => {
				if (!cancelled) setState({ key, data: null, error: error.message });
			});
		return () => {
			cancelled = true;
		};
	}, [key, termId]);
	const current = state?.key === key ? state : null;
	const options = current?.data;
	const toggle = (items: string[], id: string) =>
		items.includes(id) ? items.filter((item) => item !== id) : [...items, id];
	const loading = value.scope !== "ALL" && !current;
	return (
		<FieldGroup>
			<Field>
				<FieldLabel>参与范围</FieldLabel>
				<FieldDescription>
					先选择一种范围方式，同一方式内多选为并集，不叠加其他限制。发布后范围内学生可在活动列表看到活动；参与名单仍由主办方导入或维护。
				</FieldDescription>
				<ToggleGroup
					value={[value.scope]}
					onValueChange={(next) => {
						const scope = next[0] as AudienceScope | undefined;
						if (scope && scope !== value.scope)
							onChange({ ...value, scope });
					}}
					disabled={disabled}
					variant="outline"
				>
					{(
						Object.entries(scopeLabels) as [AudienceScope, string][]
					).map(([scope, label]) => (
						<ToggleGroupItem key={scope} value={scope}>
							{label}
						</ToggleGroupItem>
					))}
				</ToggleGroup>
			</Field>
			<Feedback error={current?.error} />
			{loading && (
				<p className="text-sm text-muted-foreground" role="status">
					正在读取班级目录…
				</p>
			)}
			{current?.error && (
				<Button
					type="button"
					variant="outline"
					onClick={() => setRetry((count) => count + 1)}
				>
					重试
				</Button>
			)}
			{value.scope === "ALL" && (
				<div className="rounded-lg border bg-muted/40 p-4 text-sm">
					<p className="font-medium">全校所有在籍学生均可参与</p>
					<p className="mt-1 text-muted-foreground">
						无需再选择学院或班级；名单导入时仍按学生身份和学号校验。
					</p>
				</div>
			)}
			{value.scope === "COLLEGE" && (
				<Field>
					<FieldLabel>学院（多选）</FieldLabel>
					<SearchableMultiSelect
						disabled={disabled || !options}
						label="选择学院"
						options={[
							...new Set([...(options?.colleges || []), ...value.colleges]),
						].map((college) => ({ value: college, label: college }))}
						selected={value.colleges}
						onToggle={(college) =>
							onChange({ ...value, colleges: toggle(value.colleges, college) })
						}
					/>
					<FieldDescription>
						{value.colleges.join("、") ||
							"尚未选择学院，发布前至少选择一个学院"}
					</FieldDescription>
				</Field>
			)}
			{value.scope === "CLASS" && (
				<Field>
					<FieldLabel>班级（多选）</FieldLabel>
					<SearchableMultiSelect
						disabled={disabled || !options}
						label="选择班级"
						options={Array.from(
							new Map(
								[...(options?.classes || []), ...value.classes].map((item) => [
									classKey(item),
									item,
								]),
							).values(),
						).map((item) => ({
							value: classKey(item),
							label: classLabel(item),
						}))}
						selected={value.classes.map(classKey)}
						onToggle={(id) =>
							onChange({
								...value,
								classes: value.classes.some((item) => classKey(item) === id)
									? value.classes.filter((item) => classKey(item) !== id)
									: [
											...value.classes,
											(options?.classes || []).find(
												(item) => classKey(item) === id,
											)!,
										],
							})
						}
					/>
					<FieldDescription>
						{value.classes.map(classLabel).join("；") ||
							"尚未选择班级，发布前至少选择一个班级"}
					</FieldDescription>
				</Field>
			)}
		</FieldGroup>
	);
}
