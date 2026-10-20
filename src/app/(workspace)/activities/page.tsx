import { MeasurementEmpty } from "@/components/dashboard/measurement-empty";
import { pageSession } from "@/server/page-session";
import { measurementContext } from "@/lib/measurement-context";
import { pageActivities } from "@/server/activities";
import { PageHeading } from "@/components/dashboard/page-heading";
import { TermContext } from "@/components/dashboard/term-context";
import { ActivityList } from "./_components/activity-list";
export default async function ActivitiesPage({
	searchParams,
}: {
	searchParams: Promise<{ termId?: string; page?: string; q?: string }>;
}) {
	const user = await pageSession();
	const p = await searchParams;
	const { terms, term } = await measurementContext(user.sessionId, p.termId);
	const page = Math.max(1, Math.min(100000, Math.floor(Number(p.page) || 1)));
	const result = term
		? await pageActivities(user.sessionId, term.id, p.q || "", page)
		: null;
	return (
		<>
			<PageHeading
				title={
					user.role === "STUDENT"
						? "我参加的活动"
						: user.role === "PUBLISHER"
							? "我的活动"
							: "活动目录"
				}
				description={
					user.role === "STUDENT"
						? "查看后台已登记的本人参与事实、录分与审核状态。登记参加与审核计分分别记录。"
						: "维护活动草稿、发布范围和本人活动参与名单，确认分值后独立发布。"
				}
			/>
			<TermContext terms={terms} selected={term?.id} />
			{term && result ? (
				<ActivityList
					data={JSON.parse(JSON.stringify(result))}
					term={JSON.parse(JSON.stringify(term))}
					role={user.role}
					query={p.q || ""}
				/>
			) : (
				<MeasurementEmpty admin={user.role === "ADMIN"} />
			)}
		</>
	);
}
