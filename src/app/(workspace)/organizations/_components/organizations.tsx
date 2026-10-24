"use client";
// Class directory adapted from the selected template's users directory. The
// page has two first-class views: flat class directory and organization
// structure (colleges/majors). No hidden side sheet is used for structure.
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import {
	Plus,
	RotateCcw,
	School,
	Search,
	Users,
	UserRoundCheck,
	UserRoundX,
} from "lucide-react";
import type { DataTableFeatures } from "@/lib/data-table-features";
import type { OrganizationData, SchoolClass } from "@/lib/organization-types";
import { TemplateDirectory } from "@/components/dashboard/template-directory";
import { useRemote } from "@/components/dashboard/use-remote";
import { RemoteState } from "@/components/dashboard/remote-state";
import { Feedback, requestJson } from "@/components/dashboard/feedback";
import { useUnsavedChanges } from "@/components/dashboard/use-unsaved-changes";
import { SearchableSelect } from "@/components/dashboard/searchable-select";
import { DeleteUsageDialog } from "@/components/dashboard/delete-usage-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	Field,
	FieldDescription,
	FieldGroup,
	FieldLabel,
} from "@/components/ui/field";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
} from "@/components/ui/input-group";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
	NativeSelect,
	NativeSelectOption,
} from "@/components/ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OrganizationStructure } from "./organization-structure";

type ClassRow = SchoolClass & {
	collegeId: string;
	collegeName: string;
	collegeCode: string;
	collegeEnabled: boolean;
	majorId: string;
	majorName: string;
	majorCode: string;
	majorEnabled: boolean;
};

type Filters = {
	college: string;
	major: string;
	status: string;
	counselor: string;
};

function classesOf(data: OrganizationData): ClassRow[] {
	return data.colleges.flatMap((college) =>
		college.majors.flatMap((major) =>
			major.classes.map((schoolClass) => ({
				...schoolClass,
				collegeId: college.id,
				collegeName: college.name,
				collegeCode: college.code,
				collegeEnabled: college.enabled,
				majorId: major.id,
				majorName: major.name,
				majorCode: major.code,
				majorEnabled: major.enabled,
			})),
		),
	);
}

function matchesQuery(row: ClassRow, needle: string) {
	if (!needle) return true;
	return `${row.name} ${row.code} ${row.collegeName} ${row.collegeCode} ${row.majorName} ${row.majorCode} ${row.counselor?.name ?? ""} ${row.counselor?.login ?? ""}`
		.toLocaleLowerCase()
		.includes(needle);
}

