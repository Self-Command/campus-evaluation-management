"use client";
// Complete users directory + profile personal-details and invoice field groups from the selected template.
import { useState, type FormEvent } from "react";
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
import {
	Field,
	FieldDescription,
	FieldGroup,
	FieldLabel,
} from "@/components/ui/field";
import { SearchableSelect } from "@/components/dashboard/searchable-select";
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
	SheetDescription,
} from "@/components/ui/sheet";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { DeleteUsageDialog } from "@/components/dashboard/delete-usage-dialog";
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
	const [deleting, setDeleting] = useState<Student | null>(null);
	const [numberOpen, setNumberOpen] = useState(false);
	const [numberValue, setNumberValue] = useState("");
	const [numberReason, setNumberReason] = useState("");
	const [numberBusy, setNumberBusy] = useState(false);
	const [numberError, setNumberError] = useState("");
	function openNumber(profile: Student) {
		setNumberValue(profile.studentProfile.studentNumber || profile.login);
		setNumberReason("");
		setNumberError("");
		setNumberOpen(true);
	}
	async function saveNumber(event: FormEvent) {
		event.preventDefault();
		if (!selected || numberBusy) return;
		if (!/^[A-Za-z0-9._-]{3,64}$/.test(numberValue.trim())) {
			setNumberError("学号需为3至64位字母、数字、点、下划线或连字符");
			return;
		}
		if (numberReason.trim().length < 2) {
			setNumberError("请填写更正理由");
			return;
		}
		setNumberBusy(true);
		setNumberError("");
		try {
			const updated = await requestJson<Student>(
				`/api/students/${selected.id}/number`,
				{
					revision: selected.revision,
					studentNumber: numberValue.trim(),
					reason: numberReason.trim(),
				},
				"PATCH",
			);
			setSelected(updated);
			setNumberOpen(false);
			setSuccess("学号已更正，该学生的登录账号同步更新，需使用新学号重新登录。");
			remote.reload();
			details.reload();
		} catch (err) {
			setNumberError((err as Error).message);
		} finally {
			setNumberBusy(false);
		}
	}
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
			header: "责任辅导员",
			cell: ({ row }) => (
				<div>
					<p>
						{row.original.studentProfile.schoolClass?.counselor?.name ||
							"未设置"}
					</p>
					{!row.original.studentProfile.classId && (
						<Badge variant="secondary">未分班</Badge>
					)}
				</div>
			),
		},
		{ accessorKey: "revision", header: "变更次数" },
		{
			accessorKey: "createdAt",
			header: "建档时间",
			cell: ({ row }) => dateText(row.original.createdAt),
		},
		{
			id: "actions",
			header: "操作",
			cell: ({ row }) => (
				<div className="flex flex-wrap gap-1">
					<Button variant="ghost" size="sm" onClick={() => open(row.original)}>
						档案详情
					</Button>
					{role === "ADMIN" && (
						<Button
							variant="ghost"
							size="sm"
							className="text-destructive hover:text-destructive"
							onClick={() => setDeleting(row.original)}
						>
							删除
						</Button>
					)}
				</div>
			),
		},
	];
	return (
		<>
			<RemoteState {...remote} />
			{!selected && success && <Feedback success={success} />}
			{remote.data && (
				<TemplateDirectory
					description={
						role === "COUNSELOR"
							? `共 ${remote.data.total} 位负责班级学生。姓名和班级由管理员或学院更正。`
							: role === "COLLEGE"
								? `共 ${remote.data.total} 位本院学生。可更正学生姓名和班级，修改会保留原因。`
								: `共 ${remote.data.total} 位全校学生。可更正学生姓名和班级，修改会保留原因。`
					}
					data={remote.data.items}
					columns={columns}
					actions={
						role === "ADMIN" && (
							<Link
								href="/imports?kind=accounts"
								className={buttonVariants({ variant: "outline", size: "sm" })}
							>
								导入学生账号
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
									placeholder="输入姓名或学号"
								/>
							</Field>
							{(
								[
									["college", "学院", "colleges"],
									["major", "专业", "majors"],
									["className", "班级", "classes"],
								] as const
							)
								.filter(([key]) => role === "ADMIN" || key !== "college")
								.map(([key, label, options]) => (
								<Field className="w-full sm:w-44" key={key}>
									<FieldLabel htmlFor={`profile-scope-${key}`}>
										{label}
									</FieldLabel>
									<SearchableSelect
										id={`profile-scope-${key}`}
										value={draftScope[key]}
										onValueChange={(value) => {
											const next = {
												...draftScope,
												[key]: value,
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
										placeholder={`全部${label}`}
										searchPlaceholder={`搜索${label}`}
										options={remote.data!.scopeOptions[options].map((value) => ({
											value,
											label: value,
										}))}
									/>
								</Field>
							))}
							<Button type="submit" variant="outline">搜索</Button>
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
								重置筛选
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
								第 {row.revision} 版 · {dateText(row.createdAt)}
							</p>
							<p className="text-sm">
								责任辅导员：
								{row.studentProfile.schoolClass?.counselor?.name || "未设置"}
								{!row.studentProfile.classId ? " · 未分班" : ""}
							</p>
							<div className="flex flex-wrap gap-2">
								<Button
									variant="outline"
									className="self-start"
									onClick={() => open(row)}
								>
									档案详情
								</Button>
								{role === "ADMIN" && (
									<Button
										variant="ghost"
										className="self-start text-destructive hover:text-destructive"
										onClick={() => setDeleting(row)}
									>
										删除
									</Button>
								)}
							</div>
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
						<SheetTitle>{selected?.name}的学生档案</SheetTitle>
						<SheetDescription>
							{role === "ADMIN"
								? "可更正姓名、班级和学号，或删除没有业务记录的学生账号；每次更正都会记录原因。"
								: "可更正姓名和班级；每次更正都会记录原因。"}
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
											"未设置",
									],
									[
										"班级状态",
										selected.studentProfile.classId ? "已分班" : "未分班",
									],
									["变更次数", String(selected.revision)],
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
									<h2 className="font-medium text-base">班级变更记录</h2>
									<p className="text-xs text-muted-foreground">
										显示最近 20 条记录；已发布的成绩使用发布时的班级。
									</p>
									{!details.data.affiliationHistory?.length && (
										<p className="text-sm text-muted-foreground">
											暂无班级变更记录。
										</p>
									)}
									{details.data.affiliationHistory?.map((item) => (
										<dl
											key={item.id}
											className="grid gap-4 border-b pb-4 sm:grid-cols-2"
										>
											{[
												[
													"学院 / 专业 / 班级",
													[
														item.identity.college,
														item.identity.major,
														item.identity.className,
													]
														.filter(Boolean)
														.join(" / ") || "未分班",
												],
												["生效时间", dateText(item.startedAt)],
												[
													"结束时间",
													item.endedAt ? dateText(item.endedAt) : "当前有效",
												],
												["变更原因", item.reason],
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
								<div className="flex flex-wrap gap-2">
									{canEdit && (
										<Button
											variant="outline"
											onClick={() => {
												setEditing(true);
												setError("");
												setSuccess("");
											}}
										>
											更正姓名与班级
										</Button>
									)}
									{role === "ADMIN" && (
										<Button variant="outline" onClick={() => openNumber(selected)}>
											更正学号
										</Button>
									)}
									{role === "ADMIN" && (
										<Button
											variant="ghost"
											className="text-destructive hover:text-destructive"
											onClick={() => {
												setSelected(null);
												setDeleting(selected);
											}}
										>
											删除学生账号
										</Button>
									)}
								</div>
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
												更正原因
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
										<Button type="submit" disabled={busy || !organizations.data}>
											保存更正
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
			<Dialog
				open={numberOpen}
				onOpenChange={(open) => {
					if (!open && !numberBusy) setNumberOpen(false);
				}}
			>
				<DialogContent className="sm:max-w-lg">
					<DialogHeader>
						<DialogTitle>更正学号</DialogTitle>
						<DialogDescription>
							学号同时是登录账号。更正后该学生当前的登录会话会失效，需要使用新学号重新登录；历史业务记录保留。
						</DialogDescription>
					</DialogHeader>
					{selected && (
						<form className="flex flex-col gap-4" onSubmit={saveNumber}>
							<div className="rounded-lg border bg-muted/30 p-3 text-sm">
								<p className="font-medium">{selected.name}</p>
								<p className="mt-1 text-xs text-muted-foreground">
									当前学号 {selected.studentProfile.studentNumber || selected.login}
									· {selected.studentProfile.college} /{" "}
									{selected.studentProfile.major} /{" "}
									{selected.studentProfile.className}
								</p>
							</div>
							<Field>
								<FieldLabel htmlFor="student-number">新学号</FieldLabel>
								<Input
									id="student-number"
									value={numberValue}
									onChange={(event) => setNumberValue(event.target.value)}
									required
									minLength={3}
									maxLength={64}
									autoComplete="off"
								/>
								<FieldDescription>
									仅允许字母、数字、点、下划线和连字符；不能与其他账号登录名或学号重复。
								</FieldDescription>
							</Field>
							<Field>
								<FieldLabel htmlFor="student-number-reason">更正理由</FieldLabel>
								<Textarea
									id="student-number-reason"
									value={numberReason}
									onChange={(event) => setNumberReason(event.target.value)}
									required
									minLength={2}
									maxLength={500}
									rows={3}
									placeholder="说明学号错误来源和核对依据"
								/>
							</Field>
							<Feedback error={numberError} />
							<DialogFooter>
								<Button
									type="button"
									variant="outline"
									disabled={numberBusy}
									onClick={() => setNumberOpen(false)}
								>
									取消
								</Button>
								<Button
									type="submit"
									disabled={
										numberBusy ||
										numberReason.trim().length < 2 ||
										numberValue.trim().length < 3
									}
								>
									{numberBusy ? "正在保存…" : "保存更正"}
								</Button>
							</DialogFooter>
						</form>
					)}
				</DialogContent>
			</Dialog>
			<DeleteUsageDialog
				open={!!deleting}
				onOpenChange={(open) => {
					if (!open) setDeleting(null);
				}}
				title={deleting ? `删除学生「${deleting.name}」？` : "删除学生？"}
				description="删除会移除学生账号、学籍档案、班级关系和登录会话。已有成绩、申报、参与、审核等业务记录时不能删除，只能停用账号。"
				usageUrl={
					deleting
						? `/api/admin/accounts/${encodeURIComponent(deleting.id)}`
						: null
				}
				deleteUrl={
					deleting ? `/api/students/${encodeURIComponent(deleting.id)}` : null
				}
				confirmLabel="学号"
				buildBody={(usage, reason, confirm) => ({
					revision: usage.revision,
					reason,
					confirmLogin: confirm,
				})}
				onDeleted={() => {
					const name = deleting?.name;
					setDeleting(null);
					setSelected(null);
					setSuccess(`学生“${name}”已删除。`);
					remote.reload();
				}}
			/>
		</>
	);
}
