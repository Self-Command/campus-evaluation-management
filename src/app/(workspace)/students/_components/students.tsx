"use client";
// Complete users directory + profile personal-details and invoice field groups from the selected template.
import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import type { DataTableFeatures } from "@/lib/data-table-features";
import { TemplateDirectory } from "@/components/dashboard/template-directory";
import { useRemote } from "@/components/dashboard/use-remote";
import { RemoteState } from "@/components/dashboard/remote-state";
import { Feedback, requestJson } from "@/components/dashboard/feedback";
import { useUnsavedChanges } from "@/components/dashboard/use-unsaved-changes";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
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
import { dateText } from "@/lib/business-labels";
import { OrganizationFields } from "@/components/dashboard/organization-fields";
import type {
	OrganizationData,
	StudentOrganization,
} from "@/lib/organization-types";
type Student = {
	id: string;
	login: string;
	name: string;
	revision: number;
	disabled: boolean;
	createdAt: string;
	studentProfile: StudentOrganization;
};
type Scope = { college: string; major: string; className: string };
type AffiliationHistory = {
	id: string;
	classId: string | null;
	identity: { college?: string; major?: string; className?: string };
	startedAt: string;
	endedAt: string | null;
	reason: string;
};
export function Students({
	role,
}: {
	role: "ADMIN" | "COLLEGE" | "COUNSELOR";
}) {
	const params = useSearchParams();
	const [query, setQuery] = useState(params.get("q") || "");
	const [draft, setDraft] = useState(query);
	const [scope, setScope] = useState<Scope>({
		college: params.get("college") || "",
		major: params.get("major") || "",
		className: params.get("className") || "",
	});
	const [draftScope, setDraftScope] = useState(scope);
	const [page, setPage] = useState(
		Math.max(1, Math.min(100000, Math.floor(Number(params.get("page")) || 1))),
	);
	const remote = useRemote<{
		items: Student[];
		total: number;
		page: number;
		scopeOptions: { colleges: string[]; majors: string[]; classes: string[] };
	}>(
		`/api/students?${new URLSearchParams({ q: query, ...scope, page: String(page) })}`,
	);
	const [selected, setSelected] = useState<Student | null>(null);
	const details = useRemote<
		Student & { affiliationHistory?: AffiliationHistory[] }
	>(selected ? `/api/students/${selected.id}` : null);
	const [editing, setEditing] = useState(false);
	const [dirty, setDirty] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [success, setSuccess] = useState("");
	const organizations = useRemote<OrganizationData>(
		editing ? "/api/organizations" : null,
	);
	const canEdit = role === "ADMIN" || role === "COLLEGE";
	function updateLocation(
		nextQuery: string,
		nextScope: Scope,
		nextPage: number,
	) {
		window.history.replaceState(
			null,
			"",
			`/students?${new URLSearchParams({ q: nextQuery, ...nextScope, page: String(nextPage) })}`,
		);
	}
	useUnsavedChanges(dirty || busy);
	function open(row: Student) {
		setSelected(row);
		setEditing(false);
		setDirty(false);
		setError("");
		setSuccess("");
	}
	const columns: ColumnDef<DataTableFeatures, Student>[] = [
		{
			accessorKey: "name",
			header: "学生",
			cell: ({ row }) => (
				<div>
					<p className="font-medium">{row.original.name}</p>
					<p className="text-xs text-muted-foreground">
						{row.original.studentProfile.studentNumber || row.original.login}
					</p>
				</div>
			),
		},
		{
			id: "college",
			header: "学院",
			cell: ({ row }) => row.original.studentProfile.college,
		},
		{
			id: "major",
			header: "专业",
			cell: ({ row }) => row.original.studentProfile.major,
		},
		{
			id: "className",
			header: "班级",
			cell: ({ row }) => row.original.studentProfile.className,
		},
		{
			id: "counselor",
			header: "责任辅导员 / 归属",
			cell: ({ row }) => (
				<div>
					<p>
						{row.original.studentProfile.schoolClass?.counselor?.name ||
							"待完善"}
					</p>
					{!row.original.studentProfile.classId && (
						<Badge variant="secondary">归属待完善</Badge>
					)}
				</div>
			),
		},
		{ accessorKey: "revision", header: "档案修订" },
		{
			accessorKey: "createdAt",
			header: "建档时间",
			cell: ({ row }) => dateText(row.original.createdAt),
		},
		{
			id: "actions",
			header: "操作",
			cell: ({ row }) => (
				<Button variant="ghost" size="sm" onClick={() => open(row.original)}>
					档案详情
				</Button>
			),
		},
	];
	return (
		<>
			<RemoteState {...remote} />
			{remote.data && (
				<TemplateDirectory
					title="学生档案名录"
					description={`共 ${remote.data.total} 位匹配学生。维护当前组织归属，已发布版本使用当时冻结的档案。`}
					data={remote.data.items}
					columns={columns}
					actions={
						role === "ADMIN" && (
							<Link
								href="/imports?kind=accounts"
								className={buttonVariants({ variant: "outline", size: "sm" })}
							>
								导入学生档案
							</Link>
						)
					}
					filters={
						<form
							className="flex w-full flex-wrap items-end gap-3"
							onSubmit={(event) => {
								event.preventDefault();
								setQuery(draft.trim());
								setScope(draftScope);
								setPage(1);
								updateLocation(draft.trim(), draftScope, 1);
							}}
						>
							<Field className="w-full sm:w-64">
								<FieldLabel htmlFor="student-profile-query">
									姓名或学号
								</FieldLabel>
								<Input
									id="student-profile-query"
									value={draft}
									maxLength={80}
									onChange={(event) => setDraft(event.target.value)}
									placeholder="搜索姓名或学号"
								/>
							</Field>
							{(
								[
									["college", "学院", "colleges"],
									["major", "专业", "majors"],
									["className", "班级", "classes"],
								] as const
							).map(([key, label, options]) => (
								<Field className="w-full sm:w-44" key={key}>
									<FieldLabel htmlFor={`profile-scope-${key}`}>
										{label}
									</FieldLabel>
									<NativeSelect
										id={`profile-scope-${key}`}
										value={draftScope[key]}
										onChange={(event) => {
											const next = {
												...draftScope,
												[key]: event.target.value,
												...(key === "college"
													? { major: "", className: "" }
													: key === "major"
														? { className: "" }
														: {}),
											};
											setDraftScope(next);
											setScope(next);
											setQuery(draft.trim());
											setPage(1);
											updateLocation(draft.trim(), next, 1);
										}}
									>
										<NativeSelectOption value="">
											全部{label}
										</NativeSelectOption>
										{remote.data!.scopeOptions[options].map((value) => (
											<NativeSelectOption key={value} value={value}>
												{value}
											</NativeSelectOption>
										))}
									</NativeSelect>
								</Field>
							))}
							<Button variant="outline">筛选档案</Button>
							<Button
								type="button"
								variant="ghost"
								onClick={() => {
									setDraft("");
									setQuery("");
									setScope({ college: "", major: "", className: "" });
									setDraftScope({ college: "", major: "", className: "" });
									setPage(1);
									updateLocation(
										"",
										{ college: "", major: "", className: "" },
										1,
									);
								}}
							>
								全部学生
							</Button>
						</form>
					}
					pagination={{
						page: remote.data.page,
						total: remote.data.total,
						href: (next) =>
							`/students?${new URLSearchParams({ q: query, ...scope, page: String(next) })}`,
						onPageChange: (next) => {
							setPage(next);
							updateLocation(query, scope, next);
						},
					}}
					mobile={(row) => (
						<div className="flex flex-col gap-3">
							<div>
								<p className="font-medium">{row.name}</p>
								<p className="text-xs text-muted-foreground">
									{row.studentProfile.studentNumber || row.login}
								</p>
							</div>
							<p className="text-sm">
								{row.studentProfile.college} · {row.studentProfile.major} ·{" "}
								{row.studentProfile.className}
							</p>
							<p className="text-xs text-muted-foreground">
								修订 {row.revision} · {dateText(row.createdAt)}
							</p>
							<p className="text-sm">
								责任辅导员：
								{row.studentProfile.schoolClass?.counselor?.name || "待完善"}
								{!row.studentProfile.classId ? " · 归属待完善" : ""}
							</p>
							<Button
								variant="outline"
								className="self-start"
								onClick={() => open(row)}
							>
								档案详情
							</Button>
						</div>
					)}
				/>
			)}
			<Sheet
				open={!!selected}
				onOpenChange={(open) => {
					if (
						!open &&
						!busy &&
						(!dirty || window.confirm("放弃尚未保存的档案修改？"))
					) {
						setSelected(null);
						setDirty(false);
					}
				}}
			>
				<SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
					<SheetHeader>
						<SheetTitle>{selected?.name} 的学生档案</SheetTitle>
						<SheetDescription>
							学号与身份标识只读，档案更正保留理由和修订。
						</SheetDescription>
					</SheetHeader>
					{selected && (
						<div className="flex flex-col gap-6 px-5 pb-6">
							<Feedback error={error} success={success} />
							<RemoteState {...details} />
							<dl className="grid gap-6 sm:grid-cols-2">
								{[
									[
										"学号",
										selected.studentProfile.studentNumber || selected.login,
									],
									["姓名", selected.name],
									["学院", selected.studentProfile.college],
									["专业", selected.studentProfile.major],
									["班级", selected.studentProfile.className],
									[
										"责任辅导员",
										selected.studentProfile.schoolClass?.counselor?.name ||
											"待完善",
									],
									[
										"组织归属状态",
										selected.studentProfile.classId ? "已配置班级" : "待完善",
									],
									["档案修订", String(selected.revision)],
									["建档时间", dateText(selected.createdAt)],
								].map(([label, value]) => (
									<div className="flex flex-col gap-1" key={label}>
										<dt className="text-xs text-muted-foreground">{label}</dt>
										<dd className="break-words text-sm">{value}</dd>
									</div>
								))}
							</dl>
							<Badge variant="outline" className="self-start">
								{selected.disabled ? "当前账号已停用" : "当前账号正常"}
							</Badge>
							{details.data && (
								<section className="flex flex-col gap-3 border-t pt-5">
									<h2 className="font-medium text-base">归属变更历史</h2>
									<p className="text-xs text-muted-foreground">
										最近20条归属记录；已发布身份快照保持不变。
									</p>
									{!details.data.affiliationHistory?.length && (
										<p className="text-sm text-muted-foreground">
											暂无归属变更记录。
										</p>
									)}
									{details.data.affiliationHistory?.map((item) => (
										<dl
											key={item.id}
											className="grid gap-4 border-b pb-4 sm:grid-cols-2"
										>
											{[
												[
													"归属",
													[
														item.identity.college,
														item.identity.major,
														item.identity.className,
													]
														.filter(Boolean)
														.join(" / ") || "未绑定班级",
												],
												["生效时间", dateText(item.startedAt)],
												[
													"结束时间",
													item.endedAt ? dateText(item.endedAt) : "当前有效",
												],
												["变更理由", item.reason],
											].map(([label, value]) => (
												<div key={label} className="flex flex-col gap-1">
													<dt className="text-xs text-muted-foreground">
														{label}
													</dt>
													<dd className="break-words text-sm">{value}</dd>
												</div>
											))}
										</dl>
									))}
								</section>
							)}
							{!editing ? (
								canEdit && (
									<Button
										variant="outline"
										className="self-start"
										onClick={() => {
											setEditing(true);
											setError("");
											setSuccess("");
										}}
									>
										更正学生档案
									</Button>
								)
							) : (
								<form
									key={`${selected.id}-${selected.revision}`}
									className="flex flex-col gap-5 border-t pt-5"
									onChange={() => setDirty(true)}
									onSubmit={async (event) => {
										event.preventDefault();
										if (busy) return;
										const form = new FormData(event.currentTarget);
										setBusy(true);
										setError("");
										setSuccess("");
										try {
											const updated = await requestJson<Student>(
												`/api/students/${selected.id}`,
												{
													revision: selected.revision,
													reason: form.get("reason"),
													name: form.get("name"),
													classId: form.get("classId"),
												},
												"PATCH",
											);
											setSelected(updated);
											setDirty(false);
											setEditing(false);
											setSuccess("学生档案已更正。");
											remote.reload();
											details.reload();
										} catch (err) {
											setError((err as Error).message);
										} finally {
											setBusy(false);
										}
									}}
								>
									<FieldGroup>
										<Field>
											<FieldLabel htmlFor="student-edit-name">姓名</FieldLabel>
											<Input
												id="student-edit-name"
												name="name"
												defaultValue={selected.name}
												required
												maxLength={80}
											/>
										</Field>
										<RemoteState {...organizations} />
										{organizations.data && (
											<OrganizationFields
												key={`${selected.id}-${selected.revision}`}
												data={organizations.data}
												initialClassId={selected.studentProfile.classId}
												prefix="student-edit"
												onChange={() => setDirty(true)}
											/>
										)}
										<Field>
											<FieldLabel htmlFor="student-edit-reason">
												更正理由
											</FieldLabel>
											<Textarea
												id="student-edit-reason"
												name="reason"
												required
												minLength={2}
												maxLength={500}
												rows={3}
											/>
										</Field>
									</FieldGroup>
									<div className="flex flex-wrap gap-3">
										<Button disabled={busy || !organizations.data}>
											保存档案更正
										</Button>
										<Button
											type="button"
											variant="outline"
											disabled={busy}
											onClick={() => {
												if (
													dirty &&
													!window.confirm("放弃尚未保存的档案修改？")
												)
													return;
												setDirty(false);
												setEditing(false);
											}}
										>
											取消更正
										</Button>
									</div>
								</form>
							)}
						</div>
					)}
				</SheetContent>
			</Sheet>
		</>
	);
}
