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
import { phaseLabels } from "@/lib/business-labels";
import { StaffKpiStrip } from "./staff-kpi-strip";
import { WorkbenchItems } from "./workbench-items";
type CounselorData = Extract<WorkbenchData, { role: "COUNSELOR" }>;
// Editing origin: complete dashboard/analytics/page.tsx — the page heading, the
// divided KPI strip and the 7/5 responsive section grid are kept as in the template.
export function CounselorWorkbench({
	data,
	context,
}: {
	data: CounselorData;
	context: ReactNode;
}) {
	const termId = data.term?.id;
	const href = (path: string, query = "") => `${path}?termId=${termId}${query}`;
	return (
		<div className="flex min-w-0 flex-col gap-4">
			<PageHeading
				title="辅导员工作台"
				description={`${data.user.name}，这里汇总负责班级的待办和成绩录入进度：活动参与核对、成果评分、被退回的成绩与扣分。`}
				action={
					termId ? (
						<>
							<Link
								href={href("/grades")}
								className={buttonVariants({ size: "sm" })}
							>
								录入成绩
							</Link>
							<Link
								href={href("/students")}
								className={buttonVariants({ variant: "outline", size: "sm" })}
							>
								我的学生
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
								title: "待我核对的活动参与",
								value: data.stats.pendingRecognitions,
								description: "核对参与记录和证明后交学院审核",
								href: href("/recognitions", "&status=PENDING_COUNSELOR"),
								action: data.stats.pendingRecognitions
									? "去核对"
									: "查看参与记录",
							},
							{
								title: "待我评分的成果申报",
								value: data.stats.pendingClaims,
								description: "评分后交学院审核，学生可查看进度",
								href: href("/claims", "&status=PENDING_COUNSELOR"),
								action: data.stats.pendingClaims ? "去评分" : "查看申报",
							},
							{
								title: "被退回的成绩与扣分",
								value: data.stats.returnedChanges,
								description: "按学院意见修改后重新提交",
								href: href("/grades"),
								action: data.stats.returnedChanges
									? "去修改"
									: "查看成绩录入",
							},
							{
								title: "成绩未录完的学生",
								value: data.stats.gradeIncomplete,
								description: `负责 ${data.stats.classes} 个班级、${data.stats.students} 名学生`,
								href: href("/grades"),
								action: "查看录入进度",
							},
						]}
					/>
					<div className="grid min-w-0 grid-cols-1 items-stretch gap-4 xl:grid-cols-12">
						<div className="min-w-0 xl:col-span-7">
							<PendingWork data={data} href={href} />
						</div>
						<div className="min-w-0 xl:col-span-5">
							<ClassProgressCard data={data} href={href} />
						</div>
					</div>
				</>
			) : (
				<MeasurementEmpty admin={false} />
			)}
		</div>
	);
}
function PendingWork({
	data,
	href,
}: {
	data: CounselorData;
	href: (path: string, query?: string) => string;
}) {
	return (
		<Card className="h-full min-w-0">
			<CardHeader className="has-data-[slot=card-action]:grid-cols-1 md:has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto]">
				<CardTitle className="text-sm">待我处理</CardTitle>
				<CardDescription>
					按提交时间排列，最早的在前；处理完会从列表移除。
				</CardDescription>
				<CardAction className="col-start-1 row-start-auto flex flex-wrap justify-self-start gap-2 md:col-start-2 md:row-start-1 md:justify-self-end">
					<Link
						href={href("/claims")}
						className={buttonVariants({ variant: "outline", size: "sm" })}
					>
						全部成果申报
					</Link>
					<Link
						href={href("/recognitions")}
						className={buttonVariants({ variant: "outline", size: "sm" })}
					>
						全部参与记录
					</Link>
				</CardAction>
			</CardHeader>
			<CardContent>
				<WorkbenchItems
					items={data.todos}
					emptyTitle="当前没有待处理事项"
					emptyDescription="学生提交成果申报或活动参与记录后，等待你处理的会显示在这里。"
				/>
			</CardContent>
		</Card>
	);
}
function ClassProgressCard({
	data,
	href,
}: {
	data: CounselorData;
	href: (path: string, query?: string) => string;
}) {
	const term = data.term!;
	return (
		<Card className="h-full min-w-0">
			<CardHeader className="has-data-[slot=card-action]:grid-cols-1 md:has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto]">
				<CardTitle className="text-sm">我的班级进度</CardTitle>
				<CardAction className="col-start-1 row-start-auto flex flex-wrap items-center gap-2 justify-self-start md:col-start-2 md:row-start-1 md:justify-self-end">
					<Badge variant="outline">{phaseLabels[term.phase]}</Badge>
				</CardAction>
				<CardDescription>
					“成绩已录完”指必填成绩模块都已提交；待办含参与核对与成果评分。
				</CardDescription>
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
										<TableHead className="text-right">待办</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{data.classes.map((item) => {
										const pending =
											item.pendingRecognitions + item.pendingClaims;
										return (
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
													{pending}
												</TableCell>
											</TableRow>
										);
									})}
								</TableBody>
							</Table>
						</div>
						<div className="flex flex-col divide-y md:hidden">
							{data.classes.map((item) => (
								<div className="flex flex-col gap-2 py-3" key={item.id}>
									<div className="flex flex-wrap items-center justify-between gap-2">
										<p className="font-medium">{item.name}</p>
										<Badge variant="outline">
											待办 {item.pendingRecognitions + item.pendingClaims}
										</Badge>
									</div>
									<p className="text-xs text-muted-foreground">{item.major}</p>
									<p className="text-sm tabular-nums">
										学生 {item.students} · 成绩已录完 {item.gradeComplete}
									</p>
								</div>
							))}
						</div>
						<div className="pt-4">
							<Link
								href={href("/grades")}
								className={buttonVariants({ variant: "outline", size: "sm" })}
							>
								查看成绩录入
							</Link>
						</div>
					</>
				) : (
					<NoData
						title="尚未分配班级"
						description="班级和责任辅导员由学院配置；分配后这里会显示班级进度。"
					/>
				)}
			</CardContent>
		</Card>
	);
}
