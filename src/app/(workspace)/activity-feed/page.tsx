import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarDays } from "lucide-react";
import { pageSession } from "@/server/page-session";
import { pageActivityFeed } from "@/server/activities";
import { measurementContext } from "@/lib/measurement-context";
import { PageHeading } from "@/components/dashboard/page-heading";
import { TermContext } from "@/components/dashboard/term-context";
import { MeasurementEmpty } from "@/components/dashboard/measurement-empty";
import {
	Card,
	CardHeader,
	CardTitle,
	CardDescription,
	CardAction,
	CardContent,
	CardFooter,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import {
	Empty,
	EmptyHeader,
	EmptyTitle,
	EmptyDescription,
} from "@/components/ui/empty";
import { dateText } from "@/lib/business-labels";
// Source: productivity/page.tsx and projects-section.tsx, preserving 9:3 page and project-card grid.
export default async function ActivityFeedPage({
	searchParams,
}: {
	searchParams: Promise<{ termId?: string; q?: string; page?: string }>;
}) {
	const user = await pageSession();
	if (user.role !== "STUDENT") redirect("/activities");
	const p = await searchParams;
	const { terms, term } = await measurementContext(user.sessionId, p.termId);
	const page = Math.max(1, Math.min(100000, Math.floor(Number(p.page) || 1)));
	const data = term
		? await pageActivityFeed(user.sessionId, term.id, p.q || "", page)
		: null;
	const query = new URLSearchParams({
		termId: term?.id || "",
		q: p.q || "",
		page: String(data?.page || page),
	});
	const href = (number: number) => {
		const next = new URLSearchParams(query);
		next.set("page", String(number));
		return `/activity-feed?${next}`;
	};
	const returnHref = `/activity-feed?${query}`;
	return (
		<>
			<PageHeading
				title="已发布活动"
				description="查看面向你所在学院、专业或班级发布的活动。浏览不代表已参加，参与情况以后台登记和审核结果为准。"
			/>
			<TermContext terms={terms} selected={term?.id} />
			{term && data ? (
				<div className="grid min-w-0 gap-6 lg:grid-cols-12">
					<section className="min-w-0 lg:col-span-9">
						<div className="flex min-w-0 flex-col gap-6">
							<section className="flex min-w-0 flex-col gap-2">
								<div className="flex flex-wrap items-end justify-between gap-4">
									<h2 className="text-xl tracking-tight">
										可参加的活动 · {data.total} 项
									</h2>
									<form
										action="/activity-feed"
										className="flex flex-wrap items-end gap-2"
									>
										<input type="hidden" name="termId" value={term.id} />
										<Field>
											<FieldLabel htmlFor="feed-search">活动名称</FieldLabel>
											<Input
												id="feed-search"
												name="q"
												defaultValue={p.q || ""}
												placeholder="输入活动名称"
											/>
										</Field>
										<Button type="submit" variant="outline">
											搜索
										</Button>
									</form>
								</div>
								<div className="grid min-w-0 gap-4 md:grid-cols-3">
									{data.items.map((activity) => (
										<Card key={activity.id} className="min-w-0 shadow-xs">
											<CardHeader>
												<CardTitle>
													<div className="flex items-center gap-2">
														<CalendarDays className="size-4 shrink-0 text-muted-foreground" />
														<Link
															className="break-words hover:underline"
															href={`/activities/${activity.id}?returnTo=${encodeURIComponent(returnHref)}`}
														>
															{activity.name}
														</Link>
													</div>
												</CardTitle>
												<CardDescription>{activity.organizer}</CardDescription>
												<CardAction>
													<Badge variant="outline">已发布</Badge>
												</CardAction>
											</CardHeader>
											<CardContent>
												<div className="flex flex-col gap-3">
													<p className="line-clamp-4 whitespace-pre-wrap text-sm leading-6">
														{activity.content}
													</p>
													<p className="text-sm">
														{activity.scoreMode === "INDIVIDUAL"
															? `每人单独录分 · 最高 ${activity.points} 分`
															: `统一 ${activity.points} 分`}
													</p>
													<p className="line-clamp-3 whitespace-pre-wrap text-xs text-muted-foreground">
														参加要求：{activity.requirements || "无"}
													</p>
													<p className="text-xs text-muted-foreground">
														{dateText(activity.startsAt)} 至{" "}
														{dateText(activity.endsAt)}
													</p>
												</div>
											</CardContent>
											<CardFooter className="flex flex-wrap items-center justify-between gap-2 py-2.5">
												<span className="text-xs text-muted-foreground">
													发布于{" "}
													{activity.publishedAt
														? dateText(activity.publishedAt)
														: "—"}
												</span>
												<Link
													href={`/activities/${activity.id}?returnTo=${encodeURIComponent(returnHref)}`}
													className={buttonVariants({
														variant: "outline",
														size: "sm",
													})}
												>
													查看活动
												</Link>
											</CardFooter>
										</Card>
									))}
								</div>
								{!data.items.length && (
									<Empty>
										<EmptyHeader>
											<EmptyTitle>暂无活动</EmptyTitle>
											<EmptyDescription>
												当前范围内没有已发布活动。可以换个名称再搜，或到“我参加的活动”查看参与记录。
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
												className={buttonVariants({
													variant: "outline",
													size: "sm",
												})}
												href={href(data.page - 1)}
											>
												上一页
											</Link>
										)}
										{data.page * 20 < data.total && (
											<Link
												className={buttonVariants({
													variant: "outline",
													size: "sm",
												})}
												href={href(data.page + 1)}
											>
												下一页
											</Link>
										)}
									</div>
								</div>
							</section>
						</div>
					</section>
					<section className="flex min-w-0 flex-col gap-6 lg:col-span-3">
						<Card>
							<CardHeader>
								<CardTitle>本人参与记录</CardTitle>
								<CardDescription>{term.name}</CardDescription>
							</CardHeader>
							<CardContent className="flex flex-col gap-4">
								<p className="text-sm leading-6 text-muted-foreground">
									活动符合浏览范围，不代表已经参加。后台登记后，“我参加的活动”会立即展示参与事实；审核通过后才纳入测评。
								</p>
								<Link
									href={`/activities?termId=${term.id}`}
									className={buttonVariants({ variant: "outline" })}
								>
									我参加的活动
								</Link>
								<Link
									href={`/recognitions?termId=${term.id}`}
									className={buttonVariants({ variant: "ghost" })}
								>
									查看本人认定记录
								</Link>
							</CardContent>
						</Card>
					</section>
				</div>
			) : (
				<MeasurementEmpty admin={false} />
			)}
		</>
	);
}
