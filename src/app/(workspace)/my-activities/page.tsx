import { redirect } from "next/navigation";
import Link from "next/link";
import { pageSession } from "@/server/page-session";
import { measurementContext } from "@/lib/measurement-context";
import { pageActivities, pageActivityFeed } from "@/server/activities";
import { PageHeading } from "@/components/dashboard/page-heading";
import { TermContext } from "@/components/dashboard/term-context";
import { MeasurementEmpty } from "@/components/dashboard/measurement-empty";
import { ActivityList } from "../activities/_components/activity-list";
import { StudentActivityFeed } from "./_components/student-activity-feed";
import { attachmentLimits } from "@/server/activity-attachments";

type View = "joined" | "feed";

const views: { id: View; label: string; hint: string }[] = [
	{ id: "feed", label: "最新活动", hint: "正在进行、面向你所属范围的活动" },
	{ id: "joined", label: "我参加的活动", hint: "学院已登记你的参与，含审核进度" },
];

// Source: D/analytics/page.tsx (page header + segmented view switch + 12-column content area)
export default async function MyActivitiesPage({
	searchParams,
}: {
	searchParams: Promise<{
		termId?: string;
		view?: string;
		q?: string;
		page?: string;
	}>;
}) {
	const user = await pageSession();
	if (user.role !== "STUDENT") redirect("/activities");
	const p = await searchParams;
	const view: View = p.view === "joined" ? "joined" : "feed";
	const { terms, term } = await measurementContext(user.sessionId, p.termId);
	const page = Math.max(1, Math.min(100000, Math.floor(Number(p.page) || 1)));
	const limits = await attachmentLimits();
	const query = (p.q || "").slice(0, 80);
	const joined = term && view === "joined"
		? await pageActivities(user.sessionId, term.id, query, page)
		: null;
	const feed = term && view === "feed"
		? await pageActivityFeed(user.sessionId, term.id, query, page)
		: null;
	const viewHref = (id: View) =>
		`/my-activities?${new URLSearchParams({
			...(term ? { termId: term.id } : {}),
			view: id,
		})}`;
	return (
		<>
			<PageHeading
				title="活动"
				description="查看正在进行、面向你所属范围的活动，以及学院已登记的参与记录和审核进度；名单由学院登记，不需要自行报名。"
			/>
			<TermContext terms={terms} selected={term?.id} />
			<div className="flex min-w-0 flex-wrap items-center gap-3">
				<nav
					aria-label="活动视图"
					className="inline-flex items-center gap-1 rounded-lg border bg-muted/40 p-0.5"
				>
					{views.map((item) => {
						const active = item.id === view;
						return (
							<Link
								key={item.id}
								href={viewHref(item.id)}
								aria-current={active ? "page" : undefined}
								className={[
									"inline-flex h-7 items-center rounded-md px-3 text-sm transition-colors",
									active
										? "bg-background font-medium text-foreground shadow-xs"
										: "text-muted-foreground hover:text-foreground",
								].join(" ")}
							>
								{item.label}
							</Link>
						);
					})}
				</nav>
				<span className="hidden text-xs text-muted-foreground sm:inline">
					{views.find((item) => item.id === view)?.hint}
				</span>
			</div>
			{term && joined ? (
				<ActivityList
					data={JSON.parse(JSON.stringify(joined))}
					term={JSON.parse(JSON.stringify(term))}
					role={user.role}
					query={query}
					colleges={[]}
					limits={limits}
				/>
			) : term && feed ? (
				<StudentActivityFeed
					data={JSON.parse(JSON.stringify(feed))}
					term={{ id: term.id, name: term.name }}
					query={query}
				/>
			) : (
				<MeasurementEmpty admin={false} />
			)}
		</>
	);
}
