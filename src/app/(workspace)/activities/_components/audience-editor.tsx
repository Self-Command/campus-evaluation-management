"use client";
// invoice ClientSelector field group, with tasks/task-status-filter multi-select menus.
import { useEffect, useState } from "react";
import { ListFilter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Field,
	FieldGroup,
	FieldLabel,
	FieldDescription,
} from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import {
	DropdownMenu,
	DropdownMenuTrigger,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { Feedback, requestJson } from "@/components/dashboard/feedback";
export type AudienceClass = {
	college: string;
	major: string;
	className: string;
};
export type Audience = {
	colleges: string[];
	classes: AudienceClass[];
	studentIds: string[];
};
type Student = AudienceClass & {
	id: string;
	name: string;
	login: string;
	invalid?: boolean;
};
type Options = {
	colleges: string[];
	classes: AudienceClass[];
	students: Student[];
	selectedStudents?: Student[];
	total: number;
	page: number;
};
export type AudiencePreview = {
	count: number;
	students: Student[];
	errors: string[];
	token: string;
};
export const emptyAudience: Audience = {
	colleges: [],
	classes: [],
	studentIds: [],
};
const classKey = (value: AudienceClass) =>
	JSON.stringify([value.college, value.major, value.className]);
export const classLabel = (value: AudienceClass) =>
	`${value.college} / ${value.major} / ${value.className}`;
function MultiSelect({
	label,
	options,
	selected,
	onToggle,
	disabled,
}: {
	label: string;
	options: { value: string; label: string }[];
	selected: string[];
	onToggle: (value: string) => void;
	disabled?: boolean;
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						type="button"
						variant="outline"
						disabled={disabled}
						className="w-full justify-between"
					/>
				}
			>
				<ListFilter data-icon="inline-start" />
				{label} · 已选 {selected.length} 项
			</DropdownMenuTrigger>
			<DropdownMenuContent
				className="max-h-80 w-[min(32rem,85vw)] overflow-y-auto"
				align="start"
			>
				<DropdownMenuGroup>
					{options.map((option) => (
						<DropdownMenuCheckboxItem
							key={option.value}
							checked={selected.includes(option.value)}
							onCheckedChange={() => onToggle(option.value)}
							onSelect={(event) => event.preventDefault()}
						>
							{option.label}
						</DropdownMenuCheckboxItem>
					))}
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
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
	const [search, setSearch] = useState("");
	const [query, setQuery] = useState("");
	const [page, setPage] = useState(1);
	const [retry, setRetry] = useState(0);
	const key = JSON.stringify({ termId, query, page, value, retry });
	const [state, setState] = useState<{
		key: string;
		data: Options | null;
		error: string;
	} | null>(null);
	const [known, setKnown] = useState<Record<string, Student>>({});
	useEffect(() => {
		let cancelled = false;
		const args = JSON.parse(key) as {
			termId: string;
			query: string;
			page: number;
			value: Audience;
		};
		requestJson<Options>("/api/activities/audience", {
			action: "options",
			termId: args.termId,
			q: args.query,
			page: args.page,
			audience: args.value,
		})
			.then((data) => {
				if (cancelled) return;
				setState({ key, data, error: "" });
				setKnown((previous) => ({
					...previous,
					...Object.fromEntries(
						[...data.students, ...(data.selectedStudents || [])].map(
							(student) => [student.id, student],
						),
					),
				}));
			})
			.catch((error) => {
				if (!cancelled) setState({ key, data: null, error: error.message });
			});
		return () => {
			cancelled = true;
		};
	}, [key]);
	const current = state?.key === key ? state : null;
	const options = current?.data;
	const toggle = (items: string[], id: string) =>
		items.includes(id) ? items.filter((item) => item !== id) : [...items, id];
	const conflicts = value.classes.filter(
		(item) => !value.colleges.includes(item.college),
	);
	const selectedStudents = value.studentIds
		.map((id) => known[id])
		.filter((item): item is Student => !!item);
	const studentConflicts = selectedStudents.filter(
		(item) =>
			!value.colleges.includes(item.college) ||
			!value.classes.some((target) => classKey(target) === classKey(item)),
	);
	const invalidStudents = selectedStudents.filter((item) => item.invalid);
	function updateScope(next: Audience) {
		setPage(1);
		onChange(next);
	}
	return (
		<FieldGroup>
			<Field>
				<FieldLabel>发布范围</FieldLabel>
				<FieldDescription>
					学院、完整班级、指定学生三组各至少选择一项。每组内满足任一项，三组必须同时满足。调整学院不会自动删除已选班级或学生。
				</FieldDescription>
			</Field>
			<Feedback error={current?.error} />
			{!current && (
				<p className="text-sm text-muted-foreground" role="status">
					正在读取可选名录…
				</p>
			)}
			{current?.error && (
				<Button
					type="button"
					variant="outline"
					onClick={() => setRetry((count) => count + 1)}
				>
					重试名录
				</Button>
			)}
			<Field>
				<FieldLabel>学院（多选）</FieldLabel>
				<MultiSelect
					disabled={disabled || !options}
					label="选择学院"
					options={[
						...new Set([...(options?.colleges || []), ...value.colleges]),
					].map((college) => ({ value: college, label: college }))}
					selected={value.colleges}
					onToggle={(college) =>
						updateScope({ ...value, colleges: toggle(value.colleges, college) })
					}
				/>
				<FieldDescription>
					{value.colleges.join("、") || "尚未选择学院"}
				</FieldDescription>
			</Field>
			<Field>
				<FieldLabel>完整班级（多选）</FieldLabel>
				<MultiSelect
					disabled={disabled || !options}
					label="选择班级"
					options={Array.from(
						new Map(
							[...(options?.classes || []), ...value.classes].map((item) => [
								classKey(item),
								item,
							]),
						).values(),
					).map((item) => ({ value: classKey(item), label: classLabel(item) }))}
					selected={value.classes.map(classKey)}
					onToggle={(id) =>
						updateScope({
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
					{value.classes.map(classLabel).join("；") || "尚未选择班级"}
				</FieldDescription>
			</Field>
			<Field>
				<FieldLabel htmlFor="audience-search">查找系统已有学生</FieldLabel>
				<div className="flex flex-wrap gap-2">
					<Input
						id="audience-search"
						className="min-w-0 flex-1"
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								setQuery(search);
								setPage(1);
							}
						}}
						placeholder="姓名或学号"
					/>
					<Button
						type="button"
						variant="outline"
						disabled={disabled}
						onClick={() => {
							setQuery(search);
							setPage(1);
						}}
					>
						搜索
					</Button>
				</div>
				<MultiSelect
					disabled={disabled || !options}
					label="指定学生"
					options={(options?.students || []).map((item) => ({
						value: item.id,
						label: `${item.name} · ${item.login} · ${classLabel(item)}`,
					}))}
					selected={value.studentIds}
					onToggle={(id) =>
						onChange({ ...value, studentIds: toggle(value.studentIds, id) })
					}
				/>
				<FieldDescription>
					搜索结果共 {options?.total ?? "—"} 人，当前第 {page}{" "}
					页。已选学生跨页保留。
				</FieldDescription>
				<div className="flex flex-wrap gap-2">
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={disabled || page <= 1 || !options}
						onClick={() => setPage((number) => number - 1)}
					>
						上一页
					</Button>
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={disabled || !options || page * 20 >= options.total}
						onClick={() => setPage((number) => number + 1)}
					>
						下一页
					</Button>
				</div>
			</Field>
			<Field>
				<FieldLabel>已指定 {value.studentIds.length} 位学生</FieldLabel>
				<div className="flex flex-wrap gap-2">
					{value.studentIds.map((id) => (
						<Badge key={id} variant="outline" className="max-w-full">
							<span className="min-w-0 break-all whitespace-normal">
								{known[id]
									? `${known[id].name} · ${known[id].login}${known[id].invalid ? "（身份已失效）" : ""}`
									: `学生标识 ${id}`}
							</span>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								disabled={disabled}
								aria-label={`移除${known[id]?.name || "学生"}`}
								onClick={() =>
									onChange({
										...value,
										studentIds: value.studentIds.filter((item) => item !== id),
									})
								}
							>
								移除
							</Button>
						</Badge>
					))}
				</div>
			</Field>
			<Feedback
				error={[
					...invalidStudents.map(
						(item) =>
							`${item.name}（${item.login}）的学生身份已失效，请明确移除或重新选择。`,
					),
					...conflicts.map(
						(item) => `班级 ${classLabel(item)} 不属于已选学院。`,
					),
					...studentConflicts.map(
						(item) => `${item.name}（${item.login}）未同时命中所选学院和班级。`,
					),
				].join(" ")}
			/>
		</FieldGroup>
	);
}
