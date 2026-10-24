import { MeasurementEmpty } from "@/components/dashboard/measurement-empty";
import { redirect } from "next/navigation";
import { pageSession } from "@/server/page-session";
import { measurementContext } from "@/lib/measurement-context";
import { pageActivities } from "@/server/activities";
import { PageHeading } from "@/components/dashboard/page-heading";
import { TermContext } from "@/components/dashboard/term-context";
import { listOrganizations } from "@/server/organizations";
import { ActivityList } from "./_components/activity-list";
import { attachmentLimits } from "@/server/activity-attachments";
export default async function ActivitiesPage({
	searchParams,
}: {
	searchParams: Promise<{ termId?: string; page?: string; q?: string }>;
}) {
	const user = await pageSession();
	const p = await searchParams;
	if (user.role === "STUDENT") {
		const query = new URLSearchParams({
			...(p.termId ? { termId: p.termId } : {}),
			...(p.q ? { q: p.q } : {}),
			...(p.page ? { page: p.page } : {}),
		}).toString();
		redirect(query ? `/my-activities?${query}` : "/my-activities");
	}
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
	const limits = await attachmentLimits();
	const copy =
		user.role === "PUBLISHER"
			? {
					title: "我的活动",
					description: "创建和维护你负责的活动，设置参加范围，发布后学生即可看到。",
				}
			: user.role === "COLLEGE"
				? {
						title: "本院活动",
						description:
							term?.phase === "ACTIVE"
								? "创建并维护本院主办的活动，设置参加范围；其他学院的活动只能查看本院学生的参与情况。"
								: "查看本院主办活动的参加范围和分值；当前阶段不能新建或修改，其他学院活动仅可查看本院学生参与情况。",
					}
				: user.role === "COUNSELOR"
					? {
							title: "本院活动",
							description:
								"查看本院活动；进入活动详情可核对负责班级学生的参与情况。活动由主办学院维护。",
						}
					: {
							title: "活动管理",
							description:
								term?.phase === "ACTIVE"
									? "维护活动、参加范围和分值；发布后学生即可看到。"
									: "查看全部活动、参加范围和分值；当前阶段不能新建或修改活动。",
						};
	return (
		<>
			<PageHeading title={copy.title} description={copy.description} />
			<TermContext terms={terms} selected={term?.id} />
			{term && result ? (
				<ActivityList
					data={JSON.parse(JSON.stringify(result))}
					term={JSON.parse(JSON.stringify(term))}
					role={user.role}
					query={p.q || ""}
					colleges={colleges}
					limits={limits}
				/>
			) : (
				<MeasurementEmpty admin={user.role === "ADMIN"} />
			)}
		</>
	);
}
