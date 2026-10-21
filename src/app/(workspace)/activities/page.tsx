import { MeasurementEmpty } from "@/components/dashboard/measurement-empty";
import { pageSession } from "@/server/page-session";
import { measurementContext } from "@/lib/measurement-context";
import { pageActivities } from "@/server/activities";
import { PageHeading } from "@/components/dashboard/page-heading";
import { TermContext } from "@/components/dashboard/term-context";
import { listOrganizations } from "@/server/organizations";
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
	const colleges =
		user.role === "ADMIN" || user.role === "COLLEGE"
			? (await listOrganizations(user.sessionId)).colleges.map((college) => ({
					id: college.id,
					name: college.name,
					code: college.code,
				}))
			: [];
	return (
		<>
			<PageHeading
				title={
					user.role === "STUDENT"
						? "我参加的活动"
						: user.role === "PUBLISHER"
							? "我的活动"
							: "活动管理"
				}
				description={
					user.role === "STUDENT"
						? "查看本人参加了哪些活动、活动得分和审核进度。"
						: user.role === "PUBLISHER"
							? "创建和维护你负责的活动，设置参加范围，确认分值后发布。"
							: "维护活动、参加范围和活动分值，确认后发布。"
				}
			/>
			<TermContext terms={terms} selected={term?.id} />
			{term && result ? (
				<ActivityList
					data={JSON.parse(JSON.stringify(result))}
					term={JSON.parse(JSON.stringify(term))}
					role={user.role}
					query={p.q || ""}
					colleges={colleges}
				/>
			) : (
				<MeasurementEmpty admin={user.role === "ADMIN"} />
			)}
		</>
	);
}
