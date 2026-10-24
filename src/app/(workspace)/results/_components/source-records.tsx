"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { EvidenceViewer } from "@/components/dashboard/evidence-viewer";
import { InputHistory } from "@/components/dashboard/input-history";
import { dateText } from "@/lib/business-labels";
import {
	dayText,
	nodeName,
	scoreText,
	type Claim,
	type Deduction,
	type EvidenceFile,
	type Grade,
	type Participation,
	type ResultData,
} from "./result-types";

type SourceDetail =
	| { kind: "participation"; item: Participation }
	| { kind: "claim"; item: Claim }
	| { kind: "grade"; item: Grade }
	| { kind: "deduction"; item: Deduction };

function participationFiles(item: Participation) {
	const files = new Map<string, EvidenceFile>();
	for (const file of item.activityEvidence ?? []) files.set(file.id, file);
	for (const source of item.sources ?? [])
		for (const file of source.evidence)
			files.set(file.evidenceId, {
				id: file.evidenceId,
				name: file.name || "证明材料",
			});
	return [...files.values()];
}

function claimFiles(item: Claim) {
	if (item.evidenceFiles?.length) return item.evidenceFiles;
	return (item.evidenceIds ?? []).map((id, index) => ({
		id,
		name: `证明材料 ${index + 1}`,
	}));
}

function deductionValue(item: Deduction) {
	if (item.applied) return scoreText(item.applied);
	return scoreText(String(Number(item.amount) * Number(item.coefficient)));
}

function EvidenceList({ files }: { files: EvidenceFile[] }) {
	if (!files.length)
		return <p className="text-muted-foreground text-sm">暂无证明材料。</p>;
	return (
		<ul className="divide-y rounded-lg border">
			{files.map((file) => (
				<li
					className="flex items-center justify-between gap-3 px-3 py-2"
					key={file.id}
				>
					<span className="min-w-0 truncate text-sm" title={file.name}>
						{file.name}
					</span>
					<EvidenceViewer compact evidence={file} />
				</li>
			))}
		</ul>
	);
}

function DetailItem({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex min-w-0 flex-col gap-1">
			<dt className="text-muted-foreground text-xs">{label}</dt>
			<dd className="break-words text-sm">{value || "—"}</dd>
		</div>
	);
}

