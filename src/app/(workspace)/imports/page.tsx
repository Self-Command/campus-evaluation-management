import { notFound } from "next/navigation";
import { pageSession } from "@/server/page-session";
import { listTerms } from "@/server/terms";
import { getActivity } from "@/server/activities";
import { PageHeading, NoData } from "@/components/dashboard/page-heading";
import { ImportWizard } from "./_components/import-wizard";
export default async function ImportsPage({
	searchParams,
}: {
	searchParams: Promise<{
		kind?: string;
		termId?: string;
		activityId?: string;
	}>;
}) {
	const user = await pageSession();
	const p = await searchParams;
	const kind =
		p.kind === "grades"
			? "grades"
			: p.kind === "participation"
				? "participation"
				: "accounts";
	if (
		user.role === "STUDENT" ||
		(user.role === "PUBLISHER" && kind !== "participation")
	)
		notFound();
	const term = p.termId
		? (await listTerms(user.sessionId)).find((t) => t.id === p.termId)
		: undefined;
	let activity = null;
	if (kind === "participation" && p.activityId) {
		try {
			activity = await getActivity(user.sessionId, p.activityId);
		} catch {
			notFound();
		}
		if (activity.termId !== term?.id || activity.ownerId !== user.id)
			notFound();
	}
	return (
		<>
			<PageHeading
				title={
					{
						accounts: "导入学生账号",
						grades: "导入成绩",
						participation: "导入参与名单",
					}[kind]
				}
				description="下载版本化模板，核对列映射与差异后，整批确认写入。"
			/>
			{kind !== "accounts" &&
			(!term ||
				term.phase !== "ACTIVE" ||
				term.disposition !== "NORMAL" ||
				(kind === "participation" && !activity?.confirmed)) ? (
				<NoData
					title="导入上下文无效"
					description="请从申报与审核阶段的成绩页，或已确认分值的活动详情进入导入。"
				/>
			) : (
				<ImportWizard
					kind={kind}
					term={term ? JSON.parse(JSON.stringify(term)) : undefined}
					activityId={activity?.id}
				/>
			)}
		</>
	);
}
