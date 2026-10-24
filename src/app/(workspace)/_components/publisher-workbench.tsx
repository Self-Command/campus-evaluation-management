import Link from "next/link";
import type { ReactNode } from "react";
import { CalendarDays, ClipboardCheck, FilePenLine, ArrowRight } from "lucide-react";
import type { WorkbenchData } from "@/server/workbench";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardAction,
  CardFooter,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { PageHeading, NoData } from "@/components/dashboard/page-heading";
import { MeasurementEmpty } from "@/components/dashboard/measurement-empty";
import { dateText, phaseLabels } from "@/lib/business-labels";
import { WorkbenchItems } from "./workbench-items";
type PublisherData = Extract<WorkbenchData, { role: "PUBLISHER" }>;
// Editing origin: complete dashboard/productivity/page.tsx (9-column main + 3-column operational sidebar).
export function PublisherWorkbench({ data, context }: { data: PublisherData; context: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-12">
      <section className="min-w-0 lg:col-span-9">
        <div className="flex min-w-0 flex-col gap-6">
          <PageHeading
            title="活动工作台"
            description={`${data.user.name}，维护你负责的活动，跟进参与认定的审核进度。`}
          />
          {context}
          {data.term ? (
            <>
              <SummaryCards data={data} />
              <TasksSection data={data} />
              <ProjectsSection data={data} />
              <QuickActions data={data} />
            </>
          ) : (
            <MeasurementEmpty admin={false} />
          )}
        </div>
      </section>
      {data.term && (
        <section className="flex min-w-0 flex-col gap-6 lg:col-span-3">
          <FocusCard data={data} />
          <RecentNotesCard data={data} />
        </section>
      )}
    </div>
  );
}
function SummaryCards({ data }: { data: PublisherData }) {
  const summaries = [
    { title: "我负责的活动", value: data.stats.activities, description: "本周期全部活动", icon: CalendarDays },
    {
      title: "活动参与待审",
      value: data.stats.pendingRecognitions,
      description: "我负责活动下待审核的参与记录",
      icon: ClipboardCheck,
    },
    {
      title: "待补材料",
      value: data.stats.needsChanges,
      description: "按审核意见补充本人提交的材料",
      icon: FilePenLine,
    },
  ];
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {summaries.map((item) => (
        <Card key={item.title} className="min-w-0 shadow-xs">
          <CardHeader className="has-data-[slot=card-action]:grid-cols-1 md:has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto]">
            <CardTitle>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <div className="grid size-7 place-items-center rounded-lg border bg-muted">
                  <item.icon className="size-4" />
                </div>
                {item.title}
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-2">
              <div className="text-2xl leading-none tracking-tight tabular-nums">{item.value}</div>
              <p className="text-sm text-muted-foreground">{item.description}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
function TasksSection({ data }: { data: PublisherData }) {
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-xl tracking-tight">待补材料</h2>
        <Link
          href={`/recognitions?termId=${data.term!.id}`}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          全部参与记录
        </Link>
      </div>
      <div className="min-w-0 rounded-xl border bg-background px-4 shadow-xs">
        <WorkbenchItems
          items={data.followUps}
          emptyTitle="暂无待补材料"
          emptyDescription="提交活动参与后，可查看审核进度和补充意见。"
        />
      </div>
    </section>
  );
}
function ProjectsSection({ data }: { data: PublisherData }) {
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-xl tracking-tight">近期活动</h2>
        <Link
          href={`/activities?termId=${data.term!.id}`}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          全部我的活动
        </Link>
      </div>
      <div className="grid min-w-0 gap-4 md:grid-cols-3">
        {data.activities.length ? (
          data.activities.map((activity) => (
            <Card key={activity.id} className="min-w-0 shadow-xs">
              <CardHeader className="has-data-[slot=card-action]:grid-cols-1 md:has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto]">
                <CardTitle className="break-words">
                  <Link href={`/activities/${activity.id}`} className="hover:underline">
                    {activity.name}
                  </Link>
                </CardTitle>
                <CardDescription className="break-words">{activity.organizer}</CardDescription>
                <CardAction className="col-start-1 row-start-auto flex flex-wrap justify-self-start gap-2 md:col-start-2 md:row-start-1 md:justify-self-end">
                  <Badge variant="outline">{activity.publishedAt ? "已发布" : "未发布"}</Badge>
                </CardAction>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="text-2xl tabular-nums">
                  {activity.points} <span className="text-sm text-muted-foreground">分</span>
                </div>
                <dl className="grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">参与学生</dt>
                    <dd>{activity.participantCount}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">待审提交</dt>
                    <dd>{activity.pendingCount}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">已通过</dt>
                    <dd>{activity.approvedCount}</dd>
                  </div>
                </dl>
                <p className="text-xs text-muted-foreground">
                  开始：{dateText(activity.startsAt)}
                  <br />
                  结束：{dateText(activity.endsAt)}
                </p>
              </CardContent>
              <CardFooter className="flex flex-wrap justify-between gap-2 py-2.5">
                <Link href={`/activities/${activity.id}`} className="text-sm underline underline-offset-4">
                  查看活动
                </Link>
                {activity.publishedAt && data.term!.phase === "ACTIVE" && (
                  <Link
                    href={`/imports?kind=participation&termId=${data.term!.id}&activityId=${activity.id}`}
                    className="text-sm underline underline-offset-4"
                  >
                    导入名单
                  </Link>
                )}
              </CardFooter>
            </Card>
          ))
        ) : (
          <div className="md:col-span-3">
            <NoData
              title="本周期暂无你负责的活动"
              description={
                data.term!.phase === "ACTIVE"
                  ? "历史发布者只能维护已有活动，不能新建；如需开展活动请联系管理员。"
                  : "当前阶段没有可维护的活动。"
              }
            />
          </div>
        )}
      </div>
    </section>
  );
}
function QuickActions({ data }: { data: PublisherData }) {
  const actions = [
    { label: "维护活动", href: `/activities?termId=${data.term!.id}`, icon: CalendarDays },
    { label: "查看参与记录", href: `/recognitions?termId=${data.term!.id}`, icon: ClipboardCheck },
    { label: "查看评分方案", href: `/terms/${data.term!.id}?tab=scheme`, icon: FilePenLine },
  ];
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xl tracking-tight">活动办理</h2>
      <div className="grid gap-4 sm:grid-cols-3">
        {actions.map((action) => (
          <Link
            key={action.href}
            href={action.href}
            className={buttonVariants({ variant: "outline", className: "justify-start" })}
          >
            <action.icon data-icon="inline-start" />
            {action.label}
          </Link>
        ))}
      </div>
    </section>
  );
}
function FocusCard({ data }: { data: PublisherData }) {
  return (
    <Card className="min-w-0 shadow-xs">
      <CardHeader className="has-data-[slot=card-action]:grid-cols-1 md:has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto]">
        <CardTitle>本周期状态</CardTitle>
        <CardDescription>{data.term!.name}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Badge variant="outline" className="self-start">
          {phaseLabels[data.term!.phase]}
        </Badge>
        <dl className="flex flex-col gap-4 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">未发布活动</dt>
            <dd className="tabular-nums">{data.stats.unpublishedActivities}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">已通过活动参与</dt>
            <dd className="tabular-nums">{data.stats.approvedRecognitions}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">评分方案版本</dt>
            <dd>{data.term!.revision}</dd>
          </div>
        </dl>
        <Link
          href={`/activities?termId=${data.term!.id}`}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          查看我的活动
          <ArrowRight data-icon="inline-end" />
        </Link>
      </CardContent>
    </Card>
  );
}
function RecentNotesCard({ data }: { data: PublisherData }) {
  const upcoming = data.activities.slice(0, 3);
  return (
    <Card className="min-w-0 shadow-xs">
      <CardHeader className="has-data-[slot=card-action]:grid-cols-1 md:has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto]">
        <CardTitle>近期活动</CardTitle>
        <CardDescription>最近 3 项活动的起止时间</CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-4">
        {upcoming.length ? (
          upcoming.map((activity) => (
            <Link key={activity.id} href={`/activities/${activity.id}`} className="flex min-w-0 items-start gap-3">
              <CalendarDays className="size-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="break-words font-medium text-sm">{activity.name}</p>
                <p className="text-xs text-muted-foreground">{dateText(activity.startsAt)}</p>
                <p className="text-xs text-muted-foreground">至 {dateText(activity.endsAt)}</p>
              </div>
            </Link>
          ))
        ) : (
          <NoData title="暂无活动日程" description="可在活动管理中查看全部活动。" />
        )}
      </CardContent>
    </Card>
  );
}