function SourceDetailContent({
	detail,
	termId,
	moduleName,
}: {
	detail: SourceDetail;
	termId: string;
	moduleName: string;
}) {
	if (detail.kind === "participation") {
		const item = detail.item;
		const reasons = [
			...new Set(
				(detail.item.sources ?? [])
					.map((source) => source.reviewReason)
					.filter((reason): reason is string => !!reason),
			),
		];
		return (
			<>
				<DialogHeader>
					<DialogTitle className="break-words pr-7">{item.name}</DialogTitle>
					<DialogDescription>活动与成果 · 计分依据</DialogDescription>
				</DialogHeader>
				<dl className="grid gap-4 sm:grid-cols-2">
					<DetailItem label="计分模块" value={moduleName} />
					<DetailItem label="得分" value={`${scoreText(item.points)} 分`} />
					<DetailItem label="活动时间" value={dayText(item.activityDate)} />
					<DetailItem label="通过时间" value={dayText(item.approvedAt)} />
				</dl>
				{reasons.length > 0 && (
					<div className="flex flex-col gap-1">
						<p className="font-medium text-sm">审核说明</p>
						{reasons.map((reason) => (
							<p className="text-muted-foreground text-sm" key={reason}>
								{reason}
							</p>
						))}
					</div>
				)}
				<div className="flex flex-col gap-2">
					<p className="font-medium text-sm">证明材料</p>
					<EvidenceList files={participationFiles(detail.item)} />
				</div>
				<DialogFooter className="flex-wrap sm:justify-between">
					<Link
						className={buttonVariants({ variant: "outline" })}
						href={`/activities/${item.activityId}`}
					>
						<ExternalLink data-icon="inline-start" />
						查看活动详情
					</Link>
					<DialogClose render={<Button variant="outline" />}>关闭</DialogClose>
				</DialogFooter>
			</>
		);
	}

	if (detail.kind === "claim") {
		const item = detail.item;
		return (
			<>
				<DialogHeader>
					<DialogTitle className="break-words pr-7">{item.name}</DialogTitle>
					<DialogDescription>活动与成果 · 计分依据</DialogDescription>
				</DialogHeader>
				<dl className="grid gap-4 sm:grid-cols-2">
					<DetailItem label="计分模块" value={moduleName} />
					<DetailItem label="得分" value={`${scoreText(item.points)} 分`} />
					<DetailItem label="发生时间" value={dayText(item.occurredOn)} />
					<DetailItem label="通过时间" value={dayText(item.reviewedAt)} />
				</dl>
				{item.note && (
					<div className="flex flex-col gap-1">
						<p className="font-medium text-sm">申报说明</p>
						<p className="whitespace-pre-wrap text-muted-foreground text-sm">
							{item.note}
						</p>
					</div>
				)}
				{item.reviewReason && (
					<div className="flex flex-col gap-1">
						<p className="font-medium text-sm">审核说明</p>
						<p className="text-muted-foreground text-sm">{item.reviewReason}</p>
					</div>
				)}
				<div className="flex flex-col gap-2">
					<p className="font-medium text-sm">证明材料</p>
					<EvidenceList files={claimFiles(detail.item)} />
				</div>
				<DialogFooter className="flex-wrap sm:justify-between">
					{item.activityId ? (
						<Link
							className={buttonVariants({ variant: "outline" })}
							href={`/activities/${item.activityId}`}
						>
							<ExternalLink data-icon="inline-start" />
							查看活动详情
						</Link>
					) : (
						<span />
					)}
					<DialogClose render={<Button variant="outline" />}>关闭</DialogClose>
				</DialogFooter>
			</>
		);
	}

	if (detail.kind === "grade") {
		const item = detail.item;
		return (
			<>
				<DialogHeader>
					<DialogTitle className="pr-7">{item.name}</DialogTitle>
					<DialogDescription>成绩录入</DialogDescription>
				</DialogHeader>
				<dl className="grid gap-4 sm:grid-cols-2">
					<DetailItem label="录入方式" value="辅导员录入、学院审核" />
					<DetailItem label="成绩" value={`${scoreText(item.value)} 分`} />
					<DetailItem
						label="最后更新"
						value={item.updatedAt ? dateText(item.updatedAt) : "—"}
					/>
					<DetailItem label="更正次数" value={`${item.revision} 次`} />
				</dl>
				<div className="flex flex-col gap-2 border-t pt-4">
					<p className="font-medium text-sm">变更记录</p>
					<p className="text-muted-foreground text-xs">
						每次录入和更正都会保留操作人、修改前后内容和原因。
					</p>
					<InputHistory id={item.id} kind="grade" termId={termId} />
				</div>
				<DialogFooter>
					<DialogClose render={<Button variant="outline" />}>关闭</DialogClose>
				</DialogFooter>
			</>
		);
	}

	const item = detail.item;
	return (
		<>
			<DialogHeader>
				<DialogTitle className="pr-7">{item.name}</DialogTitle>
				<DialogDescription>扣分 · 计分依据</DialogDescription>
			</DialogHeader>
			<dl className="grid gap-4 sm:grid-cols-2">
				<DetailItem label="计分模块" value={item.nodeName} />
				<DetailItem label="实际扣分" value={`${deductionValue(item)} 分`} />
				<DetailItem label="登记扣分额" value={`${scoreText(item.amount)} 分`} />
				<DetailItem
					label="最后更新"
					value={item.updatedAt ? dateText(item.updatedAt) : "—"}
				/>
			</dl>
			<div className="flex flex-col gap-1 border-t pt-4">
				<p className="font-medium text-sm">扣分事由</p>
				<p className="whitespace-pre-wrap text-muted-foreground text-sm">
					{item.reason}
				</p>
			</div>
			<div className="flex flex-col gap-2">
				<p className="font-medium text-sm">变更记录</p>
				<p className="text-muted-foreground text-xs">
					每次登记、更正和撤销都会保留操作人、修改前后内容和原因。
				</p>
				<InputHistory id={item.id} kind="deduction" termId={termId} />
			</div>
			<DialogFooter>
				<DialogClose render={<Button variant="outline" />}>关闭</DialogClose>
			</DialogFooter>
		</>
	);
}

function RecordRow({
	name,
	meta,
	extra,
	amount,
	onOpen,
}: {
	name: string;
	meta: string;
	extra?: string;
	amount: string;
	onOpen: () => void;
}) {
	return (
		<li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5 sm:py-2">
			<div className="min-w-0 flex-1">
				<p className="truncate font-medium text-sm" title={name}>
					{name}
				</p>
				<p className="mt-0.5 truncate text-muted-foreground text-xs">{meta}</p>
				{extra && (
					<p className="mt-0.5 break-words text-muted-foreground text-xs">
						{extra}
					</p>
				)}
			</div>
			<span className="shrink-0 font-medium text-sm tabular-nums">{amount}</span>
			<Button
				aria-label={`查看${name}`}
				className="min-h-11 sm:min-h-7"
				onClick={onOpen}
				size="sm"
				variant="outline"
			>
				查看
			</Button>
		</li>
	);
}

