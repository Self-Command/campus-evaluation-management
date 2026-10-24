import Link from "next/link";
import { CalendarDays, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
} from "@/components/ui/input-group";
import {
	Empty,
	EmptyHeader,
	EmptyTitle,
	EmptyDescription,
} from "@/components/ui/empty";
import { dateText } from "@/lib/business-labels";

export interface FeedActivity {
	id: string;
	name: string;
	organizer: string;
	contentText: string;
	points: string;
	startsAt: string;
	endsAt: string;
	publishedAt: string | null;
	college?: { id: string; name: string } | null;
}

// Source: D/productivity/_components/projects-section.tsx (card grid with header meta, body, footer action)
export function StudentActivityFeed({
	data,
	term,
	query,
}: {
	data: { items: FeedActivity[]; total: number; page: number };
	term: { id: string; name: string };
	query: string;
}) {
	const href = (number: number) => {
		const next = new URLSearchParams({
			termId: term.id,
			view: "feed",
			q: query,
			page: String(number),
		});
		return `/my-activities?${next}`;
	};
	const returnHref = `/my-activities?${new URLSearchParams({
		termId: term.id,
		view: "feed",
		q: query,
		page: String(data.page),
	})}`;
	return (
		<div className="grid min-w-0 gap-6 lg:grid-cols-12">
			<section className="flex min-w-0 flex-col gap-4 lg:col-span-9">
				<div className="flex flex-wrap items-center justify-between gap-4">
					<h2 className="text-xl tracking-tight">
						最新活动 · {data.total} 项
					</h2>
					<form action="/my-activities" className="flex w-full gap-2 sm:w-auto">
						<input type="hidden" name="termId" value={term.id} />
						<input type="hidden" name="view" value="feed" />
						<InputGroup className="min-w-0 flex-1 sm:w-64">
							<InputGroupAddon align="inline-start">
								<Search />
							</InputGroupAddon>
							<InputGroupInput
								name="q"
								placeholder="搜索活动名称或主办方"
								aria-label="搜索活动名称或主办方"
								defaultValue={query}
							/>
						</InputGroup>
						<Button type="submit" variant="outline">
							搜索
						</Button>
					</form>
				</div>
				<div className="grid min-w-0 gap-4 sm:grid-cols-2">
					{data.items.map((activity) => (
						<div
							key={activity.id}
							className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 shadow-xs"
						>
							<div className="flex items-start justify-between gap-2">
								<Link
									className="flex min-w-0 items-start gap-2 font-medium hover:underline"
									href={`/activities/${activity.id}?returnTo=${encodeURIComponent(returnHref)}`}
								>
									<CalendarDays className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
									<span className="break-words">{activity.name}</span>
								</Link>
								<Badge variant="outline" className="shrink-0">
									已发布
								</Badge>
							</div>
							<p className="text-xs text-muted-foreground">
								{activity.college?.name || activity.organizer}
							</p>
							<p className="line-clamp-3 text-sm leading-6">
								{activity.contentText}
							</p>
							<div className="mt-auto flex flex-col gap-1 text-xs text-muted-foreground">
								<p>
									{activity.points} 分 ·{" "}
									{dateText(activity.startsAt)} 至 {dateText(activity.endsAt)}
								</p>
							</div>
							<div className="flex items-center justify-between border-t pt-3">
								<span className="text-xs text-muted-foreground">
									发布于{" "}
									{activity.publishedAt
										? dateText(activity.publishedAt)
										: "—"}
								</span>
								<Link
									href={`/activities/${activity.id}?returnTo=${encodeURIComponent(returnHref)}`}
									className={buttonVariants({ variant: "outline", size: "sm" })}
								>
									查看活动
								</Link>
							</div>
						</div>
					))}
				</div>
				{!data.items.length && (
					<Empty>
						<EmptyHeader>
							<EmptyTitle>当前没有正在进行的活动</EmptyTitle>
							<EmptyDescription>
								学院发布面向你所在学院或班级的活动后会显示在这里；活动结束后不再出现在本列表，可在“我参加的活动”查看参与记录。
							</EmptyDescription>
						</EmptyHeader>
					</Empty>
				)}
				<div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
					<p className="text-sm text-muted-foreground">
						共 {data.total} 项 · 第 {data.page} 页
					</p>
					<div className="flex gap-2">
						{data.page > 1 && (
							<Link
								className={buttonVariants({ variant: "outline", size: "sm" })}
								href={href(data.page - 1)}
							>
								上一页
							</Link>
						)}
						{data.page * 20 < data.total && (
							<Link
								className={buttonVariants({ variant: "outline", size: "sm" })}
								href={href(data.page + 1)}
							>
								下一页
							</Link>
						)}
					</div>
				</div>
			</section>
			<section className="flex min-w-0 flex-col gap-4 lg:col-span-3">
				<div className="rounded-xl border bg-card p-4 shadow-xs">
					<h2 className="text-base font-medium">活动怎么参加</h2>
					<p className="mt-2 text-sm leading-6 text-muted-foreground">
						活动面向你所属范围时就能看到，但不需要自行报名。学院统一登记名单后，活动会出现在“我参加的活动”，辅导员和学院审核通过才计入测评。
					</p>
					<div className="mt-4 flex flex-col gap-2">
						<Link
							href={`/my-activities?${new URLSearchParams({ termId: term.id, view: "joined" })}`}
							className={buttonVariants({ variant: "outline" })}
						>
							我参加的活动
						</Link>
						<p className="text-xs text-muted-foreground">当前周期：{term.name}</p>
					</div>
				</div>
			</section>
		</div>
	);
}
