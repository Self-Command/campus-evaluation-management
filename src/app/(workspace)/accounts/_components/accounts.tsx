"use client";
import { useUnsavedChanges } from "@/components/dashboard/use-unsaved-changes";
import { OrganizationFields } from "@/components/dashboard/organization-fields";
import { useRemote } from "@/components/dashboard/use-remote";
import { RemoteState } from "@/components/dashboard/remote-state";
import type {
	OrganizationData,
	StudentOrganization,
} from "@/lib/organization-types";
import { TemplateDirectory } from "@/components/dashboard/template-directory";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import { type ColumnDef } from "@tanstack/react-table";
import type { DataTableFeatures } from "@/lib/data-table-features";
import { Button, buttonVariants } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
	NativeSelect,
	NativeSelectOption,
} from "@/components/ui/native-select";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogDescription,
} from "@/components/ui/dialog";
import { Feedback, requestJson } from "@/components/dashboard/feedback";
import { roleLabels, type AppRole } from "@/lib/business-labels";
export type Account = {
	id: string;
	name: string;
	login: string;
	role: AppRole;
	revision: number;
	disabled: boolean;
	mustChangePassword: boolean;
	collegeId: string | null;
	college: { id: string; name: string; code: string; enabled: boolean } | null;
	studentProfile: StudentOrganization | null;
};
export function Accounts({
	data,
	query,
	selfId,
	filters,
}: {
	data: { items: Account[]; total: number; page: number };
	query: string;
	selfId: string;
	filters: { role: string; disabled: string };
}) {
	const [dirty, setDirty] = useState(false);
	useUnsavedChanges(dirty);
	const router = useRouter();
	const [edit, setEdit] = useState<Account | "new" | null>(null);
	const [role, setRole] = useState<AppRole>("STUDENT");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [secret, setSecret] = useState("");
	const [reset, setReset] = useState<Account | null>(null);
	const organizations = useRemote<OrganizationData>(
		edit ? "/api/organizations" : null,
	);
	function start(row: Account | "new") {
		setDirty(false);
		setEdit(row);
		setRole(row === "new" ? "STUDENT" : row.role);
		setError("");
	}
	const columns: ColumnDef<DataTableFeatures, Account>[] = [
		{
			accessorKey: "name",
			header: "姓名 / 账号",
			cell: ({ row }) => (
				<div className="flex items-center gap-3">
					<Avatar>
						<AvatarFallback>{row.original.name.slice(0, 1)}</AvatarFallback>
					</Avatar>
					<div>
						<p className="font-medium">{row.original.name}</p>
						<p className="text-xs text-muted-foreground">
							{row.original.login}
						</p>
					</div>
				</div>
			),
		},
		{
			accessorKey: "role",
			header: "角色",
			cell: ({ row }) => (
				<Badge variant="outline">{roleLabels[row.original.role]}</Badge>
			),
		},
		{
			id: "organization",
			header: "组织归属",
			cell: ({ row }) =>
				row.original.role === "STUDENT" && row.original.studentProfile ? (
					<div>
						<p>
							{row.original.studentProfile.college} /{" "}
							{row.original.studentProfile.className}
						</p>
						<p className="text-xs text-muted-foreground">
							{row.original.studentProfile.classId
								? row.original.studentProfile.schoolClass?.counselor?.name ||
									"责任待完善"
								: "归属待完善"}
						</p>
					</div>
				) : (
					row.original.college?.name ||
					(row.original.role === "ADMIN" ? "全校" : "归属待完善")
				),
		},
		{
			accessorKey: "disabled",
			header: "账号状态",
			cell: ({ row }) => (
				<Badge variant={row.original.disabled ? "secondary" : "outline"}>
					{row.original.disabled
						? "已停用"
						: row.original.mustChangePassword
							? "待设置密码"
							: "正常"}
				</Badge>
			),
		},
		{
			id: "actions",
			header: "操作",
			cell: ({ row }) => (
				<div className="flex gap-1">
					<Button variant="ghost" size="sm" onClick={() => start(row.original)}>
						编辑
					</Button>
					{row.original.id !== selfId && (
						<Button
							variant="ghost"
							size="sm"
							onClick={() => {
								setReset(row.original);
								setError("");
							}}
						>
							重置密码
						</Button>
					)}
				</div>
			),
		},
	];
	const current = edit && edit !== "new" ? edit : null;
	const currentStudent =
		current?.role === "STUDENT" ? current.studentProfile : null;
	return (
		<>
			<TemplateDirectory
				title="账号管理"
				description={`共 ${data.total} 个匹配账号。管理角色、启停状态和密码交付。`}
				data={data.items}
				columns={columns}
				search={{
					action: "/accounts",
					query,
					placeholder: "搜索姓名或登录账号",
					hidden: filters,
				}}
				filters={
					<form
						action="/accounts"
						className="flex w-full flex-wrap items-end gap-3"
					>
						<input type="hidden" name="q" value={query} />
						<Field className="w-full sm:w-48">
							<FieldLabel htmlFor="accounts-filter-role">账号角色</FieldLabel>
							<NativeSelect
								id="accounts-filter-role"
								name="role"
								defaultValue={filters.role}
							>
								<NativeSelectOption value="">全部角色</NativeSelectOption>
								{Object.entries(roleLabels).map(([value, label]) => (
									<NativeSelectOption key={value} value={value}>
										{label}
									</NativeSelectOption>
								))}
							</NativeSelect>
						</Field>
						<Field className="w-full sm:w-48">
							<FieldLabel htmlFor="accounts-filter-disabled">
								账号状态
							</FieldLabel>
							<NativeSelect
								id="accounts-filter-disabled"
								name="disabled"
								defaultValue={filters.disabled}
							>
								<NativeSelectOption value="">全部状态</NativeSelectOption>
								<NativeSelectOption value="false">启用</NativeSelectOption>
								<NativeSelectOption value="true">停用</NativeSelectOption>
							</NativeSelect>
						</Field>
						<Button variant="outline">筛选账号</Button>
					</form>
				}
				actions={
					<>
						<Link
							href="/imports?kind=accounts"
							className={buttonVariants({ variant: "outline", size: "sm" })}
						>
							导入学生
						</Link>
						<Button size="sm" onClick={() => start("new")}>
							<Plus data-icon="inline-start" />
							新建账号
						</Button>
					</>
				}
				pagination={{
					page: data.page,
					total: data.total,
					href: (page) =>
						`/accounts?${new URLSearchParams({ q: query, ...filters, page: String(page) })}`,
				}}
				mobile={(row) => (
					<div className="flex flex-col gap-3">
						<div className="flex justify-between gap-3">
							<div>
								<p className="font-medium">{row.name}</p>
								<p className="text-sm text-muted-foreground">{row.login}</p>
							</div>
							<Badge variant="outline">{roleLabels[row.role]}</Badge>
						</div>
						<p className="text-sm">
							{row.role === "STUDENT" && row.studentProfile
								? `${row.studentProfile.college} / ${row.studentProfile.className}${!row.studentProfile.classId ? " · 归属待完善" : ""}`
								: row.college?.name ||
									(row.role === "ADMIN" ? "全校" : "归属待完善")}
						</p>
						<div className="flex flex-wrap items-center justify-between gap-2">
							<span className="text-sm">
								{row.disabled
									? "已停用"
									: row.mustChangePassword
										? "待设置密码"
										: "正常"}
							</span>
							<div className="flex gap-2">
								<Button variant="outline" size="sm" onClick={() => start(row)}>
									编辑账号
								</Button>
								{row.id !== selfId && (
									<Button
										variant="outline"
										size="sm"
										onClick={() => setReset(row)}
									>
										重置密码
									</Button>
								)}
							</div>
						</div>
					</div>
				)}
			/>
			<Dialog
				open={edit !== null}
				onOpenChange={(open) => {
					if (
						!open &&
						!busy &&
						(!dirty || window.confirm("放弃尚未保存的账号修改？"))
					) {
						setDirty(false);
						setEdit(null);
					}
				}}
			>
				<DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
					<DialogHeader>
						<DialogTitle>{current ? "编辑账号" : "新建账号"}</DialogTitle>
						<DialogDescription>
							{current
								? "变更需要填写理由，角色与停用变化会撤销原会话。"
								: "初始密码仅在创建成功后显示一次，请妥善交付。"}
						</DialogDescription>
					</DialogHeader>
					<form
						key={current?.id || "new"}
						className="flex flex-col gap-5"
						onChange={() => setDirty(true)}
						onSubmit={async (e) => {
							e.preventDefault();
							if (busy) return;
							setBusy(true);
							setError("");
							const f = new FormData(e.currentTarget);
							const account = {
								login: f.get("login"),
								name: f.get("name"),
								role,
								...(role === "COLLEGE" || role === "COUNSELOR"
									? { collegeId: f.get("collegeId") }
									: {}),
								...(role === "STUDENT" && !currentStudent
									? { classId: f.get("classId") }
									: {}),
							};
							try {
								const result = await requestJson<{ initialPassword?: string }>(
									current
										? `/api/admin/accounts/${current.id}`
										: "/api/admin/accounts",
									current
										? {
												revision: current.revision,
												reason: f.get("reason"),
												disabled: f.get("disabled") === "true",
												account,
											}
										: account,
									current ? "PATCH" : "POST",
								);
								setDirty(false);
								setEdit(null);
								if (result.initialPassword) setSecret(result.initialPassword);
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
							<div className="grid gap-5 sm:grid-cols-2">
								<Field>
									<FieldLabel htmlFor="account-name">姓名</FieldLabel>
									<Input
										id="account-name"
										name="name"
										defaultValue={current?.name}
										readOnly={!!currentStudent && role === "STUDENT"}
										required
										maxLength={80}
									/>
								</Field>
								<Field>
									<FieldLabel htmlFor="account-login">
										学号 / 登录账号
									</FieldLabel>
									<Input
										id="account-login"
										name="login"
										defaultValue={current?.login}
										required
										minLength={3}
										maxLength={64}
										readOnly={!!current?.studentProfile}
									/>
								</Field>
							</div>
							<Field>
								<FieldLabel htmlFor="account-role">角色</FieldLabel>
								<NativeSelect
									id="account-role"
									value={role}
									onChange={(e) => setRole(e.target.value as AppRole)}
								>
									{role === "PUBLISHER" && (
										<NativeSelectOption value="PUBLISHER" disabled>
											历史活动发布者（请选择新身份）
										</NativeSelectOption>
									)}
									{Object.entries(roleLabels)
										.filter(([value]) => value !== "PUBLISHER")
										.map(([value, text]) => (
											<NativeSelectOption key={value} value={value}>
												{text}
											</NativeSelectOption>
										))}
								</NativeSelect>
							</Field>
							{currentStudent && role === "STUDENT" && (
								<Link
									href={`/students?q=${encodeURIComponent(current?.login || "")}`}
									className="text-sm underline underline-offset-4"
								>
									学生姓名与学院、专业、班级更正请进入学生档案
								</Link>
							)}
							{(role === "COLLEGE" ||
								role === "COUNSELOR" ||
								(role === "STUDENT" && !currentStudent)) && (
								<>
									<RemoteState {...organizations} />
									{organizations.data && (
										<OrganizationFields
											key={`${role}-${current?.id || "new"}`}
											data={organizations.data}
											initialCollegeId={current?.collegeId}
											collegeOnly={role !== "STUDENT"}
											prefix="account-organization"
											onChange={() => setDirty(true)}
										/>
									)}
								</>
							)}
							{current && (
								<>
									<Field>
										<FieldLabel htmlFor="account-disabled">账号状态</FieldLabel>
										<NativeSelect
											id="account-disabled"
											name="disabled"
											defaultValue={String(current.disabled)}
										>
											<NativeSelectOption value="false">
												启用
											</NativeSelectOption>
											<NativeSelectOption value="true">停用</NativeSelectOption>
										</NativeSelect>
									</Field>
									<Field>
										<FieldLabel htmlFor="account-reason">修改理由</FieldLabel>
										<Input
											id="account-reason"
											name="reason"
											required
											minLength={2}
											maxLength={500}
										/>
									</Field>
								</>
							)}
						</FieldGroup>
						<Button
							type="submit"
							disabled={
								busy ||
								role === "PUBLISHER" ||
								((role === "COLLEGE" ||
									role === "COUNSELOR" ||
									(role === "STUDENT" && !currentStudent)) &&
									!organizations.data)
							}
						>
							{busy ? "正在保存…" : "保存账号"}
						</Button>
					</form>
				</DialogContent>
			</Dialog>
			<Dialog
				open={!!secret}
				onOpenChange={(open) => {
					if (!open) setSecret("");
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>请保存初始密码</DialogTitle>
						<DialogDescription>
							关闭后无法再次查看。请通过安全渠道交给账号本人。
						</DialogDescription>
					</DialogHeader>
					<Input
						aria-label="初始密码"
						value={secret}
						readOnly
						autoComplete="off"
					/>
					<Button onClick={() => setSecret("")}>已妥善保存</Button>
				</DialogContent>
			</Dialog>
			<Dialog
				open={!!reset}
				onOpenChange={(open) => {
					if (
						!open &&
						!busy &&
						(!dirty || window.confirm("放弃尚未保存的重置理由？"))
					) {
						setDirty(false);
						setReset(null);
					}
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>重置 {reset?.name} 的密码</DialogTitle>
						<DialogDescription>
							该账号现有会话将失效，下次登录需设置新密码。
						</DialogDescription>
					</DialogHeader>
					<form
						className="flex flex-col gap-5"
						onChange={() => setDirty(true)}
						onSubmit={async (e) => {
							e.preventDefault();
							if (busy || !reset) return;
							setBusy(true);
							setError("");
							try {
								const result = await requestJson<{ initialPassword: string }>(
									`/api/admin/accounts/${reset.id}/reset-password`,
									{
										revision: reset.revision,
										reason: new FormData(e.currentTarget).get("reason"),
									},
								);
								setDirty(false);
								setReset(null);
								setSecret(result.initialPassword);
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
								<FieldLabel htmlFor="reset-reason">重置理由</FieldLabel>
								<Input
									id="reset-reason"
									name="reason"
									required
									minLength={2}
									maxLength={500}
								/>
							</Field>
						</FieldGroup>
						<Button type="submit" disabled={busy}>
							确认重置
						</Button>
					</form>
				</DialogContent>
			</Dialog>
		</>
	);
}
