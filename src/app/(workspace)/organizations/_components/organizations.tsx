"use client";
// Grouped college/major/class directory adapted from the selected template's
// infrastructure project groups, users directory and invoice form field groups.
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronDown, Plus, Search } from "lucide-react";
import type {
	College,
	Major,
	OrganizationData,
	OrganizationNode,
	SchoolClass,
} from "@/lib/organization-types";
import { useRemote } from "@/components/dashboard/use-remote";
import { RemoteState } from "@/components/dashboard/remote-state";
import { Feedback, requestJson } from "@/components/dashboard/feedback";
import { useUnsavedChanges } from "@/components/dashboard/use-unsaved-changes";
import { NoData } from "@/components/dashboard/page-heading";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
	Field,
	FieldGroup,
	FieldLabel,
	FieldDescription,
} from "@/components/ui/field";
import {
	NativeSelect,
	NativeSelectOption,
} from "@/components/ui/native-select";
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
	SheetDescription,
} from "@/components/ui/sheet";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
type Kind = "college" | "major" | "class";
type Row = OrganizationNode & {
	kind: Kind;
	parentId?: string;
	collegeId: string;
	path: string;
	counselorId?: string | null;
	counselorName?: string;
	studentCount: number;
	childCount: number;
};
type CollegeView = Omit<College, "majors"> & {
	majors: MajorView[];
	allMajorCount: number;
	allClassCount: number;
	allStudentCount: number;
};
type MajorView = Omit<Major, "classes"> & {
	classes: SchoolClass[];
	allClassCount: number;
	allStudentCount: number;
};
const labels = { college: "学院", major: "专业", class: "班级" };
function flatten(data: OrganizationData): Row[] {
	return data.colleges.flatMap((c) => [
		{
			...c,
			kind: "college" as const,
			collegeId: c.id,
			path: c.name,
			studentCount: c.majors.reduce(
				(n, m) => n + m.classes.reduce((a, s) => a + s.studentCount, 0),
				0,
			),
			childCount: c.majors.length,
		},
		...c.majors.flatMap((m) => [
			{
				...m,
				kind: "major" as const,
				parentId: c.id,
				collegeId: c.id,
				path: `${c.name} / ${m.name}`,
				studentCount: m.classes.reduce((n, s) => n + s.studentCount, 0),
				childCount: m.classes.length,
			},
			...m.classes.map((s) => ({
				...s,
				kind: "class" as const,
				parentId: m.id,
				collegeId: c.id,
				path: `${c.name} / ${m.name} / ${s.name}`,
				counselorId: s.counselor?.id || null,
				counselorName: s.counselor
					? `${s.counselor.name}（${s.counselor.login}）`
					: "未分配",
				childCount: 0,
			})),
		]),
	]);
}
function collegeTree(data: OrganizationData, query: string): CollegeView[] {
	const keyword = query.trim().toLocaleLowerCase();
	return data.colleges
		.map((college) => {
			const collegeHit =
				!keyword ||
				`${college.name} ${college.code}`.toLocaleLowerCase().includes(keyword);
			const majors = college.majors
				.map((major) => {
					const majorHit =
						!keyword ||
						`${major.name} ${major.code}`.toLocaleLowerCase().includes(keyword);
					const classes = major.classes.filter((schoolClass) => {
						if (!keyword || collegeHit || majorHit) return true;
						return `${schoolClass.name} ${schoolClass.code} ${schoolClass.counselor?.name || ""} ${schoolClass.counselor?.login || ""}`
							.toLocaleLowerCase()
							.includes(keyword);
					});
					return {
						...major,
						classes,
						allClassCount: major.classes.length,
						allStudentCount: major.classes.reduce(
							(sum, schoolClass) => sum + schoolClass.studentCount,
							0,
						),
					};
				})
				.filter(
					(major) =>
						!keyword ||
						`${major.name} ${major.code}`.toLocaleLowerCase().includes(keyword) ||
						major.classes.length > 0,
				);
			return {
				...college,
				majors,
				allMajorCount: college.majors.length,
				allClassCount: college.majors.reduce(
					(sum, major) => sum + major.classes.length,
					0,
				),
				allStudentCount: college.majors.reduce(
					(sum, major) =>
						sum +
						major.classes.reduce(
							(classSum, schoolClass) => classSum + schoolClass.studentCount,
							0,
						),
					0,
				),
			};
		})
		.filter(
			(college) =>
				!keyword ||
				`${college.name} ${college.code}`.toLocaleLowerCase().includes(keyword) ||
				college.majors.length > 0,
		);
}
export function Organizations() {
	const params = useSearchParams();
	const remote = useRemote<OrganizationData>("/api/organizations");
	const [query, setQuery] = useState((params.get("q") || "").slice(0, 80));
	const [edit, setEdit] = useState<Row | "new" | null>(null);
	const [editKind, setEditKind] = useState<Kind>("class");
	const [parentId, setParentId] = useState("");
	const [busy, setBusy] = useState(false);
	const [dirty, setDirty] = useState(false);
	const [error, setError] = useState("");
	const [success, setSuccess] = useState("");
	useUnsavedChanges(dirty || busy);
	const data = remote.data;
	const rows = data ? flatten(data) : [];
	const colleges = data ? collegeTree(data, query) : [];
	const current = edit && edit !== "new" ? edit : null;
	const parents = rows.filter(
		(row) =>
			(row.enabled || row.id === current?.parentId) &&
			row.kind === (editKind === "class" ? "major" : "college"),
	);
	const targetCollegeId =
		current?.collegeId || rows.find((row) => row.id === parentId)?.collegeId;
	const visibleClassCount = colleges.reduce(
		(sum, college) =>
			sum +
			college.majors.reduce(
				(majorSum, major) => majorSum + major.classes.length,
				0,
			),
		0,
	);
	function search(next: string) {
		setQuery(next);
		window.history.replaceState(
			null,
			"",
			next ? `/organizations?q=${encodeURIComponent(next)}` : "/organizations",
		);
	}
	function rowById(id: string) {
		return rows.find((row) => row.id === id);
	}
	function start(row: Row) {
		setEdit(row);
		setEditKind(row.kind);
		setParentId(row.parentId || "");
		setDirty(false);
		setError("");
	}
	function startNew(kind: Kind, parent?: string) {
		setEdit("new");
		setEditKind(kind);
		setParentId(parent || "");
		setDirty(false);
		setError("");
	}
	function editOrganization(id: string) {
		const row = rowById(id);
		if (row) start(row);
	}
	return (
		<>
			<RemoteState {...remote} />
			<Feedback success={success} />
			{data && (
				<Card className="min-w-0">
					<CardHeader>
						<CardTitle>学院目录</CardTitle>
						<CardDescription>
							共 {data.totals.colleges} 个学院、{data.totals.majors} 个专业、
							{data.totals.classes} 个班级。先展开学院查看专业，再展开专业查看班级。
						</CardDescription>
						{data.canManage && data.role === "ADMIN" && (
							<CardAction>
								<Button size="sm" onClick={() => startNew("college")}>
									<Plus data-icon="inline-start" />
									新增学院
								</Button>
							</CardAction>
						)}
					</CardHeader>
					<CardContent className="flex min-w-0 flex-col gap-4">
						<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
							<InputGroup className="min-w-0 sm:w-96">
								<InputGroupAddon align="inline-start">
									<Search />
								</InputGroupAddon>
								<InputGroupInput
									value={query}
									maxLength={80}
									onChange={(event) => search(event.target.value)}
									placeholder="搜索学院、专业、班级或辅导员"
									aria-label="搜索学院、专业、班级或辅导员"
								/>
							</InputGroup>
							{query && (
								<p className="text-sm text-muted-foreground">
									找到 {colleges.length} 个学院、{visibleClassCount} 个班级
								</p>
							)}
						</div>
						{colleges.length ? (
							<div
								key={query}
								className="flex min-w-0 flex-col gap-3"
							>
								{colleges.map((college, index) => (
									<Collapsible
										key={college.id}
										defaultOpen={!!query || index === 0}
										className="flex flex-col overflow-hidden rounded-xl border bg-card py-3 data-open:gap-3 data-open:pb-0"
									>
										<div className="flex flex-col gap-3 px-4 lg:flex-row lg:items-center lg:justify-between">
											<CollapsibleTrigger
												render={
													<Button
														type="button"
														variant="ghost"
														className="group -ml-2 h-auto min-w-0 justify-start gap-2 px-2 py-1 hover:bg-transparent aria-expanded:bg-transparent"
													/>
												}
											>
												<ChevronDown className="shrink-0 transition-transform group-data-panel-open:rotate-180" />
												<div className="flex min-w-0 flex-col items-start gap-1 text-left">
													<div className="flex flex-wrap items-center gap-2">
														<span className="font-medium">{college.name}</span>
														<Badge
															variant={college.enabled ? "outline" : "secondary"}
														>
															{college.enabled ? "启用" : "停用"}
														</Badge>
													</div>
													<span className="text-xs text-muted-foreground">
														{college.code} · {college.allMajorCount} 个专业 ·{" "}
														{college.allClassCount} 个班级 ·{" "}
														{college.allStudentCount} 名学生
													</span>
												</div>
											</CollapsibleTrigger>
											<div className="flex flex-wrap gap-2 lg:justify-end">
												{data.canManage && (
													<Button
														type="button"
														variant="outline"
														size="sm"
														onClick={() => startNew("major", college.id)}
													>
														<Plus data-icon="inline-start" />
														新增专业
													</Button>
												)}
												{data.canManage && data.role === "ADMIN" && (
													<Button
														type="button"
														variant="ghost"
														size="sm"
														onClick={() => editOrganization(college.id)}
													>
														编辑学院
													</Button>
												)}
											</div>
										</div>
										<CollapsibleContent>
											<div className="flex flex-col gap-3 border-t bg-muted/20 p-3 sm:p-4">
												{college.majors.length ? (
													college.majors.map((major) => (
														<Collapsible
															key={major.id}
															defaultOpen={!!query && major.classes.length > 0}
															className="overflow-hidden rounded-lg border bg-card"
														>
															<div className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
																<CollapsibleTrigger
																	render={
																		<Button
																			type="button"
																			variant="ghost"
																			className="group -ml-2 h-auto min-w-0 justify-start gap-2 px-2 py-1 hover:bg-transparent aria-expanded:bg-transparent"
																		/>
																	}
																>
																	<ChevronDown className="shrink-0 transition-transform group-data-panel-open:rotate-180" />
																	<div className="flex min-w-0 flex-col items-start gap-1 text-left">
																		<div className="flex flex-wrap items-center gap-2">
																			<span className="font-medium">{major.name}</span>
																			<Badge
																				variant={major.enabled ? "outline" : "secondary"}
																			>
																				{major.enabled ? "启用" : "停用"}
																			</Badge>
																		</div>
																		<span className="text-xs text-muted-foreground">
																			{major.code} · {major.allClassCount} 个班级 ·{" "}
																			{major.allStudentCount} 名学生
																		</span>
																	</div>
																</CollapsibleTrigger>
																<div className="flex flex-wrap gap-2 sm:justify-end">
																	{data.canManage && (
																		<Button
																			type="button"
																			variant="outline"
																			size="sm"
																			onClick={() => startNew("class", major.id)}
																		>
																			<Plus data-icon="inline-start" />
																			新增班级
																		</Button>
																	)}
																	{data.canManage && (
																		<Button
																			type="button"
																			variant="ghost"
																			size="sm"
																			onClick={() => editOrganization(major.id)}
																		>
																			编辑专业
																		</Button>
																	)}
																</div>
															</div>
															<CollapsibleContent>
																<ClassTable
																	classes={major.classes}
																	onEdit={editOrganization}
																/>
															</CollapsibleContent>
														</Collapsible>
													))
												) : (
													<p className="py-3 text-sm text-muted-foreground">
														本学院还没有专业。
													</p>
												)}
											</div>
										</CollapsibleContent>
									</Collapsible>
								))}
							</div>
						) : (
							<NoData
								title={query ? "没有找到匹配的学院、专业或班级" : "还没有学院"}
								description={
									query
										? "换个名称、编码或辅导员姓名试试。"
										: "先新增学院，再在学院下添加专业和班级。"
								}
							/>
						)}
					</CardContent>
				</Card>
			)}
			<Sheet
				open={!!edit}
				onOpenChange={(open) => {
					if (
						!open &&
						!busy &&
						(!dirty || window.confirm("放弃尚未保存的修改？"))
					) {
						setEdit(null);
						setDirty(false);
					}
				}}
			>
				<SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
					<SheetHeader>
						<SheetTitle>
							{current
								? `${current.name} · 编辑${labels[current.kind]}`
								: `新增${labels[editKind]}`}
						</SheetTitle>
						<SheetDescription>
							{current?.kind === "college" && data?.role !== "ADMIN"
								? "学院基本信息由学校管理员维护；学院可以维护本院专业和班级。"
								: current
									? "编码不能重复。已有下级组织或学生时不能停用。"
									: "选择所属上级组织。编码在全校唯一，保存后可在目录中继续添加下级。"}
						</SheetDescription>
					</SheetHeader>
					{edit && data && (
						<form
							key={current?.id || "new"}
							className="flex flex-col gap-5 px-5 pb-6"
							onChange={() => setDirty(true)}
							onSubmit={async (event) => {
								event.preventDefault();
								if (busy) return;
								const form = new FormData(event.currentTarget);
								setBusy(true);
								setError("");
								try {
									await requestJson<OrganizationData>("/api/organizations", {
										kind: editKind,
										code: form.get("code"),
										name: form.get("name"),
										enabled: form.get("enabled") === "true",
										...(editKind !== "college" ? { parentId } : {}),
										...(editKind === "class"
											? { counselorId: form.get("counselorId") || null }
											: {}),
										...(current
											? {
													id: current.id,
													revision: current.revision,
													reason: form.get("reason"),
												}
											: {}),
									});
									setDirty(false);
									setEdit(null);
									setSuccess("已保存。");
									remote.reload();
								} catch (err) {
									setError((err as Error).message);
								} finally {
									setBusy(false);
								}
							}}
						>
							<Feedback error={error} />
							{current && (
								<dl className="grid gap-6 sm:grid-cols-2">
									{[
										["所属", current.path],
										["学生人数", String(current.studentCount)],
										["责任辅导员", current.counselorName || "不适用"],
										["版本", String(current.revision)],
									].map(([label, value]) => (
										<div key={label} className="flex flex-col gap-1">
											<dt className="text-xs text-muted-foreground">{label}</dt>
											<dd className="break-words text-sm">{value}</dd>
										</div>
									))}
								</dl>
							)}
							{data.canManage &&
								(data.role === "ADMIN" || editKind !== "college") && (
									<>
										<FieldGroup>
											<Field>
												<FieldLabel htmlFor="org-edit-kind">类型</FieldLabel>
												<NativeSelect
													id="org-edit-kind"
													value={editKind}
													disabled={!!current}
													onChange={(event) => {
														setEditKind(event.target.value as Kind);
														setParentId("");
													}}
												>
													{Object.entries(labels)
														.filter(
															([kind]) =>
																kind !== "college" ||
																data.role === "ADMIN",
														)
														.map(([kind, label]) => (
															<NativeSelectOption key={kind} value={kind}>
																{label}
															</NativeSelectOption>
														))}
												</NativeSelect>
											</Field>
											{editKind !== "college" && (
												<Field>
													<FieldLabel htmlFor="org-edit-parent">
														所属{editKind === "class" ? "专业" : "学院"}
													</FieldLabel>
													<NativeSelect
														id="org-edit-parent"
														required
														disabled={!!current}
														value={parentId}
														onChange={(event) => setParentId(event.target.value)}
													>
														<NativeSelectOption value="">
															请选择上级
														</NativeSelectOption>
														{parents.map((parent) => (
															<NativeSelectOption key={parent.id} value={parent.id}>
																{parent.path}
															</NativeSelectOption>
														))}
													</NativeSelect>
													<FieldDescription>
														保存后不能直接更换上级。
													</FieldDescription>
												</Field>
											)}
											<Field>
												<FieldLabel htmlFor="org-edit-code">编码</FieldLabel>
												<Input
													id="org-edit-code"
													name="code"
													defaultValue={current?.code}
													required
													maxLength={40}
													pattern="[A-Za-z0-9._-]+"
												/>
												<FieldDescription>
													可用字母、数字、点、下划线或连字符。
												</FieldDescription>
											</Field>
											<Field>
												<FieldLabel htmlFor="org-edit-name">名称</FieldLabel>
												<Input
													id="org-edit-name"
													name="name"
													defaultValue={current?.name}
													required
													maxLength={80}
												/>
											</Field>
											{editKind === "class" && (
												<Field>
													<FieldLabel htmlFor="org-edit-counselor">
														责任辅导员
													</FieldLabel>
													<NativeSelect
														id="org-edit-counselor"
														name="counselorId"
														key={parentId}
														defaultValue={current?.counselorId || ""}
													>
														<NativeSelectOption value="">
															暂不分配
														</NativeSelectOption>
														{data.counselors
															.filter(
																(counselor) =>
																	counselor.collegeId === targetCollegeId &&
																	!counselor.disabled,
															)
															.map((counselor) => (
																<NativeSelectOption
																	key={counselor.id}
																	value={counselor.id}
																>
																	{counselor.name}（{counselor.login}）
																</NativeSelectOption>
															))}
													</NativeSelect>
													<FieldDescription>
														只显示本学院在职辅导员。
													</FieldDescription>
												</Field>
											)}
											<Field>
												<FieldLabel htmlFor="org-edit-enabled">状态</FieldLabel>
												<NativeSelect
													id="org-edit-enabled"
													name="enabled"
													defaultValue={String(current?.enabled ?? true)}
												>
													<NativeSelectOption value="true">
														启用
													</NativeSelectOption>
													<NativeSelectOption value="false">
														停用
													</NativeSelectOption>
												</NativeSelect>
												<FieldDescription>
													有下级组织、学生或绑定账号时不能停用。
												</FieldDescription>
											</Field>
											{current && (
												<Field>
													<FieldLabel htmlFor="org-edit-reason">
														修改理由
													</FieldLabel>
													<Textarea
														id="org-edit-reason"
														name="reason"
														required
														minLength={2}
														maxLength={500}
														rows={3}
													/>
												</Field>
											)}
										</FieldGroup>
										<Button type="submit" disabled={busy}>
											{busy ? "正在保存…" : "保存"}
										</Button>
									</>
								)}
						</form>
					)}
				</SheetContent>
			</Sheet>
		</>
	);
}
function ClassTable({
	classes,
	onEdit,
}: {
	classes: SchoolClass[];
	onEdit: (id: string) => void;
}) {
	if (!classes.length)
		return (
			<p className="border-t px-4 py-4 text-sm text-muted-foreground">
				本专业还没有班级。
			</p>
		);
	return (
		<>
			<div className="hidden overflow-x-auto border-t md:block">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>班级</TableHead>
							<TableHead>编码</TableHead>
							<TableHead>责任辅导员</TableHead>
							<TableHead className="text-right">学生</TableHead>
							<TableHead>状态</TableHead>
							<TableHead />
						</TableRow>
					</TableHeader>
					<TableBody>
						{classes.map((schoolClass) => (
							<TableRow key={schoolClass.id}>
								<TableCell className="font-medium">{schoolClass.name}</TableCell>
								<TableCell className="text-muted-foreground">
									{schoolClass.code}
								</TableCell>
								<TableCell>
									{schoolClass.counselor?.name || "未分配"}
								</TableCell>
								<TableCell className="text-right tabular-nums">
									{schoolClass.studentCount}
								</TableCell>
								<TableCell>
									<Badge variant={schoolClass.enabled ? "outline" : "secondary"}>
										{schoolClass.enabled ? "启用" : "停用"}
									</Badge>
								</TableCell>
								<TableCell className="text-right">
									<Button
										type="button"
										variant="ghost"
										size="sm"
										onClick={() => onEdit(schoolClass.id)}
									>
										编辑
									</Button>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>
			<div className="divide-y border-t md:hidden">
				{classes.map((schoolClass) => (
					<div key={schoolClass.id} className="flex flex-col gap-2 p-3">
						<div className="flex items-start justify-between gap-3">
							<div>
								<p className="font-medium">{schoolClass.name}</p>
								<p className="text-xs text-muted-foreground">
									{schoolClass.code}
								</p>
							</div>
							<Badge variant={schoolClass.enabled ? "outline" : "secondary"}>
								{schoolClass.enabled ? "启用" : "停用"}
							</Badge>
						</div>
						<p className="text-sm">
							辅导员：{schoolClass.counselor?.name || "未分配"} · 学生{" "}
							{schoolClass.studentCount} 人
						</p>
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="self-start"
							onClick={() => onEdit(schoolClass.id)}
						>
							编辑班级
						</Button>
					</div>
				))}
			</div>
		</>
	);
}
