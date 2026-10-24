"use client";
// Structure tab adapted from the template's users directory: two flat,
// independently filterable tables with centered create/edit dialogs.
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import {
	Landmark,
	Layers3,
	Plus,
	RotateCcw,
	School,
	Search,
	Users,
} from "lucide-react";
import type { DataTableFeatures } from "@/lib/data-table-features";
import type {
	College,
	Major,
	OrganizationData,
} from "@/lib/organization-types";
import { TemplateDirectory } from "@/components/dashboard/template-directory";
import { DeleteUsageDialog } from "@/components/dashboard/delete-usage-dialog";
import { Feedback, requestJson } from "@/components/dashboard/feedback";
import { SearchableSelect } from "@/components/dashboard/searchable-select";
import { useUnsavedChanges } from "@/components/dashboard/use-unsaved-changes";
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
import {
	NativeSelect,
	NativeSelectOption,
} from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";

type CollegeRow = College & {
	majorCount: number;
	classCount: number;
	studentCount: number;
};
type MajorRow = Major & {
	collegeId: string;
	collegeName: string;
	collegeCode: string;
	collegeEnabled: boolean;
	classCount: number;
	studentCount: number;
};
type StructureForm =
	| { kind: "college"; row?: College }
	| { kind: "major"; row?: Major; collegeId: string };
type DeleteTarget = { kind: "college" | "major"; id: string; name: string };

function collegeRows(data: OrganizationData): CollegeRow[] {
	return data.colleges.map((college) => ({
		...college,
		majorCount: college.majors.length,
		classCount: college.majors.reduce(
			(sum, major) => sum + major.classes.length,
			0,
		),
		studentCount: college.majors.reduce(
			(sum, major) =>
				sum +
				major.classes.reduce(
					(classSum, schoolClass) => classSum + schoolClass.studentCount,
					0,
				),
			0,
		),
	}));
}

function majorRows(data: OrganizationData): MajorRow[] {
	return data.colleges.flatMap((college) =>
		college.majors.map((major) => ({
			...major,
			collegeId: college.id,
			collegeName: college.name,
			collegeCode: college.code,
			collegeEnabled: college.enabled,
			classCount: major.classes.length,
			studentCount: major.classes.reduce(
				(sum, schoolClass) => sum + schoolClass.studentCount,
				0,
			),
		})),
	);
}

function resetButton(show: boolean, reset: () => void) {
	return (
		show && (
			<Button type="button" variant="ghost" size="sm" onClick={reset}>
				<RotateCcw data-icon="inline-start" />
				重置筛选
			</Button>
		)
	);
}

