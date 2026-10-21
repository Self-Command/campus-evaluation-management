import { notFound } from "next/navigation";
import Link from "next/link";
import { pageSession } from "@/server/page-session";
import { measurementContext } from "@/lib/measurement-context";
import { getActivity, pageActivities } from "@/server/activities";
import { PageHeading, NoData } from "@/components/dashboard/page-heading";
import { dateText } from "@/lib/business-labels";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
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
	const canImportParticipation =
		user.role === "ADMIN" ||
		user.role === "COLLEGE" ||
		user.role === "PUBLISHER";
	if (
		(kind === "participation" && !canImportParticipation) ||
		(kind === "grades" && user.role !== "ADMIN" && user.role !== "COUNSELOR") ||
		(kind === "accounts" && user.role !== "ADMIN")
	)
		notFound();
	const { term } = await measurementContext(user.sessionId, p.termId);
	let activity = null;
	if (kind === "participation" && p.activityId) {
		try {
			activity = await getActivity(user.sessionId, p.activityId);
		} catch {
			notFound();
		}
		if (
			activity.termId !== term?.id ||
			!activity.canManage ||
			!activity.confirmed
		)
			notFound();
	}
	const participationReady =
		kind !== "participation" ||
		(!!term && term.phase === "ACTIVE" && term.disposition === "NORMAL");
	let importable: Awaited<ReturnType<typeof pageActivities>>["items"] = [];
	if (kind === "participation" && !p.activityId && participationReady && term) {
		const directory = await pageActivities(user.sessionId, term.id, "", 1);
		importable = directory.items.filter(
			(item) => item.canManage && item.confirmed,
		);
	}
	const hasActiveEvidence =
		kind === "participation" &&
		!!activity?.evidence?.some((row) => row.active);
	return (
		<>
			<PageHeading
				title={
					{
						accounts: "导入学生账号",
						grades: "导入成绩",
						participation: activity
							? activity.rosterCommitted
								? "补录更正参与名单"
								: "提交正式参与名单"
							: "参与名单导入",
					}[kind]
				}
				description={
					kind === "participation"
						? activity
							? activity.rosterCommitted
								? "正式名单已保存。补录只能新增或更正，不能删除；请填写更正原因并说明差异。"
								: "按完整字段整批提交；第一份名单保存后，后续变动走补录更正。"
							: "选择一个你可以维护、且已确认分值的活动。"
						: "下载模板，核对列和数据后整批导入。"
				}
				action={
					kind === "participation" ? (
						<Link
							href="/activities"
							className={buttonVariants({ variant: "outline", size: "sm" })}
						>
							返回活动
						</Link>
					) : undefined
				}
			/>
			{kind !== "accounts" && !participationReady ? (
				<NoData
					title="无法开始导入"
					description="请从成绩页，或从已确认分值的活动详情进入导入。"
				/>
			) : kind === "participation" && !activity ? (
				<Card>
					<CardHeader>
						<CardTitle>选择活动</CardTitle>
						<CardDescription>
							{term
								? `${term.name} · 仅列出你可以维护且已确认分值的活动。`
								: "当前没有可用的测评周期。"}
						</CardDescription>
					</CardHeader>
					<CardContent>
						{importable.length ? (
							<div className="grid gap-3 md:grid-cols-2">
								{importable.map((item) => (
									<div
										key={item.id}
										className="flex flex-col gap-3 rounded-lg border p-4"
									>
										<div className="flex items-start justify-between gap-3">
											<div className="min-w-0">
												<p className="font-medium">{item.name}</p>
												<p className="mt-1 text-xs text-muted-foreground">
													{item.organizer} · {item.college?.name || "未设置"} ·{" "}
													{dateText(item.startsAt)}
												</p>
											</div>
											<Badge variant="outline">
												{item.scoreMode === "INDIVIDUAL"
													? "逐人分"
													: `固定 ${item.points} 分`}
											</Badge>
										</div>
										<div className="flex flex-wrap items-center justify-between gap-2">
											<span className="text-xs text-muted-foreground">
												{item.rosterCommitted
													? "名单已保存，仅可补录"
													: "尚未提交正式名单"}
											</span>
											<Link
												href={`/imports?kind=participation&termId=${term!.id}&activityId=${item.id}`}
												className={buttonVariants({ size: "sm" })}
											>
												{item.rosterCommitted ? "补录更正" : "提交名单"}
											</Link>
										</div>
									</div>
								))}
							</div>
						) : (
							<NoData
								title="暂无可导入名单的活动"
								description="活动须由你维护且分值已确认。请先在活动管理中创建或核对活动。"
							/>
						)}
					</CardContent>
				</Card>
			) : activity ? (
				<ImportWizard
					key={activity.id}
					kind={kind}
					term={term ? JSON.parse(JSON.stringify(term)) : undefined}
					activityId={activity.id}
					activityName={activity.name}
					rosterCommitted={!!activity.rosterCommitted}
					hasActiveEvidence={hasActiveEvidence}
					scoreMode={activity.scoreMode}
					points={activity.points}
				/>
			) : (
				<NoData
					title="无法开始导入"
					description="请从活动管理选择你负责且已确认分值的活动。"
				/>
			)}
		</>
	);
}
