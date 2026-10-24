import Link from "next/link";
import type { ReactNode } from "react";
import { ClipboardCheck, FileCheck2, MessageSquareWarning, CalendarClock } from "lucide-react";
import type { WorkbenchData } from "@/server/workbench";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardAction } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { PageHeading, NoData } from "@/components/dashboard/page-heading";
import { MeasurementEmpty } from "@/components/dashboard/measurement-empty";
import { dateText, phaseLabels } from "@/lib/business-labels";
import { WorkbenchItems } from "./workbench-items";
type AdminData = Extract<WorkbenchData, { role: "ADMIN" }>;
// Editing origin: dashboard/default/page.tsx and its complete metric-cards/performance-overview/subscriber-overview.
export function AdminWorkbench({ data, context }: { data: AdminData; context: ReactNode }) {
  const termId = data.term?.id;
  const href = (path: string, query = "") => `${path}?termId=${termId}${query}`;
  const phaseAction = !data.term
    ? null
    : data.term.phase === "CONFIGURATION"
      ? { label: "继续配置评分方案", href: `/terms/${data.term.id}?tab=scheme` }
      : { label: data.term.phase === "ACTIVE" ? "准备结果发布" : "查看发布结果", href: `/publication?termId=${data.term.id}` };
  return (
    <div className="@container/main flex min-w-0 flex-col gap-4 md:gap-6">
      <PageHeading
        title="学校测评工作台"
        description={`${data.user.name}，这里汇总各学院和辅导员的办理进度；你负责处理成绩异议、发布结果和监督办理进度。`}
        action={
          <div className="flex flex-wrap gap-2">
            {phaseAction ? (
              <Link href={phaseAction.href} className={buttonVariants()}>
                {phaseAction.label}
              </Link>
            ) : null}
            <Link href="/terms?new=1" className={buttonVariants({ variant: phaseAction ? "outline" : "default" })}>
              创建测评周期
            </Link>
          </div>
        }
      />
      {context}
      {data.term ? (
        <>
          <MetricCards data={data} />
          <PerformanceOverview data={data} />
        </>
      ) : (
        <MeasurementEmpty admin />
      )}
      <SubscriberOverview data={data} />
      {data.term && (
        <Card>
          <CardHeader className="has-data-[slot=card-action]:grid-cols-1 md:has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto]">
            <CardTitle>优先处理的成绩异议</CardTitle>
            <CardDescription>当前周期最早提交、尚未处理的异议，最多 6 条；处理结果与更正记录关联。</CardDescription>
            <CardAction className="col-start-1 row-start-auto flex flex-wrap justify-self-start gap-2 md:col-start-2 md:row-start-1 md:justify-self-end">
              <Link href={href("/appeals")} className={buttonVariants({ variant: "outline", size: "sm" })}>
                全部异议
              </Link>
            </CardAction>
          </CardHeader>
          <CardContent>
            <WorkbenchItems
              items={data.appeals}
              emptyTitle="暂无待处理异议"
              emptyDescription="学生提交异议后，会在这里显示。"
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
function MetricCards({ data }: { data: AdminData }) {
  const termId = data.term!.id;
  const items = [
    {
      title: "进行中的活动",
      value: data.stats.ongoingActivities,
      description: "已发布且当前在活动时间内",
      href: `/activities?termId=${termId}`,
      action: "查看活动",
      icon: CalendarClock,
    },
    {
      title: "待我处理的成绩异议",
      value: data.stats.openAppeals,
      description: "含处理中，处理后通知学生",
      href: `/appeals?termId=${termId}`,
      action: data.stats.openAppeals ? "去处理" : "查看异议",
      icon: MessageSquareWarning,
    },
    {
      title: "活动参与等待审核",
      value: data.stats.pendingRecognitions,
      description: "辅导员和学院审核，仅查看进度",
      href: `/recognitions?termId=${termId}&status=PENDING`,
      action: "查看进度",
      icon: ClipboardCheck,
    },
    {
      title: "成果申报等待处理",
      value: data.stats.pendingClaims,
      description: "辅导员评分、学院审核，仅查看进度",
      href: `/claims?termId=${termId}&status=PENDING`,
      action: "查看进度",
      icon: FileCheck2,
    },
  ];
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <Card key={item.title} className="min-w-0 shadow-xs">
          <CardHeader className="has-data-[slot=card-action]:grid-cols-1 md:has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto]">
            <CardTitle>
              <div className="flex size-7 items-center justify-center rounded-lg border bg-muted text-muted-foreground">
                <item.icon className="size-4" />
              </div>
            </CardTitle>
            <CardDescription>{item.title}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <div className="font-medium text-3xl tabular-nums leading-none tracking-tight">{item.value}</div>
            <p className="text-sm text-muted-foreground">{item.description}</p>
            <Link href={item.href} className="text-sm underline underline-offset-4">
              {item.action}
            </Link>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
function PerformanceOverview({ data }: { data: AdminData }) {
  return (
    <Card className="@container/card min-w-0">
      <CardHeader className="has-data-[slot=card-action]:grid-cols-1 md:has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto]">
        <CardTitle className="leading-none">全校待办进度</CardTitle>
        <CardDescription>
          {data.term!.name} · 共{" "}
          {data.stats.pendingRecognitions + data.stats.pendingClaims} 条记录等待处理，按提交时间显示最早 8
          条；审核由对应辅导员和学院完成。
        </CardDescription>
        <CardAction className="col-start-1 row-start-auto justify-self-start md:col-start-2 md:row-start-1 md:justify-self-end flex flex-wrap items-center gap-2">
          <Link
            href={`/recognitions?termId=${data.term!.id}&status=PENDING`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            活动参与进度
          </Link>
          <Link
            href={`/claims?termId=${data.term!.id}&status=PENDING`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            成果申报进度
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent>
        <WorkbenchItems
          items={data.reviewQueue}
          emptyTitle="暂无等待处理的记录"
          emptyDescription="活动参与和成果申报提交后，会在这里显示处理进度。"
        />
      </CardContent>
    </Card>
  );
}
function SubscriberOverview({ data }: { data: AdminData }) {
  const phaseTarget = (period: AdminData["periods"][number]) => ({
    href: period.phase === "CONFIGURATION" ? `/terms/${period.id}?tab=scheme` : `/publication?termId=${period.id}`,
    label:
      period.phase === "CONFIGURATION" ? "配置评分方案" : period.phase === "ACTIVE" ? "准备发布" : "查看发布结果",
  });
  return (
    <Card className="min-w-0">
      <CardHeader className="has-data-[slot=card-action]:grid-cols-1 md:has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto]">
        <CardTitle className="leading-none">各周期发布进度</CardTitle>
        <CardDescription>
          最近 {data.periods.length} 个周期的发布名单和确认人数；当前在籍学生{" "}
          {data.stats.activeStudents} 人，历史发布人数按发布时保存。
        </CardDescription>
        <CardAction className="col-start-1 row-start-auto flex flex-wrap justify-self-start gap-2 md:col-start-2 md:row-start-1 md:justify-self-end">
          <Link href="/terms" className={buttonVariants({ variant: "outline", size: "sm" })}>
            全部周期
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent className="min-w-0 pt-0">
        {data.periods.length ? (
          <>
            <div className="hidden min-w-0 md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>周期 / 评分方案版本</TableHead>
                    <TableHead>阶段</TableHead>
                    <TableHead>活动 / 成果待处理</TableHead>
                    <TableHead>未决异议</TableHead>
                    <TableHead>发布名单 / 已确认</TableHead>
                    <TableHead>核对截止</TableHead>
                    <TableHead>操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.periods.map((period) => (
                    <TableRow key={period.id}>
                      <TableCell>
                        <p className="font-medium">{period.name}</p>
                        <p className="text-xs text-muted-foreground">评分方案版本 {period.revision}</p>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{phaseLabels[period.phase]}</Badge>
                      </TableCell>
                      <TableCell>
                        {period.pendingRecognitions} / {period.pendingClaims}
                      </TableCell>
                      <TableCell>{period.openAppeals}</TableCell>
                      <TableCell>
                        {period.publishedStudents} / {period.confirmedStudents}
                      </TableCell>
                      <TableCell>{period.checkingEndsAt ? dateText(period.checkingEndsAt) : "尚未发布"}</TableCell>
                      <TableCell>
                        <Link className="underline underline-offset-4" href={phaseTarget(period).href}>
                          {phaseTarget(period).label}
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex flex-col divide-y md:hidden">
              {data.periods.map((period) => (
                <div className="flex min-w-0 flex-col gap-3 py-4" key={period.id}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">{period.name}</p>
                    <Badge variant="outline">{phaseLabels[period.phase]}</Badge>
                  </div>
                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-muted-foreground">活动 / 成果待处理</dt>
                      <dd>
                        {period.pendingRecognitions} / {period.pendingClaims}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">未决异议</dt>
                      <dd>{period.openAppeals}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">发布 / 确认人数</dt>
                      <dd>
                        {period.publishedStudents} / {period.confirmedStudents}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">评分方案版本</dt>
                      <dd>{period.revision}</dd>
                    </div>
                  </dl>
                  <p className="text-xs text-muted-foreground">
                    核对截止：{period.checkingEndsAt ? dateText(period.checkingEndsAt) : "尚未发布"}
                  </p>
                  <Link
                    href={phaseTarget(period).href}
                    className={buttonVariants({ variant: "outline", size: "sm", className: "self-start" })}
                  >
                    {phaseTarget(period).label}
                  </Link>
                </div>
              ))}
            </div>
          </>
        ) : (
          <NoData title="尚无测评周期" description="创建周期并配置评分方案后，可以开始成果申报和活动参与。" />
        )}
      </CardContent>
    </Card>
  );
}