export function OrganizationStructure({
	data,
	onChanged,
}: {
	data: OrganizationData;
	onChanged: (message: string) => void;
}) {
	const params = useSearchParams();
	const [collegeQuery, setCollegeQuery] = useState(
		(params.get("scq") || "").slice(0, 80),
	);
	const [collegeStatus, setCollegeStatus] = useState(
		params.get("scstatus") || "",
	);
	const [collegePage, setCollegePage] = useState(
		Math.max(1, Math.floor(Number(params.get("scpage")) || 1)),
	);
	const [majorQuery, setMajorQuery] = useState(
		(params.get("smq") || "").slice(0, 80),
	);
	const [majorCollege, setMajorCollege] = useState(
		params.get("smcollege") || "",
	);
	const [majorStatus, setMajorStatus] = useState(params.get("smstatus") || "");
	const [majorPage, setMajorPage] = useState(
		Math.max(1, Math.floor(Number(params.get("smpage")) || 1)),
	);
	const [form, setForm] = useState<StructureForm | null>(null);
	const [formCollegeId, setFormCollegeId] = useState("");
	const [busy, setBusy] = useState(false);
	const [dirty, setDirty] = useState(false);
	const [error, setError] = useState("");
	const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
	useUnsavedChanges(dirty || busy);
	const colleges = collegeRows(data);
	const majors = majorRows(data);
	const enabledCollegeCount = colleges.filter((college) => college.enabled).length;
	const enabledMajorCount = majors.filter((major) => major.enabled).length;
	const totalClasses = majors.reduce((sum, major) => sum + major.classCount, 0);
	const totalStudents = majors.reduce(
		(sum, major) => sum + major.studentCount,
		0,
	);
	const collegeNeedle = collegeQuery.trim().toLocaleLowerCase();
	const filteredColleges = colleges.filter((college) => {
		if (collegeStatus === "enabled" && !college.enabled) return false;
		if (collegeStatus === "disabled" && college.enabled) return false;
		return !collegeNeedle || `${college.name} ${college.code}`.toLocaleLowerCase().includes(collegeNeedle);
	});
	const majorNeedle = majorQuery.trim().toLocaleLowerCase();
	const filteredMajors = majors.filter((major) => {
		if (majorCollege && major.collegeId !== majorCollege) return false;
		if (majorStatus === "enabled" && !major.enabled) return false;
		if (majorStatus === "disabled" && major.enabled) return false;
		return !majorNeedle || `${major.name} ${major.code} ${major.collegeName} ${major.collegeCode}`.toLocaleLowerCase().includes(majorNeedle);
	});
	const collegePageCount = Math.max(1, Math.ceil(filteredColleges.length / 20));
	const safeCollegePage = Math.min(collegePage, collegePageCount);
	const visibleColleges = filteredColleges.slice(
		(safeCollegePage - 1) * 20,
		safeCollegePage * 20,
	);
	const majorPageCount = Math.max(1, Math.ceil(filteredMajors.length / 20));
	const safeMajorPage = Math.min(majorPage, majorPageCount);
	const visibleMajors = filteredMajors.slice(
		(safeMajorPage - 1) * 20,
		safeMajorPage * 20,
	);
	const hasCollegeFilter = !!collegeQuery || !!collegeStatus;
	const hasMajorFilter = !!majorQuery || !!majorCollege || !!majorStatus;
	const collegeOptions = data.colleges.map((college) => ({
		value: college.id,
		label: `${college.name}（${college.code}）`,
	}));

	function updateUrl(updates: Record<string, string | null>) {
		const search = new URLSearchParams(window.location.search);
		for (const [key, value] of Object.entries(updates)) {
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
	function openForm(next: StructureForm) {
		setDirty(false);
		setError("");
		setForm(next);
		setFormCollegeId(next.kind === "major" ? next.collegeId : "");
	}
	function closeForm() {
		if (busy) return;
		if (dirty && !window.confirm("放弃尚未保存的修改？")) return;
		setDirty(false);
		setError("");
		setForm(null);
	}
	const collegeColumns: ColumnDef<DataTableFeatures, CollegeRow>[] = [
		{
			accessorKey: "name",
			header: "学院",
			cell: ({ row }) => (
				<div className="min-w-0">
					<p className="font-medium">{row.original.name}</p>
					<p className="text-xs text-muted-foreground">{row.original.code}</p>
				</div>
			),
		},
		{
			id: "status",
			header: "状态",
			cell: ({ row }) => (
				<Badge variant={row.original.enabled ? "outline" : "secondary"}>
					{row.original.enabled ? "启用" : "停用"}
				</Badge>
			),
		},
		{
			id: "majors",
			header: "专业",
			cell: ({ row }) => (
				<span className="tabular-nums">{row.original.majorCount}</span>
			),
		},
		{
			id: "classes",
			header: "班级",
			cell: ({ row }) => (
				<span className="tabular-nums">{row.original.classCount}</span>
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
			id: "actions",
			header: "操作",
			cell: ({ row }) =>
				data.role === "ADMIN" ? (
					<div className="flex items-center gap-1">
						<Button
							variant="ghost"
							size="sm"
							onClick={() => openForm({ kind: "college", row: row.original })}
						>
							编辑
						</Button>
						<Button
							variant="ghost"
							size="sm"
							className="text-destructive hover:text-destructive"
							onClick={() =>
								setDeleteTarget({
									kind: "college",
									id: row.original.id,
									name: row.original.name,
								})
							}
						>
							删除
						</Button>
					</div>
				) : (
					<span className="text-muted-foreground">—</span>
				),
		},
	];
	const majorColumns: ColumnDef<DataTableFeatures, MajorRow>[] = [
		{
			accessorKey: "name",
			header: "专业",
			cell: ({ row }) => (
				<div className="min-w-0">
					<p className="font-medium">{row.original.name}</p>
					<p className="text-xs text-muted-foreground">{row.original.code}</p>
				</div>
			),
		},
		{
			id: "college",
			header: "所属学院",
			cell: ({ row }) => (
				<div className="min-w-0">
					<p>{row.original.collegeName}</p>
					<p className="text-xs text-muted-foreground">
						{row.original.collegeCode}
					</p>
				</div>
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
					{!row.original.collegeEnabled && (
						<span className="text-xs text-muted-foreground">学院已停用</span>
					)}
				</div>
			),
		},
		{
			id: "classes",
			header: "班级",
			cell: ({ row }) => (
				<span className="tabular-nums">{row.original.classCount}</span>
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
			id: "actions",
			header: "操作",
			cell: ({ row }) => (
				<div className="flex items-center gap-1">
					<Button
						variant="ghost"
						size="sm"
						onClick={() =>
							openForm({
								kind: "major",
								row: row.original,
								collegeId: row.original.collegeId,
							})
						}
					>
						编辑
					</Button>
					<Button
						variant="ghost"
						size="sm"
						className="text-destructive hover:text-destructive"
						onClick={() =>
							setDeleteTarget({
								kind: "major",
								id: row.original.id,
								name: row.original.name,
							})
						}
					>
						删除
					</Button>
				</div>
			),
		},
	];
	return (
		<div className="flex min-w-0 flex-col gap-3">
			<div className="grid min-w-0 grid-cols-2 gap-3 xl:grid-cols-4">
				{[
					{
						label: "学院",
						value: colleges.length,
						hint: `${enabledCollegeCount} 个启用 · ${colleges.length - enabledCollegeCount} 个停用`,
						icon: Landmark,
					},
					{
						label: "专业",
						value: majors.length,
						hint: `${enabledMajorCount} 个启用 · ${majors.length - enabledMajorCount} 个停用`,
						icon: Layers3,
					},
					{
						label: "班级",
						value: totalClasses,
						hint: "全部专业下的班级",
						icon: School,
					},
					{
						label: "学生",
						value: totalStudents,
						hint: "已分班学生",
						icon: Users,
					},
				].map((item) => (
					<Card key={item.label} size="sm" className="min-w-0 shadow-xs">
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
			<TemplateDirectory
				title="学院"
				description="学院是组织目录的最高层级。学院下仍存在专业、账号或活动时不能删除。"
				data={visibleColleges}
				columns={collegeColumns}
				actions={
					data.role === "ADMIN" ? (
						<Button size="sm" onClick={() => openForm({ kind: "college" })}>
							<Plus data-icon="inline-start" />
							新增学院
						</Button>
					) : undefined
				}
				filters={
					<div className="flex w-full flex-col gap-3">
						<div className="flex flex-wrap items-end gap-3">
							<Field className="w-full sm:w-64">
								<FieldLabel htmlFor="structure-college-query">搜索</FieldLabel>
								<InputGroup>
									<InputGroupAddon align="inline-start">
										<Search />
									</InputGroupAddon>
									<InputGroupInput
										id="structure-college-query"
										value={collegeQuery}
										maxLength={80}
										onChange={(event) => {
											const value = event.target.value;
											setCollegeQuery(value);
											setCollegePage(1);
											updateUrl({ scq: value || null, scpage: null });
										}}
										placeholder="学院名称或编码"
										aria-label="搜索学院名称或编码"
									/>
								</InputGroup>
							</Field>
							<Field className="w-full sm:w-36">
								<FieldLabel htmlFor="structure-college-status">状态</FieldLabel>
								<NativeSelect
									id="structure-college-status"
									value={collegeStatus}
									onChange={(event) => {
										const value = event.target.value;
										setCollegeStatus(value);
										setCollegePage(1);
										updateUrl({ scstatus: value || null, scpage: null });
									}}
								>
									<NativeSelectOption value="">全部状态</NativeSelectOption>
									<NativeSelectOption value="enabled">启用</NativeSelectOption>
									<NativeSelectOption value="disabled">停用</NativeSelectOption>
								</NativeSelect>
							</Field>
							{resetButton(hasCollegeFilter, () => {
								setCollegeQuery("");
								setCollegeStatus("");
								setCollegePage(1);
								updateUrl({ scq: null, scstatus: null, scpage: null });
							})}
						</div>
						<p className="text-xs text-muted-foreground">
							共 {filteredColleges.length} 个学院
							{hasCollegeFilter ? `（全部 ${colleges.length} 个）` : ""}
						</p>
					</div>
				}
				pagination={{
					page: safeCollegePage,
					total: filteredColleges.length,
					href: () => "/organizations?view=structure",
					onPageChange: (next) => {
						setCollegePage(next);
						updateUrl({ scpage: next > 1 ? String(next) : null });
					},
				}}
				empty={{
					title: hasCollegeFilter ? "没有匹配的学院" : "还没有学院",
					description: hasCollegeFilter
						? "调整筛选条件或重置后重试。"
						: "新增学院后即可继续建立专业和班级。",
				}}
				mobile={(row) => (
					<div className="flex flex-col gap-3">
						<div className="flex items-start justify-between gap-3">
							<div className="min-w-0">
								<p className="font-medium">{row.name}</p>
								<p className="text-xs text-muted-foreground">{row.code}</p>
							</div>
							<Badge variant={row.enabled ? "outline" : "secondary"}>
								{row.enabled ? "启用" : "停用"}
							</Badge>
						</div>
						<p className="text-sm text-muted-foreground">
							{row.majorCount} 个专业 · {row.classCount} 个班级 · {row.studentCount} 名学生
						</p>
						{data.role === "ADMIN" && (
							<div className="flex flex-wrap gap-2">
								<Button
									variant="outline"
									size="sm"
									onClick={() => openForm({ kind: "college", row })}
								>
									编辑学院
								</Button>
								<Button
									variant="outline"
									size="sm"
									className="text-destructive"
									onClick={() =>
										setDeleteTarget({ kind: "college", id: row.id, name: row.name })
									}
								>
									删除
								</Button>
							</div>
						)}
					</div>
				)}
			/>
			<TemplateDirectory
				title="专业"
				description="专业归属于学院。专业下仍有班级时不能删除；已有学生时请先处理学生档案。"
				data={visibleMajors}
				columns={majorColumns}
				actions={
					<Button
						size="sm"
						onClick={() =>
							openForm({
								kind: "major",
								collegeId:
									majorCollege ||
									data.colleges.find((college) => college.enabled)?.id ||
									data.colleges[0]?.id ||
									"",
							})
						}
						disabled={!data.colleges.length}
					>
						<Plus data-icon="inline-start" />
						新增专业
					</Button>
				}
				filters={
					<div className="flex w-full flex-col gap-3">
						<div className="flex flex-wrap items-end gap-3">
							<Field className="w-full sm:w-64">
								<FieldLabel htmlFor="structure-major-query">搜索</FieldLabel>
								<InputGroup>
									<InputGroupAddon align="inline-start">
										<Search />
									</InputGroupAddon>
									<InputGroupInput
										id="structure-major-query"
										value={majorQuery}
										maxLength={80}
										onChange={(event) => {
											const value = event.target.value;
											setMajorQuery(value);
											setMajorPage(1);
											updateUrl({ smq: value || null, smpage: null });
										}}
										placeholder="专业名称、编码或学院"
										aria-label="搜索专业名称、编码或学院"
									/>
								</InputGroup>
							</Field>
							<Field className="w-full sm:w-44">
								<FieldLabel htmlFor="structure-major-college">学院</FieldLabel>
								<NativeSelect
									id="structure-major-college"
									value={majorCollege}
									onChange={(event) => {
										const value = event.target.value;
										setMajorCollege(value);
										setMajorPage(1);
										updateUrl({ smcollege: value || null, smpage: null });
									}}
								>
									<NativeSelectOption value="">全部学院</NativeSelectOption>
									{data.colleges.map((college) => (
										<NativeSelectOption key={college.id} value={college.id}>
											{college.name}
										</NativeSelectOption>
									))}
								</NativeSelect>
							</Field>
							<Field className="w-full sm:w-36">
								<FieldLabel htmlFor="structure-major-status">状态</FieldLabel>
								<NativeSelect
									id="structure-major-status"
									value={majorStatus}
									onChange={(event) => {
										const value = event.target.value;
										setMajorStatus(value);
										setMajorPage(1);
										updateUrl({ smstatus: value || null, smpage: null });
									}}
								>
									<NativeSelectOption value="">全部状态</NativeSelectOption>
									<NativeSelectOption value="enabled">启用</NativeSelectOption>
									<NativeSelectOption value="disabled">停用</NativeSelectOption>
								</NativeSelect>
							</Field>
							{resetButton(hasMajorFilter, () => {
								setMajorQuery("");
								setMajorCollege("");
								setMajorStatus("");
								setMajorPage(1);
								updateUrl({
									smq: null,
									smcollege: null,
									smstatus: null,
									smpage: null,
								});
							})}
						</div>
						<p className="text-xs text-muted-foreground">
							共 {filteredMajors.length} 个专业
							{hasMajorFilter ? `（全部 ${majors.length} 个）` : ""}
						</p>
					</div>
				}
				pagination={{
					page: safeMajorPage,
					total: filteredMajors.length,
					href: () => "/organizations?view=structure",
					onPageChange: (next) => {
						setMajorPage(next);
						updateUrl({ smpage: next > 1 ? String(next) : null });
					},
				}}
				empty={{
					title: hasMajorFilter ? "没有匹配的专业" : "还没有专业",
					description: hasMajorFilter
						? "调整筛选条件或重置后重试。"
						: "在已启用的学院下新增专业。",
				}}
				mobile={(row) => (
					<div className="flex flex-col gap-3">
						<div className="flex items-start justify-between gap-3">
							<div className="min-w-0">
								<p className="font-medium">{row.name}</p>
								<p className="text-xs text-muted-foreground">
									{row.code} · {row.collegeName}
								</p>
							</div>
							<Badge variant={row.enabled ? "outline" : "secondary"}>
								{row.enabled ? "启用" : "停用"}
							</Badge>
						</div>
						<p className="text-sm text-muted-foreground">
							{row.classCount} 个班级 · {row.studentCount} 名学生
						</p>
						<div className="flex flex-wrap gap-2">
							<Button
								variant="outline"
								size="sm"
								onClick={() =>
									openForm({
										kind: "major",
										row,
										collegeId: row.collegeId,
									})
								}
							>
								编辑专业
							</Button>
							<Button
								variant="outline"
								size="sm"
								className="text-destructive"
								onClick={() =>
									setDeleteTarget({ kind: "major", id: row.id, name: row.name })
								}
							>
								删除
							</Button>
						</div>
					</div>
				)}
			/>
			<Dialog
				open={!!form}
				onOpenChange={(open) => {
					if (!open) closeForm();
				}}
			>
				<DialogContent className="sm:max-w-lg">
					<DialogHeader>
						<DialogTitle>
							{form?.row
								? `编辑${form.kind === "college" ? "学院" : "专业"}`
								: `新增${form?.kind === "college" ? "学院" : "专业"}`}
						</DialogTitle>
						<DialogDescription>
							{form?.row
								? "编码在层级内唯一。有下级组织、学生或绑定账号时不能停用。"
								: form?.kind === "major"
									? "专业归属于学院，创建后不能直接更换所属学院。"
									: "学院编码在全校唯一，创建后可在本页继续维护专业。"}
						</DialogDescription>
					</DialogHeader>
					{form && (
						<form
							key={`${form.kind}-${form.row?.id || "new"}`}
							className="flex flex-col gap-4"
							onChange={() => setDirty(true)}
							onSubmit={async (event) => {
								event.preventDefault();
								if (busy) return;
								const values = new FormData(event.currentTarget);
								setBusy(true);
								setError("");
								try {
									await requestJson<OrganizationData>("/api/organizations", {
										kind: form.kind,
										code: values.get("code"),
										name: values.get("name"),
										enabled: values.get("enabled") === "true",
										...(form.kind === "major"
											? { parentId: form.row ? form.collegeId : formCollegeId }
											: {}),
										...(form.row
											? {
													id: form.row.id,
													revision: form.row.revision,
													reason: values.get("reason"),
												}
											: {}),
									});
									const message = form.row
										? `${form.kind === "college" ? "学院" : "专业"}已更新。`
										: `${form.kind === "college" ? "学院" : "专业"}已新增。`;
									setDirty(false);
									setError("");
									setForm(null);
									onChanged(message);
								} catch (err) {
									setError((err as Error).message);
								} finally {
									setBusy(false);
								}
							}}
						>
							<Feedback error={error} />
							<FieldGroup className="gap-3">
								{form.kind === "major" && (
									<Field>
										<FieldLabel htmlFor="structure-form-college">
											所属学院
										</FieldLabel>
										{form.row ? (
											<Input
												id="structure-form-college"
												readOnly
												value={
													data.colleges.find(
														(college) => college.id === form.collegeId,
													)?.name || ""
												}
											/>
										) : data.role === "ADMIN" ? (
											<SearchableSelect
												id="structure-form-college"
												value={formCollegeId}
												onValueChange={(value) => {
													setFormCollegeId(value);
													setDirty(true);
												}}
												placeholder="请选择学院"
												searchPlaceholder="搜索学院名称或编码"
												options={collegeOptions}
												emptyLabel="没有可用的学院"
											/>
										) : (
											<Input
												id="structure-form-college"
												readOnly
												value={
													data.colleges.find(
														(college) => college.id === formCollegeId,
													)?.name || ""
												}
											/>
										)}
									</Field>
								)}
								<Field>
									<FieldLabel htmlFor="structure-form-code">编码</FieldLabel>
									<Input
										id="structure-form-code"
										name="code"
										defaultValue={form.row?.code}
										required
										maxLength={40}
										pattern="[A-Za-z0-9._-]+"
									/>
									<FieldDescription>
										可用字母、数字、点、下划线或连字符；保存时会转为大写。
									</FieldDescription>
								</Field>
								<Field>
									<FieldLabel htmlFor="structure-form-name">名称</FieldLabel>
									<Input
										id="structure-form-name"
										name="name"
										defaultValue={form.row?.name}
										required
										maxLength={80}
									/>
								</Field>
								<Field>
									<FieldLabel htmlFor="structure-form-enabled">状态</FieldLabel>
									<NativeSelect
										id="structure-form-enabled"
										name="enabled"
										defaultValue={String(form.row?.enabled ?? true)}
									>
										<NativeSelectOption value="true">启用</NativeSelectOption>
										<NativeSelectOption value="false">停用</NativeSelectOption>
									</NativeSelect>
									<FieldDescription>
										停用后不可再用于新的班级或学生；已有关联数据时系统会阻止停用。
									</FieldDescription>
								</Field>
								{form.row && (
									<Field>
										<FieldLabel htmlFor="structure-form-reason">修改理由</FieldLabel>
										<Textarea
											id="structure-form-reason"
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
									onClick={closeForm}
									disabled={busy}
								>
									取消
								</Button>
								<Button
									type="submit"
									disabled={
										busy ||
										(form.kind === "major" && !form.row && !formCollegeId)
									}
								>
									{busy ? "正在保存…" : "保存"}
								</Button>
							</DialogFooter>
						</form>
					)}
				</DialogContent>
			</Dialog>
			<DeleteUsageDialog
				open={!!deleteTarget}
				onOpenChange={(open) => {
					if (!open) setDeleteTarget(null);
				}}
				title={
					deleteTarget?.kind === "college" ? "删除学院？" : "删除专业？"
				}
				description="系统会先检查下级组织、账号和业务记录。存在关联数据时只能停用，不能删除。"
				usageUrl={
					deleteTarget
						? `/api/organizations/usage?kind=${deleteTarget.kind}&id=${encodeURIComponent(deleteTarget.id)}`
						: null
				}
				deleteUrl={deleteTarget ? "/api/organizations" : null}
				confirmLabel="组织名称"
				buildBody={(usage, reason, confirm) => ({
					kind: deleteTarget?.kind,
					id: usage.id,
					revision: usage.revision,
					reason,
					confirmName: confirm,
				})}
				onDeleted={() => {
					const label = deleteTarget?.kind === "college" ? "学院" : "专业";
					const name = deleteTarget?.name;
					setDeleteTarget(null);
					onChanged(`${label}“${name}”已删除。`);
				}}
			/>
		</div>
	);
}
