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
  return (
    <div className="@container/main flex min-w-0 flex-col gap-4 md:gap-6">
      <PageHeading
        title="管理工作台"
        description={`${data.user.name}，先处理待审事实与结果异议，再核对发布和结算。`}
        action={
          <Link href="/terms?new=1" className={buttonVariants()}>
            创建测评周期
          </Link>
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
            <CardTitle>优先处理的未决异议</CardTitle>
            <CardDescription>当前周期最早提交的未决异议，最多6条；处理结论与后续更正版本保持关联。</CardDescription>
            <CardAction className="col-start-1 row-start-auto flex flex-wrap justify-self-start gap-2 md:col-start-2 md:row-start-1 md:justify-self-end">
              <Link href={href("/appeals")} className={buttonVariants({ variant: "outline", size: "sm" })}>
                全部异议
              </Link>
            </CardAction>
          </CardHeader>
          <CardContent>
            <WorkbenchItems
              items={data.appeals}
              emptyTitle="当前没有未决异议"
              emptyDescription="学生提出异议后，可在这里跟进处理状态与更正依据。"
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
      title: "待审核活动认定",
      value: data.stats.pendingRecognitions,
      description: "核对参与事实与证明材料",
      href: `/recognitions?termId=${termId}&status=PENDING`,
      icon: ClipboardCheck,
    },
    {
      title: "待审核个人申报",
      value: data.stats.pendingClaims,
      description: "核对申报项目、事实与依据",
      href: `/claims?termId=${termId}&status=PENDING`,
      icon: FileCheck2,
    },
    {
      title: "待确认分值的活动",
      value: data.stats.unconfirmedActivities,
      description: "确认前不能提交参与认定",
      href: `/activities?termId=${termId}`,
      icon: CalendarClock,
    },
    {
      title: "未决结果异议",
      value: data.stats.openAppeals,
      description: "含待处理与处理中的异议",
      href: `/appeals?termId=${termId}`,
      icon: MessageSquareWarning,
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
              进入处理队列
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
        <CardTitle className="leading-none">优先处理的待审队列</CardTitle>
        <CardDescription>
          {data.term!.name} · 方案修订 {data.term!.revision} · 输入修订 {data.term!.inputRevision}
          。待办计数为当前周期全量，以下按提交时间优先展示最早待审记录，最多8条。
        </CardDescription>
        <CardAction className="col-start-1 row-start-auto justify-self-start md:col-start-2 md:row-start-1 md:justify-self-end flex flex-wrap items-center gap-2">
          <Link
            href={`/recognitions?termId=${data.term!.id}&status=PENDING`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            活动认定
          </Link>
          <Link
            href={`/claims?termId=${data.term!.id}&status=PENDING`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            个人申报
          </Link>
          <Link
            href={`/activities?termId=${data.term!.id}`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            活动确认
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent>
        <WorkbenchItems
          items={data.reviewQueue}
          emptyTitle="当前审核队列已清空"
          emptyDescription="新增活动或认定提交后，在这里查看并进入处理。"
        />
      </CardContent>
    </Card>
  );
}
function SubscriberOverview({ data }: { data: AdminData }) {
  return (
    <Card className="min-w-0">
      <CardHeader className="has-data-[slot=card-action]:grid-cols-1 md:has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto]">
        <CardTitle className="leading-none">周期发布与确认概览</CardTitle>
        <CardDescription>
          最近 {data.periods.length} 个周期的实际发布名单及确认人数；当前有效学生 {data.stats.activeStudents}{" "}
          人为全校账号口径，历史发布人数保持冻结。
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
                    <TableHead>周期 / 制度修订</TableHead>
                    <TableHead>阶段</TableHead>
                    <TableHead>活动 / 个人待审</TableHead>
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
                        <p className="text-xs text-muted-foreground">方案修订 {period.revision}</p>
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
                        <Link
                          className="underline underline-offset-4"
                          href={
                            period.phase === "CONFIGURATION"
                              ? `/terms/${period.id}?tab=scheme`
                              : `/publication?termId=${period.id}`
                          }
                        >
                          {period.phase === "CONFIGURATION" ? "配置制度" : "发布与结算"}
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
                      <dt className="text-muted-foreground">待审活动 / 申报</dt>
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
                      <dt className="text-muted-foreground">方案修订</dt>
                      <dd>{period.revision}</dd>
                    </div>
                  </dl>
                  <p className="text-xs text-muted-foreground">
                    核对截止：{period.checkingEndsAt ? dateText(period.checkingEndsAt) : "尚未发布"}
                  </p>
                  <Link
                    href={`/terms/${period.id}`}
                    className={buttonVariants({ variant: "outline", size: "sm", className: "self-start" })}
                  >
                    进入周期
                  </Link>
                </div>
              ))}
            </div>
          </>
        ) : (
          <NoData title="尚无测评周期" description="创建周期并配置完整评分制度后，可以开始申报与认定。" />
        )}
      </CardContent>
    </Card>
  );
}
