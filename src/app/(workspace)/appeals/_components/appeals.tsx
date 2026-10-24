"use client";
import { EvidenceViewer } from "@/components/dashboard/evidence-viewer";
// Complete users.tsx directory and profile details adapted for appeal records.
import { useState } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import type { DataTableFeatures } from "@/lib/data-table-features";
import { TemplateDirectory } from "@/components/dashboard/template-directory";
import { useRemote } from "@/components/dashboard/use-remote";
import { RemoteState } from "@/components/dashboard/remote-state";
import { Feedback, requestJson } from "@/components/dashboard/feedback";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
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
import { Separator } from "@/components/ui/separator";
import { statusLabels, dateText } from "@/lib/business-labels";
type Appeal = {
	id: string;
	revision: number;
	status: string;
	target: string;
	reason: string;
	resolution?: string | null;
	createdAt: string;
	student: { id: string; name: string; login: string };
	publication: { id: string; sequence: number };
	evidence: {
		id?: string;
		name?: string;
		evidence?: { id: string; name: string };
	}[];
	resolvedPublicationId?: string | null;
};
export function Appeals({
	termId,
	role,
	page,
	status,
}: {
	termId: string;
	role: "ADMIN" | "STUDENT";
	page: number;
	status: string;
}) {
	const remote = useRemote<{ items: Appeal[]; total: number; page: number }>(
		`/api/appeals?termId=${termId}&page=${page}&status=${encodeURIComponent(status)}`,
	);
	const publications = useRemote<{
		history: { id: string; sequence: number }[];
	}>(role === "ADMIN" ? `/api/terms/${termId}/publication` : null);
	const [selected, setSelected] = useState<Appeal | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [success, setSuccess] = useState("");
	const [dirty, setDirty] = useState(false);
	const columns: ColumnDef<DataTableFeatures, Appeal>[] = [
		{
			id: "student",
			header: "学生",
			cell: ({ row }) => (
				<div>
					<p className="font-medium">{row.original.student.name}</p>
					<p className="text-xs text-muted-foreground">
						{row.original.student.login}
					</p>
				</div>
			),
		},
		{ accessorKey: "target", header: "异议内容" },
		{
			accessorKey: "status",
			header: "处理状态",
			cell: ({ row }) => (
				<Badge variant="outline">
					{statusLabels[row.original.status] || row.original.status}
				</Badge>
			),
		},
		{
			id: "publication",
			header: "对应版本",
			cell: ({ row }) => row.original.publication.sequence,
		},
		{
			accessorKey: "createdAt",
			header: "提交时间",
			cell: ({ row }) => dateText(row.original.createdAt),
		},
		{
			id: "actions",
			header: "操作",
			cell: ({ row }) => (
				<Button
					size="sm"
					variant="ghost"
					onClick={() => {
						setSelected(row.original);
						setError("");
						setDirty(false);
					}}
				>
					查看
				</Button>
			),
		},
	];
	async function mutate(action: string, form?: FormData) {
		if (busy || !selected) return;
		setBusy(true);
		setError("");
		try {
			await requestJson(
				`/api/appeals/${selected.id}`,
				{
					termId,
					revision: selected.revision,
					action,
					resolution: form?.get("resolution"),
					resolvedPublicationId: form?.get("resolvedPublicationId"),
				},
				"PATCH",
			);
			setSelected(null);
			setDirty(false);
			setSuccess("异议处理状态已更新。");
			remote.reload();
		} catch (err) {
			setError((err as Error).message);
		} finally {
			setBusy(false);
		}
	}
	return (
		<>
			<RemoteState {...remote} />
			<Feedback success={success} />
			{remote.data && (
				<TemplateDirectory
					description={`共 ${remote.data.total} 条异议，保留提交时的发布版本和处理结果。`}
					data={remote.data.items}
					columns={columns}
					actions={
						<Link
							href={`/results?termId=${termId}`}
							className={buttonVariants({ variant: "outline", size: "sm" })}
						>
							查看成绩
						</Link>
					}
					filters={
						<form action="/appeals" className="flex flex-wrap items-end gap-3">
							<input type="hidden" name="termId" value={termId} />

							<Field className="w-full sm:w-48">
								<FieldLabel htmlFor="appeal-filter">处理状态</FieldLabel>
								<NativeSelect
									id="appeal-filter"
									name="status"
									defaultValue={status}
								>
									<NativeSelectOption value="">全部状态</NativeSelectOption>
									{[
										"OPEN",
										"PROCESSING",
										"RESOLVED",
										"REJECTED",
										"WITHDRAWN",
									].map((value) => (
										<NativeSelectOption key={value} value={value}>
											{statusLabels[value]}
										</NativeSelectOption>
									))}
								</NativeSelect>
							</Field>
							<Button type="submit" variant="outline">筛选</Button>
						</form>
					}
					pagination={{
						page: remote.data.page,
						total: remote.data.total,
						href: (p) => `/appeals?termId=${termId}&status=${status}&page=${p}`,
					}}
					mobile={(row) => (
						<div className="flex flex-col gap-3">
							<div className="flex justify-between gap-2">
								<p className="font-medium">{row.target}</p>
								<Badge variant="outline">{statusLabels[row.status]}</Badge>
							</div>
							<p className="text-xs text-muted-foreground">
								{row.student.name} · {row.student.login} · 第{" "}
								{row.publication.sequence} 版
							</p>
							<Button
								variant="outline"
								className="self-start"
								onClick={() => {
									setSelected(row);
									setError("");
									setDirty(false);
								}}
							>
								查看
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
						(!dirty || window.confirm("放弃尚未提交的处理内容？"))
					)
						setSelected(null);
				}}
			>
				<SheetContent className="w-full overflow-y-auto sm:max-w-xl">
					<SheetHeader>
						<SheetTitle>{selected?.target}</SheetTitle>
						<SheetDescription>
							{selected?.student.name} · {selected?.student.login}
						</SheetDescription>
					</SheetHeader>
					{selected && (
						<div className="flex flex-col gap-5 px-5 pb-6">
							<Feedback error={error} />
							<div className="flex flex-wrap gap-2">
								<Badge variant="outline">{statusLabels[selected.status]}</Badge>
								<Badge variant="outline">
									第 {selected.publication.sequence} 版
								</Badge>
							</div>
							<p className="text-xs text-muted-foreground">
								提交于 {dateText(selected.createdAt)}
							</p>
							<section className="flex flex-col gap-2">
								<h3 className="font-medium text-sm">问题说明</h3>
								<p className="whitespace-pre-wrap text-sm leading-7">
									{selected.reason}
								</p>
							</section>
							{selected.evidence?.map((item) => {
								const evidence = item.evidence || item;
								return evidence.id ? (
									<EvidenceViewer
										key={evidence.id}
										evidence={{
											id: evidence.id,
											name: evidence.name || "证明材料",
										}}
									/>
								) : null;
							})}
							<Separator />
							{selected.resolution && (
								<section className="flex flex-col gap-2">
									<h3 className="font-medium text-sm">处理结果</h3>
									<p className="whitespace-pre-wrap text-sm leading-7">
										{selected.resolution}
									</p>
								</section>
							)}
							{role === "STUDENT" && selected.status === "OPEN" && (
								<Button
									variant="outline"
									disabled={busy}
									onClick={() => {
										if (window.confirm("确认撤回此异议？"))
											void mutate("withdraw");
									}}
								>
									撤回异议
								</Button>
							)}
							{role === "ADMIN" && selected.status === "OPEN" && (
								<Button disabled={busy} onClick={() => void mutate("process")}>
									开始处理
								</Button>
							)}
							{role === "ADMIN" &&
								["OPEN", "PROCESSING"].includes(selected.status) && (
									<form
										className="flex flex-col gap-5"
										onChange={() => setDirty(true)}
										onSubmit={(e) => {
											e.preventDefault();
											const action = (
												(e.nativeEvent as SubmitEvent)
													.submitter as HTMLButtonElement
											).value;
											void mutate(action, new FormData(e.currentTarget));
										}}
									>
										<FieldGroup>
											<Field>
												<FieldLabel htmlFor="appeal-resolution">
													处理结果
												</FieldLabel>
												<Textarea
													id="appeal-resolution"
													name="resolution"
													required
													minLength={2}
													maxLength={2000}
													rows={4}
												/>
											</Field>
											<Field>
												<FieldLabel htmlFor="appeal-resolved-publication">
													更正后的发布版本
												</FieldLabel>
												<NativeSelect
													id="appeal-resolved-publication"
													name="resolvedPublicationId"
													defaultValue=""
												>
													<NativeSelectOption value="">
														选择更正后的版本（标记已解决时必选）
													</NativeSelectOption>
													{publications.data?.history
														.filter(
															(p) => p.sequence > selected.publication.sequence,
														)
														.map((p) => (
															<NativeSelectOption key={p.id} value={p.id}>
																第 {p.sequence} 版
															</NativeSelectOption>
														))}
												</NativeSelect>
											</Field>
										</FieldGroup>
										<div className="flex flex-wrap gap-2">
											<Button type="submit" value="resolve" disabled={busy}>
												标记已解决
											</Button>
											<Button
												type="submit"
												variant="outline"
												value="reject"
												disabled={busy}
											>
												驳回异议
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
