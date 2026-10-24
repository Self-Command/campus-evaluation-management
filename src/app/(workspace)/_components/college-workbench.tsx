import Link from "next/link";
import type { ReactNode } from "react";
import type { WorkbenchData } from "@/server/workbench";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
	CardAction,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { PageHeading, NoData } from "@/components/dashboard/page-heading";
import { MeasurementEmpty } from "@/components/dashboard/measurement-empty";
import { dateText, phaseLabels } from "@/lib/business-labels";
import { StaffKpiStrip } from "./staff-kpi-strip";
import { WorkbenchItems } from "./workbench-items";
type CollegeData = Extract<WorkbenchData, { role: "COLLEGE" }>;
// Editing origin: complete dashboard/analytics/page.tsx — page heading, divided KPI
// strip, 7/5 responsive section grid and the full-width table section.
export function CollegeWorkbench({
	data,
	context,
}: {
	data: CollegeData;
	context: ReactNode;
}) {
	const termId = data.term?.id;
	const href = (path: string, query = "") => `${path}?termId=${termId}${query}`;
	return (
		<div className="flex min-w-0 flex-col gap-4">
			<PageHeading
				title="学院工作台"
				description={`${data.user.name}，这里汇总本院待审核事项、活动名单和班级进度；审核通过后按批准值计入学生成绩。`}
				action={
					termId ? (
						<>
							<Link
								href={href("/activities")}
								className={buttonVariants({ size: "sm" })}
							>
								本院活动
							</Link>
							<Link
								href={href("/imports", "&kind=participation")}
								className={buttonVariants({ variant: "outline", size: "sm" })}
							>
								导入活动名单
							</Link>
						</>
					) : undefined
				}
			/>
			{context}
			{data.term ? (
				<>
					<StaffKpiStrip
						items={[
							{
								title: "待审活动参与",
								value: data.stats.pendingRecognitions,
								description: "辅导员已核对，等待本院审核",
								href: href("/recognitions", "&status=PENDING_COLLEGE"),
								action: data.stats.pendingRecognitions
									? "去审核"
									: "查看参与记录",
							},
							{
								title: "待审成果申报",
								value: data.stats.pendingClaims,
								description: "辅导员已评分，等待本院终审",
								href: href("/claims", "&status=PENDING_COLLEGE"),
								action: data.stats.pendingClaims ? "去审核" : "查看成果申报",
							},
							{
								title: "待审成绩修改",
								value: data.stats.pendingGradeChanges,
								description: "通过后按修改后成绩生效",
								href: href("/grades"),
								action: data.stats.pendingGradeChanges
									? "去审核"
									: "查看成绩",
							},
							{
								title: "待审扣分记录",
								value: data.stats.pendingDeductionChanges,
								description: "通过后计入学生总分",
								href: href("/deductions"),
								action: data.stats.pendingDeductionChanges
									? "去审核"
									: "查看扣分",
							},
						]}
					/>
					<div className="grid min-w-0 grid-cols-1 items-stretch gap-4 xl:grid-cols-12">
						<div className="min-w-0 xl:col-span-7">
							<PendingReview data={data} href={href} />
						</div>
						<div className="min-w-0 xl:col-span-5">
							<ActivityRoster data={data} href={href} />
						</div>
					</div>
					<ClassProgress data={data} href={href} />
				</>
			) : (
				<MeasurementEmpty admin={false} />
			)}
		</div>
	);
}
function PendingReview({
	data,
	href,
}: {
	data: CollegeData;
	href: (path: string, query?: string) => string;
}) {
	return (
		<Card className="h-full min-w-0">
			<CardHeader className="has-data-[slot=card-action]:grid-cols-1 md:has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto]">
				<CardTitle className="text-sm">待我审核</CardTitle>
				<CardDescription>
					四类审核按提交时间排列，最早的在前；退回时必须说明需要改什么。
				</CardDescription>
				<CardAction className="col-start-1 row-start-auto flex flex-wrap justify-self-start gap-2 md:col-start-2 md:row-start-1 md:justify-self-end">
					<Link
						href={href("/recognitions", "&status=PENDING_COLLEGE")}
						className={buttonVariants({ variant: "outline", size: "sm" })}
					>
						参与审核
					</Link>
					<Link
						href={href("/claims", "&status=PENDING_COLLEGE")}
						className={buttonVariants({ variant: "outline", size: "sm" })}
					>
						申报审核
					</Link>
					<Link
						href={href("/grades")}
						className={buttonVariants({ variant: "outline", size: "sm" })}
					>
						成绩审核
					</Link>
					<Link
						href={href("/deductions")}
						className={buttonVariants({ variant: "outline", size: "sm" })}
					>
						扣分审核
					</Link>
				</CardAction>
			</CardHeader>
			<CardContent>
				<WorkbenchItems
					items={data.todos}
					emptyTitle="当前没有待审核事项"
					emptyDescription="辅导员核对参与记录、评分成果或提交成绩后，等待本院审核的会显示在这里。"
				/>
			</CardContent>
		</Card>
	);
}
function ActivityRoster({
	data,
	href,
}: {
	data: CollegeData;
	href: (path: string, query?: string) => string;
}) {
	return (
		<Card className="h-full min-w-0">
			<CardHeader className="has-data-[slot=card-action]:grid-cols-1 md:has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto]">
				<CardTitle className="text-sm">本院活动名单</CardTitle>
				<CardAction className="col-start-1 row-start-auto flex flex-wrap items-center gap-2 justify-self-start md:col-start-2 md:row-start-1 md:justify-self-end">
					<Badge variant="outline">{phaseLabels[data.term!.phase]}</Badge>
				</CardAction>
				<CardDescription>
					已发布但还没有名单的活动；名单由主办学院统一导入，共{" "}
					{data.stats.awaitingRoster} 个。
				</CardDescription>
			</CardHeader>
			<CardContent className="flex min-w-0 flex-col gap-3">
				{data.activities.length ? (
					data.activities.map((activity) => (
						<div
							key={activity.id}
							className="flex min-w-0 flex-col gap-2 border-b pb-3 last:border-b-0 last:pb-0"
						>
							<div className="flex flex-wrap items-start justify-between gap-2">
								<Link
									href={`/activities/${activity.id}`}
									className="break-words font-medium text-sm underline underline-offset-4"
								>
									{activity.name}
								</Link>
								<Badge variant="outline">{activity.points} 分</Badge>
							</div>
							<p className="text-xs text-muted-foreground">
								{activity.organizer} · {dateText(activity.startsAt)} 至{" "}
								{dateText(activity.endsAt)}
							</p>
							<p className="text-xs text-muted-foreground">
								已登记 {activity.participantCount} 人
							</p>
							<Link
								href={href("/imports", "&kind=participation")}
								className={buttonVariants({
									variant: "outline",
									size: "sm",
									className: "self-start",
								})}
							>
								导入名单
							</Link>
						</div>
					))
				) : (
					<NoData
						title="本院活动名单已全部导入"
						description="活动发布并导入参与名单后，辅导员才能核对参与记录。"
					/>
				)}
			</CardContent>
		</Card>
	);
}
function ClassProgress({
	data,
	href,
}: {
	data: CollegeData;
	href: (path: string, query?: string) => string;
}) {
	return (
		<Card className="min-w-0">
			<CardHeader className="has-data-[slot=card-action]:grid-cols-1 md:has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto]">
				<CardTitle className="text-sm">本院班级进度</CardTitle>
				<CardDescription>
					共 {data.stats.classes} 个班级、{data.stats.students} 名学生；
					{data.stats.gradeIncomplete} 名学生还有必填成绩未提交。
				</CardDescription>
				<CardAction className="col-start-1 row-start-auto flex flex-wrap justify-self-start gap-2 md:col-start-2 md:row-start-1 md:justify-self-end">
					<Link
						href={href("/grades")}
						className={buttonVariants({ variant: "outline", size: "sm" })}
					>
						查看成绩录入
					</Link>
					<Link
						href="/students"
						className={buttonVariants({ variant: "outline", size: "sm" })}
					>
						本院学生
					</Link>
				</CardAction>
			</CardHeader>
			<CardContent className="min-w-0">
				{data.classes.length ? (
					<>
						<div className="hidden min-w-0 md:block">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>班级</TableHead>
										<TableHead className="text-right">学生</TableHead>
										<TableHead className="text-right">成绩已录完</TableHead>
										<TableHead className="text-right">待审参与</TableHead>
										<TableHead className="text-right">待审申报</TableHead>
										<TableHead className="text-right">待审成绩</TableHead>
										<TableHead className="text-right">待审扣分</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{data.classes.map((item) => (
										<TableRow key={item.id}>
											<TableCell>
												<p className="font-medium">{item.name}</p>
												<p className="text-xs text-muted-foreground">
													{item.major}
												</p>
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{item.students}
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{item.gradeComplete} / {item.students}
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{item.pendingRecognitions}
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{item.pendingClaims}
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{item.pendingGradeChanges}
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{item.pendingDeductionChanges}
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>
						<div className="flex flex-col divide-y md:hidden">
							{data.classes.map((item) => (
								<div className="flex flex-col gap-2 py-3" key={item.id}>
									<div className="flex flex-wrap items-center justify-between gap-2">
										<p className="font-medium">{item.name}</p>
										<Badge variant="outline">
											待审{" "}
											{item.pendingRecognitions +
												item.pendingClaims +
												item.pendingGradeChanges +
												item.pendingDeductionChanges}
										</Badge>
									</div>
									<p className="text-xs text-muted-foreground">{item.major}</p>
									<p className="text-sm tabular-nums">
										学生 {item.students} · 成绩已录完 {item.gradeComplete}
									</p>
									<p className="text-xs text-muted-foreground">
										参与 {item.pendingRecognitions} · 申报{" "}
										{item.pendingClaims} · 成绩 {item.pendingGradeChanges} · 扣分{" "}
										{item.pendingDeductionChanges}
									</p>
								</div>
							))}
						</div>
					</>
				) : (
					<NoData
						title="本院尚未配置班级"
						description="专业和班级由学院在本院班级中维护；配置后这里会显示进度。"
					/>
				)}
			</CardContent>
		</Card>
	);
}
