"use client";
import { EvidenceViewer } from "@/components/dashboard/evidence-viewer";
import { useUnsavedChanges } from "@/components/dashboard/use-unsaved-changes";
import { EvidenceUpload } from "@/components/dashboard/evidence-upload";
import { TemplateDirectory } from "@/components/dashboard/template-directory";
import Link from "next/link";
import { useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import type { DataTableFeatures } from "@/lib/data-table-features";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
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
import { Feedback, requestJson } from "@/components/dashboard/feedback";
import { dateText, statusLabels, type AppRole } from "@/lib/business-labels";
type Recognition = {
	submitterId: string;
	history?: { action: string; at: string; after?: string; reason?: string }[];
	id: string;
	revision: number;
	status: string;
	note: string;
	reviewReason: string | null;
	createdAt: string;
	reviewedAt: string | null;
	student: { id?: string; name: string; login: string } | null;
	participation: {
		studentId?: string;
		activity: { id: string; name: string; points: string; ownerId?: string };
	};
	evidence: { evidence: { id: string; name: string } }[];
};
export function Recognitions({
	data,
	term,
	role,
	status,
	userId,
}: {
	data: { items: Recognition[]; total: number; page: number };
	term: { id: string; phase: string; disposition?: string };
	role: AppRole;
	status: string;
	userId: string;
}) {
	const [ids, setIds] = useState<string[]>([]);
	const [uploading, setUploading] = useState(false);
	const [resubmit, setResubmit] = useState(false);
	const [dirty, setDirty] = useState(false);
	const router = useRouter();
	const path = usePathname();
	const params = useSearchParams();
	const tab =
		params.get("tab") ||
		(path.startsWith("/terms/") ? "recognitions" : "activities");
	const listQuery = new URLSearchParams({
		termId: term.id,
		tab,
		status,
		page: String(data.page),
	});
	const returnHref = `${path}?${listQuery}`;
	const [selected, setSelected] = useState<Recognition | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const canManage =
		selected?.submitterId === userId &&
		(role === "STUDENT"
			? selected.participation.studentId === userId ||
				selected.student?.id === userId
			: selected.participation.activity.ownerId === userId);
	useUnsavedChanges(
		Boolean(selected) && (dirty || ids.length > 0 || uploading || busy),
	);
	function open(row: Recognition) {
		setSelected(row);
		setError("");
		setResubmit(false);
		setDirty(false);
		setIds([]);
		setUploading(false);
	}
	const columns: ColumnDef<DataTableFeatures, Recognition>[] = [
		{
			id: "student",
			header: "学生",
			cell: ({ row }) => (
				<div>
					<p className="font-medium">{row.original.student?.name || "—"}</p>
					<p className="text-xs text-muted-foreground">
						{row.original.student?.login}
					</p>
				</div>
			),
		},
		{
			id: "activity",
			header: "活动 / 申报",
			cell: ({ row }) => (
				<Link
					href={`/activities/${row.original.participation.activity.id}?returnTo=${encodeURIComponent(returnHref)}`}
					className="hover:underline"
				>
					{row.original.participation.activity.name}
				</Link>
			),
		},
		{
			accessorKey: "status",
			header: "状态",
			cell: ({ row }) => (
				<Badge variant="outline">{statusLabels[row.original.status]}</Badge>
			),
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
				<Button variant="ghost" size="sm" onClick={() => open(row.original)}>
					{role === "ADMIN" && row.original.status === "PENDING"
						? "审核材料"
						: "查看详情"}
				</Button>
			),
		},
	];
	return (
		<>
			<TemplateDirectory
				title="活动认定"
				description={`共 ${data.total} 条匹配记录。核对参与事实、证明与处理意见。`}
				data={data.items}
				columns={columns}
				actions={
					<Link
						href={
							path.startsWith("/terms/")
								? `${path}?termId=${term.id}&tab=overview`
								: `/activities?termId=${term.id}`
						}
						className={buttonVariants({ variant: "outline", size: "sm" })}
					>
						活动目录
					</Link>
				}
				filters={
					<form action={path} className="flex flex-wrap items-end gap-3">
						<input type="hidden" name="termId" value={term.id} />
						<input type="hidden" name="tab" value={tab} />
						<Field className="w-full sm:w-48">
							<FieldLabel htmlFor="review-filter">审核状态</FieldLabel>
							<NativeSelect
								id="review-filter"
								name="status"
								defaultValue={status}
							>
								<NativeSelectOption value="">全部状态</NativeSelectOption>
								{Object.entries(statusLabels)
									.filter(([value]) =>
										[
											"PENDING",
											"APPROVED",
											"REJECTED",
											"NEEDS_CHANGES",
											"WITHDRAWN",
											"REVOKED",
										].includes(value),
									)
									.map(([value, label]) => (
										<NativeSelectOption key={value} value={value}>
											{label}
										</NativeSelectOption>
									))}
							</NativeSelect>
						</Field>
						<Button variant="outline">筛选</Button>
					</form>
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
						<div className="flex justify-between gap-2">
							<p className="font-medium">{row.participation.activity.name}</p>
							<Badge variant="outline">{statusLabels[row.status]}</Badge>
						</div>
						<p className="text-xs text-muted-foreground">
							{row.student?.name} · {row.student?.login} ·{" "}
							{dateText(row.createdAt)}
						</p>
						<Button
							variant="outline"
							className="self-start"
							onClick={() => open(row)}
						>
							{role === "ADMIN" && row.status === "PENDING"
								? "审核材料"
								: "查看详情"}
						</Button>
					</div>
				)}
			/>
			<Sheet
				open={!!selected}
				onOpenChange={(value) => {
					if (
						!busy &&
						!uploading &&
						!value &&
						(!dirty || window.confirm("放弃尚未保存的内容？"))
					)
						setSelected(null);
				}}
			>
				<SheetContent className="w-full overflow-y-auto sm:max-w-xl">
					<SheetHeader>
						<SheetTitle>{selected?.participation.activity.name}</SheetTitle>
						<SheetDescription>
							{selected?.student?.name} · {selected?.student?.login}
						</SheetDescription>
					</SheetHeader>
					{selected && (
						<div className="flex flex-col gap-6 px-5 pb-6">
							<Badge variant="outline" className="self-start">
								{statusLabels[selected.status]}
							</Badge>
							<section>
								<h3 className="mb-2 text-sm font-medium">参与说明</h3>
								<p className="whitespace-pre-wrap text-sm leading-7">
									{selected.note}
								</p>
								<p className="mt-2 text-xs text-muted-foreground">
									提交于 {dateText(selected.createdAt)}
								</p>
							</section>
							<section>
								<h3 className="mb-3 text-sm font-medium">证明材料</h3>
								<div className="flex flex-col gap-2">
									{selected.evidence.map(({ evidence }) => (
										<EvidenceViewer key={evidence.id} evidence={evidence} />
									))}
								</div>
							</section>
							{selected.reviewReason && (
								<section className="rounded-lg border p-4">
									<h3 className="mb-2 text-sm font-medium">审核意见</h3>
									<p className="whitespace-pre-wrap text-sm">
										{selected.reviewReason}
									</p>
									<p className="mt-2 text-xs text-muted-foreground">
										{selected.reviewedAt && dateText(selected.reviewedAt)}
									</p>
								</section>
							)}
							{role === "ADMIN" &&
								term.phase === "ACTIVE" &&
								(!term.disposition || term.disposition === "NORMAL") &&
								selected.status === "PENDING" && (
									<form
										className="flex flex-col gap-5 border-t pt-5"
										onChange={() => setDirty(true)}
										onSubmit={async (e) => {
											e.preventDefault();
											if (busy) return;
											const f = new FormData(e.currentTarget);
											const submitter = (e.nativeEvent as SubmitEvent)
												.submitter as HTMLButtonElement;
											setBusy(true);
											setError("");
											try {
												await requestJson("/api/activities", {
													action: "review",
													termId: term.id,
													id: selected.id,
													revision: selected.revision,
													status: submitter.value,
													reason: f.get("reason"),
												});
												setSelected(null);
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
												<FieldLabel htmlFor="review-reason">
													审核意见
												</FieldLabel>
												<Textarea
													id="review-reason"
													name="reason"
													required
													minLength={2}
													maxLength={1000}
													rows={4}
												/>
											</Field>
										</FieldGroup>
										<div className="flex gap-3">
											<Button type="submit" value="APPROVED" disabled={busy}>
												通过认定
											</Button>
											<Button
												type="submit"
												value="NEEDS_CHANGES"
												variant="outline"
												disabled={busy}
											>
												要求补充
											</Button>
											<Button
												type="submit"
												value="REJECTED"
												variant="outline"
												disabled={busy}
											>
												驳回并说明
											</Button>
										</div>
									</form>
								)}
							{term.phase === "ACTIVE" &&
								(!term.disposition || term.disposition === "NORMAL") &&
								selected.status === "APPROVED" &&
								role === "ADMIN" && (
									<form
										className="flex flex-col gap-4"
										onChange={() => setDirty(true)}
										onSubmit={async (e) => {
											e.preventDefault();
											if (busy) return;
											setBusy(true);
											setError("");
											const f = new FormData(e.currentTarget);
											try {
												await requestJson("/api/activities", {
													action: "revoke",
													termId: term.id,
													id: selected.id,
													revision: selected.revision,
													reason: f.get("reason"),
												});
												setSelected(null);
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
												<FieldLabel htmlFor="recognition-revoke">
													撤销认定理由
												</FieldLabel>
												<Textarea
													id="recognition-revoke"
													name="reason"
													required
													minLength={2}
													maxLength={1000}
													rows={3}
												/>
											</Field>
										</FieldGroup>
										<Button type="submit" variant="outline" disabled={busy}>
											撤销有效认定
										</Button>
									</form>
								)}
							{role === "ADMIN" &&
								term.phase === "ACTIVE" &&
								(!term.disposition || term.disposition === "NORMAL") &&
								["PENDING", "NEEDS_CHANGES"].includes(selected.status) && (
									<form
										className="flex flex-col gap-4"
										onChange={() => setDirty(true)}
										onSubmit={async (event) => {
											event.preventDefault();
											if (busy) return;
											const form = new FormData(event.currentTarget);
											setBusy(true);
											setError("");
											try {
												await requestJson("/api/activities", {
													action: "close",
													termId: term.id,
													id: selected.id,
													revision: selected.revision,
													reason: form.get("reason"),
												});
												setSelected(null);
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
												<FieldLabel htmlFor="recognition-close-reason">
													结束认定理由
												</FieldLabel>
												<Textarea
													id="recognition-close-reason"
													name="reason"
													required
													minLength={2}
													maxLength={1000}
													rows={3}
												/>
											</Field>
										</FieldGroup>
										<Button variant="outline" disabled={busy}>
											填写理由并结束未完成认定
										</Button>
									</form>
								)}
							{term.phase === "ACTIVE" &&
								(!term.disposition || term.disposition === "NORMAL") &&
								canManage &&
								["PENDING", "NEEDS_CHANGES"].includes(selected.status) && (
									<>
										<Feedback error={error} />
										<Button
											variant="outline"
											disabled={busy}
											onClick={async () => {
												if (busy || !window.confirm("确认撤回本次参与认定？"))
													return;
												setBusy(true);
												setError("");
												try {
													await requestJson("/api/activities", {
														action: "withdraw",
														termId: term.id,
														id: selected.id,
														revision: selected.revision,
													});
													setSelected(null);
													router.refresh();
												} catch (err) {
													setError((err as Error).message);
												} finally {
													setBusy(false);
												}
											}}
										>
											撤回本人提交
										</Button>
									</>
								)}
							{term.phase === "ACTIVE" &&
								(!term.disposition || term.disposition === "NORMAL") &&
								canManage &&
								["REJECTED", "NEEDS_CHANGES", "WITHDRAWN"].includes(
									selected.status,
								) &&
								(resubmit ? (
									<form
										className="flex flex-col gap-4"
										onChange={() => setDirty(true)}
										onSubmit={async (e) => {
											e.preventDefault();
											if (busy || uploading) return;
											setBusy(true);
											setError("");
											const f = new FormData(e.currentTarget);
											try {
												await requestJson("/api/activities", {
													action: "resubmit",
													termId: term.id,
													id: selected.id,
													revision: selected.revision,
													note: f.get("note"),
													evidenceIds: ids,
												});
												setSelected(null);
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
												<FieldLabel htmlFor="recognition-resubmit">
													补充说明
												</FieldLabel>
												<Textarea
													id="recognition-resubmit"
													name="note"
													defaultValue={selected.note}
													required
													minLength={1}
													maxLength={2000}
													rows={4}
												/>
											</Field>
											<EvidenceUpload
												key={selected.id}
												onChange={setIds}
												onBusy={setUploading}
											/>
										</FieldGroup>
										<Button
											disabled={busy || uploading || !ids.length}
											type="submit"
										>
											重新提交认定
										</Button>
									</form>
								) : (
									<Button
										variant="outline"
										onClick={() => {
											setIds([]);
											setResubmit(true);
										}}
									>
										补充材料并重新提交
									</Button>
								))}
							{!!selected.history?.length && (
								<section className="flex flex-col gap-3">
									<h3 className="font-medium text-sm">处理历史</h3>
									{selected.history.map((event, index) => (
										<div key={index} className="border-l pl-3">
											<p className="text-sm">
												{statusLabels[event.after || ""] ||
													(
														{
															SUBMITTED: "已提交",
															RESUBMIT: "重新提交",
															WITHDRAW: "已撤回",
															REVOKE: "已撤销",
															REVIEWED: "已审核",
														} as Record<string, string>
													)[event.action] ||
													"状态变更"}
											</p>
											<p className="whitespace-pre-wrap text-sm text-muted-foreground">
												{event.reason}
											</p>
											<p className="text-xs text-muted-foreground">
												{dateText(event.at)}
											</p>
										</div>
									))}
								</section>
							)}
						</div>
					)}
				</SheetContent>
			</Sheet>
		</>
	);
}