function SourceGroup({
	title,
	count,
	empty,
	children,
}: {
	title: string;
	count: number;
	empty: string;
	children: ReactNode;
}) {
	return (
		<section className="flex flex-col gap-1">
			<div className="flex items-center justify-between gap-3">
				<h3 className="font-heading font-medium text-base">{title}</h3>
				<Badge variant="outline">{count} 条</Badge>
			</div>
			{count > 0 ? (
				<ul className="divide-y">{children}</ul>
			) : (
				<p className="py-2 text-muted-foreground text-sm">{empty}</p>
			)}
		</section>
	);
}

export function SourceRecords({
	data,
	termId,
}: {
	data: ResultData;
	termId: string;
}) {
	const [detail, setDetail] = useState<SourceDetail | null>(null);
	const byId = new Map(data.result.details.map((node) => [node.id, node]));
	const gradeOrder = new Map(
		data.result.details.map((node, index) => [node.id, node.order ?? index]),
	);
	const participations = [...data.participations].sort((a, b) =>
		(b.activityDate ?? b.approvedAt ?? "").localeCompare(
			a.activityDate ?? a.approvedAt ?? "",
		),
	);
	const claims = [...(data.claims ?? [])].sort((a, b) =>
		(b.occurredOn ?? b.reviewedAt ?? "").localeCompare(
			a.occurredOn ?? a.reviewedAt ?? "",
		),
	);
	const grades = [...(data.grades ?? [])].sort(
		(a, b) =>
			(gradeOrder.get(a.nodeId) ?? 0) - (gradeOrder.get(b.nodeId) ?? 0),
	);
	const deductions = [...data.deductions].sort((a, b) =>
		(b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""),
	);
	const activityCount = participations.length + claims.length;

	return (
		<Card>
			<CardHeader className="border-b">
				<CardTitle className="font-heading font-medium text-base">计分依据</CardTitle>
				<CardDescription>
					这里只列出已经通过审核、真正计入分数的记录。点“查看”可以看到材料和变更历史。
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-5">
				<SourceGroup
					count={activityCount}
					empty="暂无计入分数的活动或成果。"
					title="活动与成果"
				>
					{participations.map((item) => (
						<RecordRow
							amount={`${scoreText(item.points)} 分`}
							key={item.id}
							meta={[
								nodeName(byId, item.nodeId),
								dayText(item.activityDate),
								"已通过",
							]
								.filter(Boolean)
								.join(" · ")}
							name={item.name}
							onOpen={() => setDetail({ kind: "participation", item })}
						/>
					))}
					{claims.map((item) => (
						<RecordRow
							amount={`${scoreText(item.points)} 分`}
							key={item.id}
							meta={[
								nodeName(byId, item.nodeId),
								dayText(item.occurredOn),
								"已通过",
							]
								.filter(Boolean)
								.join(" · ")}
							name={item.name}
							onOpen={() => setDetail({ kind: "claim", item })}
						/>
					))}
				</SourceGroup>

				<Separator />

				<SourceGroup
					count={grades.length}
					empty="暂无成绩录入记录。"
					title="成绩录入"
				>
					{grades.map((item) => (
						<RecordRow
							amount={`${scoreText(item.value)} 分`}
							key={item.id}
							meta={[dayText(item.updatedAt), "已录入"]
								.filter(Boolean)
								.join(" · ")}
							name={item.name}
							onOpen={() => setDetail({ kind: "grade", item })}
						/>
					))}
				</SourceGroup>

				<Separator />

				<SourceGroup
					count={deductions.length}
					empty="暂无扣分记录。"
					title="扣分"
				>
					{deductions.map((item) => (
						<RecordRow
							amount={`-${deductionValue(item)} 分`}
							extra={item.reason}
							key={item.id}
							meta={[item.nodeName, dayText(item.updatedAt), "已生效"]
								.filter(Boolean)
								.join(" · ")}
							name={item.name}
							onOpen={() => setDetail({ kind: "deduction", item })}
						/>
					))}
				</SourceGroup>
			</CardContent>

			<Dialog
				onOpenChange={(open) => {
					if (!open) setDetail(null);
				}}
				open={!!detail}
			>
				<DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
					{detail && (
						<SourceDetailContent
							detail={detail}
							moduleName={
								detail.kind === "grade"
									? detail.item.name
									: detail.kind === "deduction"
										? detail.item.nodeName
										: nodeName(byId, detail.item.nodeId)
							}
							termId={termId}
						/>
					)}
				</DialogContent>
			</Dialog>
		</Card>
	);
}
