"use client";
// Full users.tsx/users-table.tsx directory adapted to hierarchical organization records.
// Editing retains invoice-form field groups and profile-personal-details sections.
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import type { DataTableFeatures } from "@/lib/data-table-features";
import type {
	OrganizationData,
	OrganizationNode,
} from "@/lib/organization-types";
import { TemplateDirectory } from "@/components/dashboard/template-directory";
import { useRemote } from "@/components/dashboard/use-remote";
import { RemoteState } from "@/components/dashboard/remote-state";
import { Feedback, requestJson } from "@/components/dashboard/feedback";
import { useUnsavedChanges } from "@/components/dashboard/use-unsaved-changes";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
					: "待分配",
				childCount: 0,
			})),
		]),
	]);
}
export function Organizations() {
	const params = useSearchParams();
	const remote = useRemote<OrganizationData>("/api/organizations");
	const [query, setQuery] = useState((params.get("q") || "").slice(0, 80));
	const [kind, setKind] = useState(
		["college", "major", "class"].includes(params.get("kind") || "")
			? params.get("kind")!
			: "",
	);
	const [collegeId, setCollegeId] = useState(params.get("collegeId") || "");
	const [status, setStatus] = useState(
		["true", "false"].includes(params.get("enabled") || "")
			? params.get("enabled")!
			: "",
	);
	const [page, setPage] = useState(
		Math.max(1, Math.min(100000, Math.floor(Number(params.get("page")) || 1))),
	);
	function location(
		next: { q: string; kind: string; collegeId: string; enabled: string },
		nextPage: number,
	) {
		return `/organizations?${new URLSearchParams({ ...next, page: String(nextPage) })}`;
	}
	function filter(
		change: Partial<{
			q: string;
			kind: string;
			collegeId: string;
			enabled: string;
		}>,
	) {
		const next = { q: query, kind, collegeId, enabled: status, ...change };
		setQuery(next.q);
		setKind(next.kind);
		setCollegeId(next.collegeId);
		setStatus(next.enabled);
		setPage(1);
		window.history.replaceState(null, "", location(next, 1));
	}
	const [edit, setEdit] = useState<Row | "new" | null>(null);
	const [editKind, setEditKind] = useState<Kind>("class");
	const [parentId, setParentId] = useState("");
	const [busy, setBusy] = useState(false);
	const [dirty, setDirty] = useState(false);
	const [error, setError] = useState("");
	const [success, setSuccess] = useState("");
	useUnsavedChanges(dirty || busy);
	const rows = remote.data ? flatten(remote.data) : [];
	const filtered = rows.filter(
		(r) =>
			(!kind || r.kind === kind) &&
			(!collegeId || r.collegeId === collegeId) &&
			(!status || String(r.enabled) === status) &&
			(!query ||
				`${r.path} ${r.code} ${r.counselorName || ""}`
					.toLowerCase()
					.includes(query.toLowerCase())),
	);
	const currentPage = Math.min(
		page,
		Math.max(1, Math.ceil(filtered.length / 20)),
	);
	const current = edit && edit !== "new" ? edit : null;
	const parents = rows.filter(
		(r) =>
			(r.enabled || r.id === current?.parentId) &&
			r.kind === (editKind === "class" ? "major" : "college"),
	);
	const targetCollegeId =
		current?.collegeId || rows.find((r) => r.id === parentId)?.collegeId;
	function start(row: Row | "new") {
		setEdit(row);
		setEditKind(row === "new" ? "class" : row.kind);
		setParentId(row === "new" ? "" : row.parentId || "");
		setDirty(false);
		setError("");
	}
	const columns: ColumnDef<DataTableFeatures, Row>[] = [
		{
			accessorKey: "name",
			header: "组织名称 / 编码",
			cell: ({ row }) => (
				<div>
					<p className="font-medium">
						{row.original.kind !== "college" ? "↳ " : ""}
						{row.original.name}
					</p>
					<p className="text-xs text-muted-foreground">{row.original.code}</p>
				</div>
			),
		},
		{
			accessorKey: "kind",
			header: "层级",
			cell: ({ row }) => (
				<Badge variant="outline">{labels[row.original.kind]}</Badge>
			),
		},
		{ accessorKey: "path", header: "完整归属" },
		{
			id: "responsibility",
			header: "责任辅导员 / 下级",
			cell: ({ row }) =>
				row.original.kind === "class"
					? row.original.counselorName
					: `${row.original.childCount} 个${row.original.kind === "college" ? "专业" : "班级"}`,
		},
		{ accessorKey: "studentCount", header: "在册学生" },
		{
			id: "status",
			header: "状态 / 修订",
			cell: ({ row }) => (
				<div className="flex flex-col gap-1">
					<Badge variant={row.original.enabled ? "outline" : "secondary"}>
						{row.original.enabled
							? row.original.kind === "class" && !row.original.counselorId
								? "待完善"
								: "启用"
							: "停用"}
					</Badge>
					<span className="text-xs text-muted-foreground">
						修订 {row.original.revision}
					</span>
				</div>
			),
		},
		{
			id: "actions",
			header: "操作",
			cell: ({ row }) => (
				<Button variant="ghost" size="sm" onClick={() => start(row.original)}>
					详情 / 维护
				</Button>
			),
		},
	];
	return (
		<>
			<RemoteState {...remote} />
			<Feedback success={success} />
			{remote.data && (
				<TemplateDirectory
					title="学院、专业与班级"
					description={`当前范围共 ${rows.filter((r) => r.kind === "college").length} 个学院、${rows.filter((r) => r.kind === "major").length} 个专业、${rows.filter((r) => r.kind === "class").length} 个班级。未分配辅导员的班级需先完成责任配置。`}
					data={filtered.slice((currentPage - 1) * 20, currentPage * 20)}
					columns={columns}
					actions={
						remote.data.canManage && (
							<Button size="sm" onClick={() => start("new")}>
								<Plus data-icon="inline-start" />
								新建组织
							</Button>
						)
					}
					filters={
						<div className="flex w-full flex-wrap items-end gap-3">
							<Field className="w-full sm:w-60">
								<FieldLabel htmlFor="organization-query">
									名称、编码或辅导员
								</FieldLabel>
								<Input
									id="organization-query"
									value={query}
									maxLength={80}
									onChange={(e) => {
										filter({ q: e.target.value });
									}}
								/>
							</Field>
							<Field className="w-full sm:w-40">
								<FieldLabel htmlFor="organization-kind">组织层级</FieldLabel>
								<NativeSelect
									id="organization-kind"
									value={kind}
									onChange={(e) => {
										filter({ kind: e.target.value });
									}}
								>
									<NativeSelectOption value="">全部层级</NativeSelectOption>
									{Object.entries(labels).map(([k, l]) => (
										<NativeSelectOption key={k} value={k}>
											{l}
										</NativeSelectOption>
									))}
								</NativeSelect>
							</Field>
							<Field className="w-full sm:w-44">
								<FieldLabel htmlFor="organization-college">所属学院</FieldLabel>
								<NativeSelect
									id="organization-college"
									value={collegeId}
									onChange={(e) => {
										filter({ collegeId: e.target.value });
									}}
								>
									<NativeSelectOption value="">全部学院</NativeSelectOption>
									{remote.data.colleges.map((c) => (
										<NativeSelectOption key={c.id} value={c.id}>
											{c.name}
										</NativeSelectOption>
									))}
								</NativeSelect>
							</Field>
							<Field className="w-full sm:w-36">
								<FieldLabel htmlFor="organization-status">启停状态</FieldLabel>
								<NativeSelect
									id="organization-status"
									value={status}
									onChange={(e) => {
										filter({ enabled: e.target.value });
									}}
								>
									<NativeSelectOption value="">全部状态</NativeSelectOption>
									<NativeSelectOption value="true">启用</NativeSelectOption>
									<NativeSelectOption value="false">停用</NativeSelectOption>
								</NativeSelect>
							</Field>
						</div>
					}
					pagination={{
						page: currentPage,
						total: filtered.length,
						href: (next) =>
							location({ q: query, kind, collegeId, enabled: status }, next),
						onPageChange: (next) => {
							setPage(next);
							window.history.replaceState(
								null,
								"",
								location({ q: query, kind, collegeId, enabled: status }, next),
							);
						},
					}}
					mobile={(r) => (
						<div className="flex flex-col gap-3">
							<div className="flex items-center justify-between gap-3">
								<p className="font-medium">
									{r.name} · {r.code}
								</p>
								<Badge variant="outline">{labels[r.kind]}</Badge>
							</div>
							<p className="text-sm">{r.path}</p>
							<p className="text-sm">
								{r.kind === "class"
									? `辅导员：${r.counselorName}`
									: `下级 ${r.childCount} 个`}{" "}
								· 学生 {r.studentCount} 人
							</p>
							<p className="text-xs text-muted-foreground">
								{r.enabled ? "启用" : "停用"} · 修订 {r.revision}
							</p>
							<Button
								variant="outline"
								className="self-start"
								onClick={() => start(r)}
							>
								详情 / 维护
							</Button>
						</div>
					)}
				/>
			)}
			<Sheet
				open={!!edit}
				onOpenChange={(open) => {
					if (
						!open &&
						!busy &&
						(!dirty || window.confirm("放弃尚未保存的组织修改？"))
					) {
						setEdit(null);
						setDirty(false);
					}
				}}
			>
				<SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
					<SheetHeader>
						<SheetTitle>
							{current ? `${current.name} · 组织维护` : "新建组织"}
						</SheetTitle>
						<SheetDescription>
							{current?.kind === "college" && remote.data?.role !== "ADMIN"
								? "学院基本信息由学校管理员维护；学院管理人员可维护本院专业和班级。"
								: "学院、专业和班级编码保持唯一，责任交接与停用均保留理由。上级组织创建后不可直接更改；有在册学生的班级需先转班，方可停用。"}
						</SheetDescription>
					</SheetHeader>
					{edit && remote.data && (
						<form
							key={current?.id || "new"}
							className="flex flex-col gap-5 px-5 pb-6"
							onChange={() => setDirty(true)}
							onSubmit={async (e) => {
								e.preventDefault();
								if (busy) return;
								const f = new FormData(e.currentTarget);
								setBusy(true);
								setError("");
								try {
									await requestJson<OrganizationData>("/api/organizations", {
										kind: editKind,
										code: f.get("code"),
										name: f.get("name"),
										enabled: f.get("enabled") === "true",
										...(editKind !== "college" ? { parentId } : {}),
										...(editKind === "class"
											? { counselorId: f.get("counselorId") || null }
											: {}),
										...(current
											? {
													id: current.id,
													revision: current.revision,
													reason: f.get("reason"),
												}
											: {}),
									});
									setDirty(false);
									setEdit(null);
									setSuccess("组织目录已保存。");
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
										["完整归属", current.path],
										["在册学生", String(current.studentCount)],
										["当前责任辅导员", current.counselorName || "不适用"],
										["组织修订", String(current.revision)],
									].map(([l, v]) => (
										<div key={l} className="flex flex-col gap-1">
											<dt className="text-xs text-muted-foreground">{l}</dt>
											<dd className="break-words text-sm">{v}</dd>
										</div>
									))}
								</dl>
							)}
							{remote.data.canManage &&
								(remote.data.role === "ADMIN" || editKind !== "college") && (
									<>
										<FieldGroup>
											<Field>
												<FieldLabel htmlFor="org-edit-kind">
													组织层级
												</FieldLabel>
												<NativeSelect
													id="org-edit-kind"
													value={editKind}
													disabled={!!current}
													onChange={(e) => {
														setEditKind(e.target.value as Kind);
														setParentId("");
													}}
												>
													{Object.entries(labels)
														.filter(
															([k]) =>
																k !== "college" ||
																remote.data!.role === "ADMIN",
														)
														.map(([k, l]) => (
															<NativeSelectOption key={k} value={k}>
																{l}
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
														onChange={(e) => setParentId(e.target.value)}
													>
														<NativeSelectOption value="">
															请选择上级组织
														</NativeSelectOption>
														{parents.map((p) => (
															<NativeSelectOption key={p.id} value={p.id}>
																{p.path}
															</NativeSelectOption>
														))}
													</NativeSelect>
													<FieldDescription>
														创建后不直接更改上级组织。
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
													使用字母、数字、点、下划线或连字符。
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
														{remote.data.counselors
															.filter(
																(c) =>
																	c.collegeId === targetCollegeId &&
																	!c.disabled,
															)
															.map((c) => (
																<NativeSelectOption key={c.id} value={c.id}>
																	{c.name}（{c.login}）
																</NativeSelectOption>
															))}
													</NativeSelect>
													<FieldDescription>
														只能分配本院启用的辅导员；有学生的班级应先完成责任交接。
													</FieldDescription>
												</Field>
											)}
											<Field>
												<FieldLabel htmlFor="org-edit-enabled">
													组织状态
												</FieldLabel>
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
													有启用下级、在册学生或责任账号时不能停用。
												</FieldDescription>
											</Field>
											{current && (
												<Field>
													<FieldLabel htmlFor="org-edit-reason">
														修改 / 交接理由
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
										<Button disabled={busy}>
											{busy ? "正在保存…" : "保存组织"}
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