export function Organizations() {
	const params = useSearchParams();
	const remote = useRemote<OrganizationData>("/api/organizations");
	const [view, setView] = useState(
		params.get("view") === "structure" ? "structure" : "classes",
	);
	const [query, setQuery] = useState((params.get("q") || "").slice(0, 80));
	const [filters, setFilters] = useState<Filters>({
		college: params.get("college") || "",
		major: params.get("major") || "",
		status: params.get("status") || "",
		counselor: params.get("counselor") || "",
	});
	const [page, setPage] = useState(
		Math.max(1, Math.min(100000, Math.floor(Number(params.get("page")) || 1))),
	);
	const [classEdit, setClassEdit] = useState<ClassRow | "new" | null>(null);
	const [classMajorId, setClassMajorId] = useState("");
	const [classCounselorId, setClassCounselorId] = useState("");
	const [classDelete, setClassDelete] = useState<ClassRow | null>(null);
	const [busy, setBusy] = useState(false);
	const [dirty, setDirty] = useState(false);
	const [error, setError] = useState("");
	const [success, setSuccess] = useState("");
	useUnsavedChanges(dirty || busy);
	const data = remote.data;
	const allClasses = data ? classesOf(data) : [];
	const current = classEdit && classEdit !== "new" ? classEdit : null;
	const needle = query.trim().toLocaleLowerCase();
	const filtered = allClasses.filter((row) => {
		if (filters.college && row.collegeId !== filters.college) return false;
		if (filters.major && row.majorId !== filters.major) return false;
		if (filters.status === "enabled" && !row.enabled) return false;
		if (filters.status === "disabled" && row.enabled) return false;
		if (filters.counselor === "assigned" && !row.counselor) return false;
		if (filters.counselor === "unassigned" && row.counselor) return false;
		return matchesQuery(row, needle);
	});
	const pageCount = Math.max(1, Math.ceil(filtered.length / 20));
	const safePage = Math.min(page, pageCount);
	const rows = filtered.slice((safePage - 1) * 20, safePage * 20);
	const enabledCount = allClasses.filter((row) => row.enabled).length;
	const unassignedCount = allClasses.filter((row) => !row.counselor).length;
	const studentCount = allClasses.reduce(
		(sum, row) => sum + row.studentCount,
		0,
	);
	const activeCounselors = data
		? data.counselors.filter((counselor) => !counselor.disabled).length
		: 0;
	const majorOptions = data
		? data.colleges
				.filter((college) => !filters.college || college.id === filters.college)
				.flatMap((college) =>
					college.majors.map((major) => ({
						value: major.id,
						label:
							data.role === "ADMIN"
								? `${major.name}（${college.name}）`
								: major.name,
					})),
				)
		: [];
	const hasFilter =
		!!query ||
		!!filters.college ||
		!!filters.major ||
		!!filters.status ||
		!!filters.counselor;
	const selectedMajorCollegeId = data?.colleges.find((college) =>
		college.majors.some((major) => major.id === classMajorId),
	)?.id;
	const targetCollegeId = current?.collegeId || selectedMajorCollegeId;
	const classMajorOptions = data
		? data.colleges.flatMap((college) =>
				college.majors
					.filter((major) => major.enabled && college.enabled)
					.map((major) => ({
						value: major.id,
						label: `${college.name} / ${major.name}`,
						description: major.code,
					})),
			)
		: [];
	const counselorOptions = data
		? [
				{ value: "", label: "暂不分配" },
				...data.counselors
					.filter((counselor) => counselor.collegeId === targetCollegeId)
					.filter(
						(counselor) =>
							!counselor.disabled || counselor.id === current?.counselor?.id,
					)
					.map((counselor) => ({
						value: counselor.id,
						label: `${counselor.name}（${counselor.login}）`,
						description: counselor.disabled ? "账号已停用，请改派" : undefined,
					})),
			]
		: [];

	function updateUrl(next: {
		q?: string;
		college?: string;
		major?: string;
		status?: string;
		counselor?: string;
		page?: number;
	}) {
		const search = new URLSearchParams(window.location.search);
		const q = next.q ?? query;
		const college = next.college ?? filters.college;
		const major = next.major ?? filters.major;
		const status = next.status ?? filters.status;
		const counselor = next.counselor ?? filters.counselor;
		const nextPage = next.page ?? 1;
		for (const [key, value] of [
			["q", q],
			["college", college],
			["major", major],
			["status", status],
			["counselor", counselor],
			["page", nextPage > 1 ? String(nextPage) : ""],
		] as const) {
			if (value) search.set(key, value);
			else search.delete(key);
		}
		const text = search.toString();
		window.history.replaceState(
			null,
			"",
			text ? `/organizations?${text}` : "/organizations",
		);
	}
	function changeView(next: string) {
		const value = next === "structure" ? "structure" : "classes";
		setView(value);
		const search = new URLSearchParams(window.location.search);
		if (value === "structure") search.set("view", "structure");
		else search.delete("view");
		const text = search.toString();
		window.history.replaceState(
			null,
			"",
			text ? `/organizations?${text}` : "/organizations",
		);
	}
	function search(nextQuery: string) {
		setQuery(nextQuery);
		setPage(1);
		updateUrl({ q: nextQuery, page: 1 });
	}
	function filterBy(key: keyof Filters, value: string) {
		const next = {
			...filters,
			[key]: value,
			...(key === "college" ? { major: "" } : {}),
		};
		setFilters(next);
		setPage(1);
		updateUrl({ ...next, page: 1 });
	}
	function resetFilters() {
		const empty = { college: "", major: "", status: "", counselor: "" };
		setQuery("");
		setFilters(empty);
		setPage(1);
		updateUrl({ q: "", ...empty, page: 1 });
	}
	function openClass(row: ClassRow | "new") {
		setDirty(false);
		setError("");
		setClassEdit(row);
		setClassMajorId(row === "new" ? "" : row.majorId);
		setClassCounselorId(row === "new" ? "" : row.counselor?.id || "");
	}
	function closeClassDialog() {
		if (busy) return;
		if (dirty && !window.confirm("放弃尚未保存的班级修改？")) return;
		setDirty(false);
		setError("");
		setClassEdit(null);
	}
	const columns: ColumnDef<DataTableFeatures, ClassRow>[] = [
		{
			accessorKey: "name",
			header: "班级",
			cell: ({ row }) => (
				<div className="min-w-0">
					<p className="font-medium">{row.original.name}</p>
					<p className="text-xs text-muted-foreground">{row.original.code}</p>
				</div>
			),
		},
		{
			id: "college",
			header: "学院",
			cell: ({ row }) => row.original.collegeName,
		},
		{
			id: "major",
			header: "专业",
			cell: ({ row }) => row.original.majorName,
		},
		{
			id: "counselor",
			header: "责任辅导员",
			cell: ({ row }) =>
				row.original.counselor ? (
					<div className="min-w-0">
						<p>{row.original.counselor.name}</p>
						<p className="text-xs text-muted-foreground">
							{row.original.counselor.login}
						</p>
					</div>
				) : (
					<Badge variant="secondary">未分配</Badge>
				),
		},
		{
			id: "students",
			header: "学生",
			cell: ({ row }) => (
				<span className="tabular-nums">{row.original.studentCount}</span>
			),
		},
		{
			id: "status",
			header: "状态",
			cell: ({ row }) => (
				<div className="flex flex-col items-start gap-1">
					<Badge variant={row.original.enabled ? "outline" : "secondary"}>
						{row.original.enabled ? "启用" : "停用"}
					</Badge>
					{(!row.original.majorEnabled || !row.original.collegeEnabled) && (
						<span className="text-xs text-muted-foreground">上级已停用</span>
					)}
				</div>
			),
		},
		{
			id: "actions",
			header: "操作",
			cell: ({ row }) => (
				<div className="flex items-center gap-1">
					<Button
						variant="ghost"
						size="sm"
						onClick={() => openClass(row.original)}
					>
						编辑
					</Button>
					<Button
						variant="ghost"
						size="sm"
						className="text-destructive hover:text-destructive"
						onClick={() => setClassDelete(row.original)}
					>
						删除
					</Button>
				</div>
			),
		},
	];
	return (
		<>
			<RemoteState {...remote} />
			<Feedback success={success} />
			{data && (
				<Tabs value={view} onValueChange={changeView} className="gap-3">
					<div className="scrollbar-none touch-pan-x overflow-x-auto overscroll-x-contain border-b">
						<TabsList
							variant="line"
							className="w-max justify-start gap-4"
						>
							<TabsTrigger value="classes">班级目录</TabsTrigger>
							<TabsTrigger value="structure">学院与专业</TabsTrigger>
						</TabsList>
					</div>
					<TabsContent value="classes">
						<div className="flex flex-col gap-3">
							<div className="grid min-w-0 grid-cols-2 gap-3 xl:grid-cols-4">
								{[
									{
										label: "班级",
										value: allClasses.length,
										hint: `${enabledCount} 个启用 · ${allClasses.length - enabledCount} 个停用`,
										icon: School,
									},
									{
										label: "学生",
										value: studentCount,
										hint: "已分班学生",
										icon: Users,
									},
									{
										label: "责任辅导员",
										value: activeCounselors,
										hint: "当前可分配",
										icon: UserRoundCheck,
									},
									{
										label: "未分配辅导员",
										value: unassignedCount,
										hint: unassignedCount ? "需要尽快指派" : "全部班级已指派",
										icon: UserRoundX,
									},
								].map((item) => (
									<Card
										key={item.label}
										size="sm"
										className="min-w-0 shadow-xs"
									>
										<CardContent className="flex items-start justify-between gap-3">
											<div className="min-w-0">
												<p className="text-muted-foreground">{item.label}</p>
												<p className="mt-1 text-2xl font-medium tabular-nums leading-none tracking-tight">
													{item.value}
												</p>
												<p className="mt-1.5 text-xs text-muted-foreground">
													{item.hint}
												</p>
											</div>
											<div className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted text-muted-foreground">
												<item.icon className="size-4" />
											</div>
										</CardContent>
									</Card>
								))}
							</div>
							{unassignedCount > 0 && (
								<div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed px-4 py-3">
									<p className="text-sm">
										有 {unassignedCount} 个班级还没有责任辅导员，这些班级暂时无法导入学生。
									</p>
									<Button
										variant="outline"
										size="sm"
										onClick={() => filterBy("counselor", "unassigned")}
									>
										只看未分配
									</Button>
								</div>
							)}
							<TemplateDirectory
								title="班级目录"
								description={
									data.role === "ADMIN"
										? "按学院、专业筛选班级并维护责任辅导员；学院与专业在“学院与专业”页签维护。"
										: "本院班级目录，可维护班级名称、编码与责任辅导员。"
								}
								data={rows}
								columns={columns}
								actions={
									<Button size="sm" onClick={() => openClass("new")}>
										<Plus data-icon="inline-start" />
										新增班级
									</Button>
								}
								filters={
									<div className="flex w-full flex-col gap-3">
										<div className="flex flex-wrap items-end gap-3">
											<Field className="w-full sm:w-64">
												<FieldLabel htmlFor="org-filter-query">搜索</FieldLabel>
												<InputGroup>
													<InputGroupAddon align="inline-start">
														<Search />
													</InputGroupAddon>
													<InputGroupInput
														id="org-filter-query"
														value={query}
														maxLength={80}
														onChange={(event) => search(event.target.value)}
														placeholder="班级、编码、专业或辅导员"
														aria-label="搜索班级、编码、专业或辅导员"
													/>
												</InputGroup>
											</Field>
											{data.role === "ADMIN" && (
												<Field className="w-full sm:w-44">
													<FieldLabel htmlFor="org-filter-college">学院</FieldLabel>
													<NativeSelect
														id="org-filter-college"
														value={filters.college}
														onChange={(event) =>
															filterBy("college", event.target.value)
														}
													>
														<NativeSelectOption value="">全部学院</NativeSelectOption>
														{data.colleges.map((college) => (
															<NativeSelectOption
																key={college.id}
																value={college.id}
															>
																{college.name}
															</NativeSelectOption>
														))}
													</NativeSelect>
												</Field>
											)}
											<Field className="w-full sm:w-44">
												<FieldLabel htmlFor="org-filter-major">专业</FieldLabel>
												<NativeSelect
													id="org-filter-major"
													value={filters.major}
													onChange={(event) =>
														filterBy("major", event.target.value)
													}
												>
													<NativeSelectOption value="">全部专业</NativeSelectOption>
													{majorOptions.map((major) => (
														<NativeSelectOption key={major.value} value={major.value}>
															{major.label}
														</NativeSelectOption>
													))}
												</NativeSelect>
											</Field>
											<Field className="w-full sm:w-36">
												<FieldLabel htmlFor="org-filter-status">状态</FieldLabel>
												<NativeSelect
													id="org-filter-status"
													value={filters.status}
													onChange={(event) =>
														filterBy("status", event.target.value)
													}
												>
													<NativeSelectOption value="">全部状态</NativeSelectOption>
													<NativeSelectOption value="enabled">启用</NativeSelectOption>
													<NativeSelectOption value="disabled">停用</NativeSelectOption>
												</NativeSelect>
											</Field>
											<Field className="w-full sm:w-40">
												<FieldLabel htmlFor="org-filter-counselor">
													辅导员
												</FieldLabel>
												<NativeSelect
													id="org-filter-counselor"
													value={filters.counselor}
													onChange={(event) =>
														filterBy("counselor", event.target.value)
													}
												>
													<NativeSelectOption value="">全部</NativeSelectOption>
													<NativeSelectOption value="assigned">
														已分配
													</NativeSelectOption>
													<NativeSelectOption value="unassigned">
														未分配
													</NativeSelectOption>
												</NativeSelect>
											</Field>
											{hasFilter && (
												<Button
													type="button"
													variant="ghost"
													size="sm"
													onClick={resetFilters}
												>
													<RotateCcw data-icon="inline-start" />
													重置筛选
												</Button>
											)}
										</div>
										<p className="text-xs text-muted-foreground">
											共 {filtered.length} 个班级
											{hasFilter ? `（全部 ${allClasses.length} 个）` : ""}
										</p>
									</div>
								}
								pagination={{
									page: safePage,
									total: filtered.length,
									href: () => "/organizations",
									onPageChange: (next) => {
										setPage(next);
										updateUrl({ page: next });
									},
								}}
								empty={{
									title: hasFilter ? "没有匹配的班级" : "还没有班级",
									description: hasFilter
										? "调整筛选条件或重置后重试。"
										: "先新增班级并指派责任辅导员。",
								}}
								mobile={(row) => (
									<div className="flex flex-col gap-3">
										<div className="flex items-start justify-between gap-3">
											<div className="min-w-0">
												<p className="font-medium">{row.name}</p>
												<p className="text-xs text-muted-foreground">
													{row.code}
												</p>
											</div>
											<Badge variant={row.enabled ? "outline" : "secondary"}>
												{row.enabled ? "启用" : "停用"}
											</Badge>
										</div>
										<p className="text-sm">
											{row.collegeName} · {row.majorName}
										</p>
										<div className="flex flex-wrap items-center justify-between gap-2">
											<p className="text-sm">
												辅导员：
												{row.counselor?.name || "未分配"} · 学生 {row.studentCount} 人
											</p>
											<div className="flex gap-2">
												<Button
													variant="outline"
													size="sm"
													onClick={() => openClass(row)}
												>
													编辑班级
												</Button>
												<Button
													variant="outline"
													size="sm"
													className="text-destructive"
													onClick={() => setClassDelete(row)}
												>
													删除
												</Button>
											</div>
										</div>
									</div>
								)}
							/>
						</div>
					</TabsContent>
					<TabsContent value="structure">
						<OrganizationStructure
							data={data}
							onChanged={(message) => {
								setSuccess(message);
								remote.reload();
							}}
						/>
					</TabsContent>
				</Tabs>
			)}
			<Dialog
				open={!!classEdit}
				onOpenChange={(open) => {
					if (!open) closeClassDialog();
				}}
			>
				<DialogContent className="sm:max-w-xl">
					<DialogHeader>
						<DialogTitle>
							{current ? `${current.name} · 编辑班级` : "新增班级"}
						</DialogTitle>
						<DialogDescription>
							{current
								? "修改班级名称、编码、责任辅导员或状态；已有学生的班级不能停用或清空辅导员。"
								: "选择所属专业并指派责任辅导员，学生导入时才能匹配到该班级。"}
						</DialogDescription>
					</DialogHeader>
					{classEdit && data && (
						<form
							key={current?.id || "new"}
							className="flex flex-col gap-4"
							onChange={() => setDirty(true)}
							onSubmit={async (event) => {
								event.preventDefault();
								if (busy) return;
								const form = new FormData(event.currentTarget);
								setBusy(true);
								setError("");
								try {
									await requestJson<OrganizationData>("/api/organizations", {
										kind: "class",
										parentId: current?.majorId || classMajorId,
										code: form.get("code"),
										name: form.get("name"),
										enabled: form.get("enabled") === "true",
										counselorId: classCounselorId || null,
										...(current
											? {
													id: current.id,
													revision: current.revision,
													reason: form.get("reason"),
												}
											: {}),
									});
									setDirty(false);
									setError("");
									setClassEdit(null);
									setSuccess(current ? "班级已更新。" : "班级已新增。");
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
								<dl className="grid gap-4 rounded-lg border bg-muted/30 p-3 sm:grid-cols-3">
									{[
										["所属", `${current.collegeName} / ${current.majorName}`],
										["学生人数", String(current.studentCount)],
										["版本", String(current.revision)],
									].map(([label, value]) => (
										<div key={label} className="flex min-w-0 flex-col gap-1">
											<dt className="text-xs text-muted-foreground">{label}</dt>
											<dd className="break-words text-sm">{value}</dd>
										</div>
									))}
								</dl>
							)}
							<FieldGroup className="gap-3">
								{current ? (
									<Field>
										<FieldLabel htmlFor="org-class-major">所属专业</FieldLabel>
										<Input
											id="org-class-major"
											readOnly
											value={`${current.collegeName} / ${current.majorName}`}
										/>
										<FieldDescription>
											班级的专业归属保存后不能直接更换。
										</FieldDescription>
									</Field>
								) : (
									<Field>
										<FieldLabel htmlFor="org-class-major">所属专业</FieldLabel>
										<SearchableSelect
											id="org-class-major"
											value={classMajorId}
											onValueChange={(value) => {
												setClassMajorId(value);
												setClassCounselorId("");
												setDirty(true);
											}}
											placeholder="请选择已启用的专业"
											searchPlaceholder="搜索学院或专业"
											options={classMajorOptions}
											emptyLabel="没有可用的专业，请先在“学院与专业”中新增"
										/>
										<FieldDescription>
											只列出已启用的学院和专业。
										</FieldDescription>
									</Field>
								)}
								<Field>
									<FieldLabel htmlFor="org-class-code">班级编码</FieldLabel>
									<Input
										id="org-class-code"
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
									<FieldLabel htmlFor="org-class-name">班级名称</FieldLabel>
									<Input
										id="org-class-name"
										name="name"
										defaultValue={current?.name}
										required
										maxLength={80}
									/>
								</Field>
								<Field>
									<FieldLabel htmlFor="org-class-counselor">
										责任辅导员
									</FieldLabel>
									<SearchableSelect
										id="org-class-counselor"
										name="counselorId"
										key={`${targetCollegeId || "none"}-${current?.id || "new"}`}
										value={classCounselorId}
										onValueChange={(value) => {
											setClassCounselorId(value);
											setDirty(true);
										}}
										placeholder={
											targetCollegeId ? "暂不分配" : "请先选择所属专业"
										}
										searchPlaceholder="搜索辅导员姓名或账号"
										options={counselorOptions}
										disabled={!targetCollegeId}
									/>
									<FieldDescription>
										只显示班级所属学院的在职辅导员。
									</FieldDescription>
								</Field>
								<Field>
									<FieldLabel htmlFor="org-class-enabled">状态</FieldLabel>
									<NativeSelect
										id="org-class-enabled"
										name="enabled"
										defaultValue={String(current?.enabled ?? true)}
									>
										<NativeSelectOption value="true">启用</NativeSelectOption>
										<NativeSelectOption value="false">停用</NativeSelectOption>
									</NativeSelect>
									<FieldDescription>
										已有学生时不能停用；班级停用后不能继续导入学生。
									</FieldDescription>
								</Field>
								{current && (
									<Field>
										<FieldLabel htmlFor="org-class-reason">修改理由</FieldLabel>
										<Textarea
											id="org-class-reason"
											name="reason"
											required
											minLength={2}
											maxLength={500}
											rows={3}
										/>
									</Field>
								)}
							</FieldGroup>
							<DialogFooter>
								<Button
									type="button"
									variant="outline"
									onClick={closeClassDialog}
									disabled={busy}
								>
									取消
								</Button>
								<Button
									type="submit"
									disabled={busy || (!current && !classMajorId)}
								>
									{busy ? "正在保存…" : "保存班级"}
								</Button>
							</DialogFooter>
						</form>
					)}
				</DialogContent>
			</Dialog>
			<DeleteUsageDialog
				open={!!classDelete}
				onOpenChange={(open) => {
					if (!open) setClassDelete(null);
				}}
				title="删除班级？"
				description="系统会检查学生档案和学籍异动记录。有学生的班级不能删除，请先转班或删除学生账号。"
				usageUrl={
					classDelete
						? `/api/organizations/usage?kind=class&id=${encodeURIComponent(classDelete.id)}`
						: null
				}
				deleteUrl={classDelete ? "/api/organizations" : null}
				confirmLabel="班级名称"
				buildBody={(usage, reason, confirm) => ({
					kind: "class",
					id: usage.id,
					revision: usage.revision,
					reason,
					confirmName: confirm,
				})}
				onDeleted={() => {
					const name = classDelete?.name;
					setClassDelete(null);
					setSuccess(`班级“${name}”已删除。`);
					remote.reload();
				}}
			/>
		</>
	);
}
