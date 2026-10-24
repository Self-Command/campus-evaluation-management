"use client";
import { hasUnsavedChanges } from "@/components/dashboard/use-unsaved-changes";
import { TemplateDirectory } from "@/components/dashboard/template-directory";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import { type ColumnDef } from "@tanstack/react-table";
import type { DataTableFeatures } from "@/lib/data-table-features";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogDescription,
} from "@/components/ui/dialog";
import { ActivityForm, type Activity } from "./activity-form";
import type { UploadLimits } from "@/components/dashboard/rich-text-editor";
import { dateText, statusLabels, type AppRole } from "@/lib/business-labels";
import type { Scheme } from "@/lib/scoring/types";
export function ActivityList({
	data,
	term,
	role,
	query,
	colleges = [],
	limits,
}: {
	data: { items: Activity[]; total: number; page: number };
	term: { id: string; phase: string; disposition?: string; scheme: Scheme };
	role: AppRole;
	query: string;
	colleges?: { id: string; name: string; code?: string }[];
	limits: UploadLimits;
}) {
	const router = useRouter();
	const path = usePathname();
	const params = useSearchParams();
	const tab =
		params.get("tab") || (path.startsWith("/terms/") ? "overview" : "");
	const view = params.get("view");
	const listQuery = new URLSearchParams({
		termId: term.id,
		q: query,
		page: String(data.page),
	});
	if (tab) listQuery.set("tab", tab);
	if (view) listQuery.set("view", view);
	const returnHref = `${path}?${listQuery}`;
	const detailHref = (id: string) =>
		`/activities/${id}?returnTo=${encodeURIComponent(returnHref)}`;
	const publishLabel = (activity: Activity) =>
		activity.publishedAt
			? "已发布"
			: (activity.publishRevision ?? 0) > 0
				? "已撤回"
				: "未发布";
	const [open, setOpen] = useState(false);
	const columns: ColumnDef<DataTableFeatures, Activity>[] = [
		{
			accessorKey: "name",
			header: "活动",
			cell: ({ row }) => (
				<div>
					<Link
						href={detailHref(row.original.id)}
						className="font-medium hover:underline"
					>
						{row.original.name}
					</Link>
					<p className="mt-1 text-xs text-muted-foreground">
						{row.original.organizer}
					</p>
				</div>
			),
		},
		{
			accessorKey: "college",
			header: "主办学院",
			cell: ({ row }) => row.original.college?.name || "未设置",
		},
		{
			accessorKey: "startsAt",
			header: "活动时间",
			cell: ({ row }) => dateText(row.original.startsAt),
		},
		{
			accessorKey: "points",
			header: "分值",
			cell: ({ row }) => `${row.original.points} 分`,
		},
		...(role === "STUDENT"
			? [
					{
						id: "registeredAt",
						header: "参与登记",
						cell: ({ row }: { row: { original: Activity } }) => (
							<div>
								<Badge variant="outline">已登记</Badge>
								<p className="mt-1 text-xs text-muted-foreground">
									{row.original.ownParticipation?.registeredAt
										? dateText(row.original.ownParticipation.registeredAt)
										: "—"}
								</p>
							</div>
						),
					},
					{
						id: "ownScore",
						header: "审核进度",
						cell: ({ row }: { row: { original: Activity } }) => (
							<div className="flex flex-col gap-1">
								<Badge variant="outline">
									{[
										...new Set(
											row.original.ownParticipation?.sources.map(
												(source) =>
													statusLabels[source.status] || source.status,
											) ?? [],
										),
									].join("、") || "暂无审核记录"}
								</Badge>
								{[
									...new Set(
										row.original.ownParticipation?.sources
											.map((source) =>
												source.status === "RETURNED" && source.reviewReason
													? source.reviewReason
													: null,
											)
											.filter((reason): reason is string => !!reason) ?? [],
									),
								].map((reason) => (
									<p
										key={reason}
										className="max-w-56 text-xs text-muted-foreground"
									>
										退回原因：{reason}
									</p>
								))}
							</div>
						),
					},
				]
			: [
					{
						id: "published",
						header: "发布状态",
						cell: ({ row }: { row: { original: Activity } }) => (
							<Badge variant="outline">{publishLabel(row.original)}</Badge>
						),
					},
				]),
		{
			id: "actions",
			header: "操作",
			cell: ({ row }) => (
				<Link
					href={detailHref(row.original.id)}
					className={buttonVariants({ variant: "ghost", size: "sm" })}
				>
					查看活动
				</Link>
			),
		},
	];
	return (
		<>
			<TemplateDirectory
				description={`共 ${data.total} 个活动`}
				data={data.items}
				columns={columns}
				empty={
					role === "STUDENT"
						? {
								title: "暂无已登记的活动",
								description:
									"学院登记你的参与后，会在这里显示活动分值和审核进度。",
							}
						: role === "COUNSELOR"
							? {
									title: "当前没有可查看的活动",
									description:
										"学院发布活动后会显示在这里；可切换测评周期查看历史。",
								}
							: {
									title: "当前没有活动",
									description:
										term.phase === "ACTIVE"
											? "可切换测评周期查看历史；在活动周期内可创建并发布活动。"
											: "可切换测评周期查看历史；本周期当前阶段不能新建活动。",
								}
				}
				search={{
					action: path,
					query,
					placeholder: "搜索活动名称",
					hidden: {
						termId: term.id,
						...(tab ? { tab } : {}),
						...(view ? { view } : {}),
					},
				}}
				actions={
					(role === "ADMIN" || role === "COLLEGE") &&
					term.phase === "ACTIVE" &&
					(!term.disposition || term.disposition === "NORMAL") ? (
						<Button size="sm" onClick={() => setOpen(true)}>
							创建活动
						</Button>
					) : undefined
				}
				pagination={{
					page: data.page,
					total: data.total,
					href: (page) => {
						const next = new URLSearchParams(listQuery);
						next.set("page", String(page));
						return `${path}?${next}`;
					},
				}}
				mobile={(row) => (
					<div className="flex flex-col gap-3">
						<div className="flex justify-between gap-3">
							<Link href={detailHref(row.id)} className="font-medium">
								{row.name}
							</Link>
							<Badge variant="outline">
								{role === "STUDENT" ? "已登记" : publishLabel(row)}
							</Badge>
						</div>
						<p className="text-xs text-muted-foreground">
							{row.organizer} · {dateText(row.startsAt)}
						</p>
						{role === "STUDENT" ? (
							<p className="text-sm">
								登记{" "}
								{row.ownParticipation?.registeredAt
									? dateText(row.ownParticipation.registeredAt)
									: "—"}{" "}
								·{" "}
								{row.ownParticipation?.sources
									.map((source) => statusLabels[source.status] || source.status)
									.join("、") || "暂无审核记录"}
							</p>
						) : null}
						<div className="flex items-center justify-between">
							<span className="text-sm">{row.points} 分</span>
							<Link
								href={detailHref(row.id)}
								className={buttonVariants({ variant: "outline", size: "sm" })}
							>
								查看活动
							</Link>
						</div>
					</div>
				)}
			/>
			<Dialog
				open={open}
				onOpenChange={(value) => {
					if (
						!value &&
						hasUnsavedChanges() &&
						!window.confirm("放弃尚未保存的活动？")
					)
						return;
					setOpen(value);
				}}
			>
				<DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-4xl">
					<DialogHeader>
						<DialogTitle>创建活动</DialogTitle>
						<DialogDescription>
							保存后核对范围并发布，学生即可看到。参与登记和审核计分分开处理。
						</DialogDescription>
					</DialogHeader>
					<ActivityForm
						term={term}
						role={role}
						colleges={colleges}
						limits={limits}
						onSaved={(id) => {
							setOpen(false);
							router.push(detailHref(id));
						}}
					/>
				</DialogContent>
			</Dialog>
		</>
	);
}
