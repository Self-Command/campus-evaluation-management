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
import { dateText, statusLabels, type AppRole } from "@/lib/business-labels";
import type { Scheme } from "@/lib/scoring/types";
export function ActivityList({
	data,
	term,
	role,
	query,
}: {
	data: { items: Activity[]; total: number; page: number };
	term: { id: string; phase: string; disposition?: string; scheme: Scheme };
	role: AppRole;
	query: string;
}) {
	const router = useRouter();
	const path = usePathname();
	const params = useSearchParams();
	const tab =
		params.get("tab") || (path.startsWith("/terms/") ? "overview" : "");
	const listQuery = new URLSearchParams({
		termId: term.id,
		q: query,
		page: String(data.page),
	});
	if (tab) listQuery.set("tab", tab);
	const returnHref = `${path}?${listQuery}`;
	const detailHref = (id: string) =>
		`/activities/${id}?returnTo=${encodeURIComponent(returnHref)}`;
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
			accessorKey: "startsAt",
			header: "活动时间",
			cell: ({ row }) => dateText(row.original.startsAt),
		},
		{
			accessorKey: "points",
			header: "计分方式 / 分值",
			cell: ({ row }) =>
				row.original.scoreMode === "INDIVIDUAL"
					? `逐人分，上限 ${row.original.points}`
					: `固定 ${row.original.points} 分`,
		},
		{
			accessorKey: "confirmed",
			header: "分值状态",
			cell: ({ row }) => (
				<Badge variant={row.original.confirmed ? "outline" : "secondary"}>
					{row.original.confirmed ? "已确认" : "待确认"}
				</Badge>
			),
		},
		...(role === "STUDENT"
			? [
					{
						id: "registeredAt",
						header: "本人参与登记",
						cell: ({ row }: { row: { original: Activity } }) => (
							<div>
								<Badge variant="outline">后台已登记</Badge>
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
						header: "本人分数 / 审核",
						cell: ({ row }: { row: { original: Activity } }) => (
							<div>
								<p>
									{row.original.scoreMode === "INDIVIDUAL"
										? (row.original.ownParticipation?.score ?? "尚未录分")
										: `${row.original.points} 分`}
								</p>
								<p className="text-xs text-muted-foreground">
									{row.original.ownParticipation?.sources
										.map(
											(source) => statusLabels[source.status] || source.status,
										)
										.join("、") || "暂无认定来源"}
								</p>
							</div>
						),
					},
				]
			: [
					{
						id: "published",
						header: "发布状态",
						cell: ({ row }: { row: { original: Activity } }) => (
							<Badge variant="outline">
								{row.original.publishedAt ? "已发布" : "草稿 / 已撤回"}
							</Badge>
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
					查看详情
				</Link>
			),
		},
	];
	return (
		<>
			<TemplateDirectory
				title={role === "STUDENT" ? "我参加的活动" : "活动目录"}
				description={
					role === "STUDENT"
						? `共 ${data.total} 个后台已登记活动。审核通过后才计分；历史参与保留登记时身份。`
						: `共 ${data.total} 个匹配活动。草稿、分值确认与发布分别处理。`
				}
				data={data.items}
				columns={columns}
				search={{
					action: path,
					query,
					placeholder: "搜索活动名称",
					hidden: { termId: term.id, ...(tab ? { tab } : {}) },
				}}
				actions={
					role !== "STUDENT" &&
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
								{row.confirmed ? "已确认" : "待确认"}
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
								{row.scoreMode === "INDIVIDUAL"
									? (row.ownParticipation?.score ?? "尚未录分")
									: `${row.points} 分`}{" "}
								·{" "}
								{row.ownParticipation?.sources
									.map((source) => statusLabels[source.status] || source.status)
									.join("、") || "暂无认定来源"}
							</p>
						) : (
							<p className="text-sm">
								{row.publishedAt ? "已发布" : "草稿 / 已撤回"} ·{" "}
								{row.scoreMode === "INDIVIDUAL" ? "逐人录分" : "固定分值"}
							</p>
						)}
						<div className="flex items-center justify-between">
							<span className="text-sm">{row.points} 分</span>
							<Link
								href={detailHref(row.id)}
								className={buttonVariants({ variant: "outline", size: "sm" })}
							>
								查看详情
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
							保存草稿后确认分值，核对发布范围并独立发布。参与登记与审核计分分别处理。
						</DialogDescription>
					</DialogHeader>
					<ActivityForm
						term={term}
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
