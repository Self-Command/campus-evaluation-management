import Link from "next/link";
import type { ReactNode } from "react";
import { ClipboardList, GraduationCap } from "lucide-react";
import type { WorkbenchData } from "@/server/workbench";
import {
	Card,
	CardHeader,
	CardTitle,
	CardDescription,
	CardContent,
	CardAction,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { PageHeading, NoData } from "@/components/dashboard/page-heading";
import { MeasurementEmpty } from "@/components/dashboard/measurement-empty";
import {
	Table,
	TableHeader,
	TableRow,
	TableHead,
	TableBody,
	TableCell,
} from "@/components/ui/table";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { dateText, phaseLabels } from "@/lib/business-labels";
import { WorkbenchItems } from "./workbench-items";
type StudentData = Extract<WorkbenchData, { role: "STUDENT" }>;
function outcomeHref(data: StudentData) {
	if (data.outcome.state === "CONFIGURATION")
		return `/terms/${data.term!.id}?tab=scheme`;
	if (["NO_PROFILE", "NOT_INCLUDED"].includes(data.outcome.state))
		return "/profile";
	return `/results?termId=${data.term!.id}`;
}
function outcomeLabel(data: StudentData) {
	if (data.outcome.state === "CONFIGURATION") return "查看评分制度";
	if (["NO_PROFILE", "NOT_INCLUDED"].includes(data.outcome.state))
		return "核对本人档案";
	return "查看我的测评";
}
// Editing origin: complete dashboard/academy/page.tsx, retaining KPI row and 5:7 / 8:4 responsive sections.
export function StudentWorkbench({
	data,
	context,
}: {
	data: StudentData;
	context: ReactNode;
}) {
	return (
		<div className="flex min-w-0 flex-col gap-4">
			<div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
				<PageHeading
					title="我的测评概览"
					description={`${data.user.name}，核对本人成绩与计分依据，及时补充材料并确认发布结果。`}
				/>
				{data.term && (
					<div className="flex flex-wrap items-center gap-2 lg:w-fit">
						<Link
							href={outcomeHref(data)}
							className={buttonVariants({ size: "sm" })}
						>
							<GraduationCap data-icon="inline-start" />
							{outcomeLabel(data)}
						</Link>
						<Link
							href={`/claims?termId=${data.term.id}`}
							className={buttonVariants({ variant: "outline", size: "sm" })}
						>
							<ClipboardList data-icon="inline-start" />
							个人申报
						</Link>
					</div>
				)}
			</div>
			{context}
			{data.term ? (
				<>
					<KpiCards data={data} />
					<div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-12">
						<div className="min-w-0 xl:col-span-5">
							<ClassSchedule data={data} />
						</div>
						<div className="min-w-0 xl:col-span-7">
							<AssignmentStatus data={data} />
						</div>
					</div>
					<div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-12">
						<div className="min-w-0 xl:col-span-8">
							<PerformanceHighlights data={data} />
						</div>
						<div className="min-w-0 xl:col-span-4">
							<UpcomingEvents data={data} />
						</div>
					</div>
					<RecentRecords data={data} />
				</>
			) : (
				<MeasurementEmpty admin={false} />
			)}
		</div>
	);
}
function KpiCards({ data }: { data: StudentData }) {
	const outcome = data.outcome;
	const score = outcome.total ?? outcome.provisionalTotal;
	const items = [
		{
			title: outcome.state === "PUBLISHED" ? "已发布综合总分" : "当前综合成绩",
			value: score ?? "暂无成绩",
			description:
				outcome.total === null && outcome.provisionalTotal !== null
					? "必需输入缺失，当前分值仅暂计"
					: outcome.state === "PUBLISHED"
						? `固定发布版本 ${outcome.publication?.sequence}`
						: outcome.state === "CONFIGURATION"
							? "评分制度尚未生效"
							: outcome.state === "NO_PROFILE"
								? "请先核对本人学生档案"
								: outcome.state === "NOT_INCLUDED"
									? "请联系管理员核对发布名单"
									: "实时成绩随有效输入更新",
		},
		{
			title: "本人待审核",
			value: String(data.stats.pendingRecognitions + data.stats.pendingClaims),
			description: `活动认定 ${data.stats.pendingRecognitions} · 个人申报 ${data.stats.pendingClaims}`,
		},
		{
			title: "本人待补材料",
			value: String(data.stats.needsChanges),
			description: "查看审核意见后补充材料并重新提交",
		},
		{
			title: "本人发布名次",
			value: outcome.rank === null ? "尚无名次" : `第 ${outcome.rank} 名`,
			description:
				outcome.population === null
					? "以正式发布名单为准"
					: `冻结参评名单共 ${outcome.population} 人`,
		},
	];
	return (
		<section className="flex min-w-0 flex-col gap-5">
			<div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
				{items.map((item) => (
					<Card key={item.title} className="min-w-0">
						<CardHeader className="has-data-[slot=card-action]:grid-cols-1 md:has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto]">
							<CardTitle className="text-sm">{item.title}</CardTitle>
						</CardHeader>
						<CardContent className="flex flex-col gap-3">
							<div className="break-words text-3xl leading-none tracking-tight tabular-nums">
								{item.value}
							</div>
							<p className="text-xs text-muted-foreground">
								{item.description}
							</p>
						</CardContent>
					</Card>
				))}
			</div>
		</section>
	);
}
function ClassSchedule({ data }: { data: StudentData }) {
	const outcome = data.outcome;
	const publication = outcome.publication;
	const states = {
		NO_TERM: "暂无测评周期",
		NO_PROFILE: "尚无本人学生档案",
		CONFIGURATION: "评分制度配置中",
		ACTIVE: outcome.complete ? "当前成绩完整" : "仍有必需输入待补齐",
		PUBLISHED: outcome.confirmedAt
			? "本发布版本已确认"
			: data.term!.phase === "LOCKED"
				? "本周期结果已锁定"
				: "本发布版本尚未确认",
		NOT_INCLUDED: "本人不在当前发布名单中",
	};
	return (
		<Card className="h-full min-w-0">
			<CardHeader className="has-data-[slot=card-action]:grid-cols-1 md:has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto]">
				<CardTitle className="text-sm">我的周期与核对任务</CardTitle>
				<CardAction className="col-start-1 row-start-auto flex flex-wrap justify-self-start gap-2 md:col-start-2 md:row-start-1 md:justify-self-end">
					<Badge variant="outline">{phaseLabels[data.term!.phase]}</Badge>
				</CardAction>
				<CardDescription>{data.term!.name}</CardDescription>
			</CardHeader>
			<CardContent className="flex min-w-0 flex-col gap-4">
				<Alert>
					<AlertTitle>{states[outcome.state]}</AlertTitle>
					<AlertDescription>
						{outcome.state === "NO_PROFILE"
							? "请联系管理员补齐学生档案后参加测评。"
							: outcome.state === "NOT_INCLUDED"
								? "发布名单按发布时冻结，若与实际情况不符，请联系管理员核对。"
								: outcome.state === "CONFIGURATION"
									? "制度生效后可提交本人事实，并查看实时成绩。"
									: outcome.state === "PUBLISHED"
										? "请核对本版本的总分、各模块输入和有效认定依据。"
										: "当前成绩随审核与录入更新，正式成绩以发布版本为准。"}
					</AlertDescription>
				</Alert>
				<dl className="flex flex-col divide-y text-sm">
					<div className="flex flex-wrap justify-between gap-2 py-3">
						<dt className="text-muted-foreground">制度 / 输入修订</dt>
						<dd>
							{data.term!.revision} / {data.term!.inputRevision}
						</dd>
					</div>
					<div className="flex flex-wrap justify-between gap-2 py-3">
						<dt className="text-muted-foreground">发布版本</dt>
						<dd>
							{publication ? `第 ${publication.sequence} 版` : "尚未发布"}
						</dd>
					</div>
					<div className="flex flex-wrap justify-between gap-2 py-3">
						<dt className="text-muted-foreground">核对截止</dt>
						<dd>
							{publication
								? dateText(publication.checkingEndsAt)
								: "发布时确定"}
						</dd>
					</div>
					<div className="flex flex-wrap justify-between gap-2 py-3">
						<dt className="text-muted-foreground">本人确认状态</dt>
						<dd>
							{outcome.confirmedAt
								? dateText(outcome.confirmedAt)
								: publication
									? publication.requireConfirmation
										? data.term!.phase === "LOCKED"
											? "本版本未确认，周期已锁定"
											: "本版本要求确认"
										: "本版本不强制确认"
									: "等待发布"}
						</dd>
					</div>
					<div className="flex justify-between gap-2 py-3">
						<dt className="text-muted-foreground">本人未决异议</dt>
						<dd>{data.stats.openAppeals}</dd>
					</div>
				</dl>
				<div className="flex flex-wrap gap-2">
					<Link
						href={outcomeHref(data)}
						className={buttonVariants({ variant: "outline", size: "sm" })}
					>
						{data.outcome.state === "ACTIVE" ||
						data.outcome.state === "PUBLISHED"
							? "计分依据与版本核对"
							: outcomeLabel(data)}
					</Link>
					<Link
						href={`/appeals?termId=${data.term!.id}`}
						className={buttonVariants({ variant: "outline", size: "sm" })}
					>
						本人异议记录
					</Link>
				</div>
			</CardContent>
		</Card>
	);
}
function AssignmentStatus({ data }: { data: StudentData }) {
	return (
		<Card className="h-full min-w-0">
			<CardHeader className="has-data-[slot=card-action]:grid-cols-1 md:has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto]">
				<CardTitle className="text-sm">最近待补材料与申报跟进</CardTitle>
				<CardDescription>
					仅展示本人提交的认定与申报，点击记录查看审核意见和补充要求。
				</CardDescription>
				<CardAction className="col-start-1 row-start-auto justify-self-start md:col-start-2 md:row-start-1 md:justify-self-end flex flex-wrap gap-2">
					<Link
						href={`/recognitions?termId=${data.term!.id}`}
						className={buttonVariants({ variant: "outline", size: "sm" })}
					>
						活动认定
					</Link>
					<Link
						href={`/claims?termId=${data.term!.id}`}
						className={buttonVariants({ variant: "outline", size: "sm" })}
					>
						个人申报
					</Link>
				</CardAction>
			</CardHeader>
			<CardContent>
				<WorkbenchItems
					items={data.followUps}
					emptyTitle="暂无需要补充或跟进的本人材料"
					emptyDescription="参与活动或取得成果后，提交真实说明及证明材料。"
				/>
			</CardContent>
		</Card>
	);
}
function PerformanceHighlights({ data }: { data: StudentData }) {
	return (
		<Card className="h-full min-w-0">
			<CardHeader className="has-data-[slot=card-action]:grid-cols-1 md:has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto]">
				<CardTitle className="text-sm">本人评分模块概览</CardTitle>
				<CardDescription>
					模块计入分及向上贡献分；缺失与已录入零分分别标记。
				</CardDescription>
				<CardAction className="col-start-1 row-start-auto flex flex-wrap justify-self-start gap-2 md:col-start-2 md:row-start-1 md:justify-self-end">
					<Link
						href={outcomeHref(data)}
						className={buttonVariants({ variant: "outline", size: "sm" })}
					>
						{data.outcome.state === "ACTIVE" ||
						data.outcome.state === "PUBLISHED"
							? "完整计算明细"
							: outcomeLabel(data)}
					</Link>
				</CardAction>
			</CardHeader>
			<CardContent className="min-w-0">
				{data.modules.length ? (
					<>
						<div className="hidden min-w-0 md:block">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>评分模块</TableHead>
										<TableHead>计入分</TableHead>
										<TableHead>向上贡献</TableHead>
										<TableHead>输入状态</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{data.modules.map((module) => (
										<TableRow key={module.id}>
											<TableCell>{module.name}</TableCell>
											<TableCell className="tabular-nums">
												{module.score}
											</TableCell>
											<TableCell className="tabular-nums">
												{module.parentContribution}
											</TableCell>
											<TableCell>
												<Badge variant="outline">
													{module.complete ? "完整" : "待补齐"}
												</Badge>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>
						<div className="flex flex-col divide-y md:hidden">
							{data.modules.map((module) => (
								<div className="flex flex-col gap-2 py-3" key={module.id}>
									<div className="flex flex-wrap items-center justify-between gap-2">
										<p className="font-medium">{module.name}</p>
										<Badge variant="outline">
											{module.complete ? "完整" : "待补齐"}
										</Badge>
									</div>
									<p className="text-sm tabular-nums">
										计入 {module.score} · 向上贡献 {module.parentContribution}
									</p>
								</div>
							))}
						</div>
					</>
				) : (
					<NoData
						title="尚无本人模块成绩"
						description={
							data.outcome.state === "CONFIGURATION"
								? "评分制度配置完成后，可以在这里核对本人模块。"
								: "请先确认本人档案与本周期参评范围。"
						}
					/>
				)}{" "}
				{!!data.outcome.missing.length && (
					<Alert className="mt-4">
						<AlertTitle>必需输入待补齐</AlertTitle>
						<AlertDescription>
							{data.outcome.missing.map((item) => item.name).join("、")}
							。请联系管理员核对录入；暂计分不作为正式总分。
						</AlertDescription>
					</Alert>
				)}
			</CardContent>
		</Card>
	);
}
function UpcomingEvents({ data }: { data: StudentData }) {
	return (
		<Card className="min-w-0">
			<CardHeader className="has-data-[slot=card-action]:grid-cols-1 md:has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto]">
				<CardTitle className="text-sm">最近可参与活动</CardTitle>
				<CardDescription>当前周期已发布且符合本人范围的活动</CardDescription>
				<CardAction className="col-start-1 row-start-auto flex flex-wrap justify-self-start gap-2 md:col-start-2 md:row-start-1 md:justify-self-end">
					<Link
						href={`/activity-feed?termId=${data.term!.id}`}
						className={buttonVariants({ variant: "outline", size: "sm" })}
					>
						已发布活动
					</Link>
				</CardAction>
			</CardHeader>
			<CardContent className="flex min-w-0 flex-col gap-4">
				{data.opportunities.length ? (
					data.opportunities.map((activity) => (
						<Link
							key={activity.id}
							href={`/activities/${activity.id}`}
							className="flex min-w-0 items-start justify-between gap-3"
						>
							<div className="flex min-w-0 items-start gap-2">
								<div className="size-11 shrink-0 overflow-hidden rounded-sm border">
									<div className="grid h-1/3 place-items-center border-b bg-muted text-[10px] leading-none">
										{activity.startsAt.getMonth() + 1}月
									</div>
									<div className="grid h-2/3 place-items-center text-lg leading-none">
										{activity.startsAt.getDate()}
									</div>
								</div>
								<div className="flex min-w-0 flex-col gap-1">
									<p className="break-words font-medium text-sm">
										{activity.name}
									</p>
									<p className="break-words text-xs text-muted-foreground">
										{activity.organizer}
									</p>
									<p className="text-xs text-muted-foreground">
										{dateText(activity.startsAt)}
										<br />至 {dateText(activity.endsAt)}
									</p>
								</div>
							</div>
							<Badge variant="outline">{activity.points} 分</Badge>
						</Link>
					))
				) : (
					<NoData
						title="当前暂无可参与活动"
						description="可查看已发布活动，或按认定项目提交本人已经取得的成果。"
					/>
				)}
			</CardContent>
		</Card>
	);
}
function RecentRecords({ data }: { data: StudentData }) {
	return (
		<Card className="min-w-0">
			<CardHeader className="has-data-[slot=card-action]:grid-cols-1 md:has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto]">
				<CardTitle>最近本人认定与申报记录</CardTitle>
				<CardDescription>
					已通过活动认定 {data.stats.approvedRecognitions} 条 · 已通过个人申报{" "}
					{data.stats.approvedClaims} 条，均为当前周期全量。
				</CardDescription>
				<CardAction className="col-start-1 row-start-auto flex flex-wrap justify-self-start gap-2 md:col-start-2 md:row-start-1 md:justify-self-end">
					<Link
						href={`/claims?termId=${data.term!.id}`}
						className={buttonVariants({ variant: "outline", size: "sm" })}
					>
						全部个人申报
					</Link>
				</CardAction>
			</CardHeader>
			<CardContent>
				<WorkbenchItems
					items={data.recent}
					emptyTitle="本周期尚无本人提交记录"
					emptyDescription="提交活动参与认定或个人成果申报后，可在这里查看最近处理状态。"
				/>
			</CardContent>
		</Card>
	);
}
