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
import { AccountImportHistory } from "./_components/account-import-history";

export default async function ImportsPage({
	searchParams,
}: {
	searchParams: Promise<{
		kind?: string;
		termId?: string;
		activityId?: string;
		view?: string;
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
	const accountView = kind === "accounts" && p.view === "history" ? "history" : "import";
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
			!activity.publishedAt
		)
			notFound();
	}
	const termReady = !!term && term.phase === "ACTIVE" && term.disposition === "NORMAL";
	const participationReady = kind !== "participation" || termReady;
	let importable: Awaited<ReturnType<typeof pageActivities>>["items"] = [];
	if (kind === "participation" && !p.activityId && participationReady && term) {
		const directory = await pageActivities(user.sessionId, term.id, "", 1);
		importable = directory.items.filter(
			(item) => item.canManage && item.publishedAt,
		);
	}
	const hasActiveEvidence =
		kind === "participation" &&
		!!activity?.evidence?.some((row) => row.active);
	const kinds = [
		...(user.role === "ADMIN"
			? [{ kind: "accounts", label: "账号" }]
			: []),
		...(user.role === "ADMIN" || user.role === "COUNSELOR"
			? [{ kind: "grades", label: "成绩" }]
			: []),
		...(canImportParticipation
			? [{ kind: "participation", label: "参与名单" }]
			: []),
	];
	const kindHref = (value: string) => {
		const query = new URLSearchParams({ kind: value });
		if (p.termId) query.set("termId", p.termId);
		return `/imports?${query.toString()}`;
	};
	return (
		<>
			<PageHeading
				title={
					{
						accounts:
							accountView === "history" ? "账号导入记录" : "导入账号",
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
							: "选择一个你可以维护、且已发布的活动。"
						: kind === "accounts"
							? accountView === "history"
								? "查看已提交的账号导入批次，核对每行结果；没有业务记录的批次可以整批撤销。"
								: "选择本批导入角色，下载对应模板并核对列和数据后整批导入。"
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
					) : kind === "accounts" ? (
						<Link
							href={
								accountView === "history"
									? "/imports?kind=accounts"
									: "/imports?kind=accounts&view=history"
							}
							className={buttonVariants({ variant: "outline", size: "sm" })}
						>
							{accountView === "history" ? "返回导入" : "导入记录"}
						</Link>
					) : undefined
				}
			/>
			{kinds.length > 1 && (
				<nav aria-label="导入类型" className="flex flex-wrap gap-2">
					{kinds.map((item) => (
						<Link
							key={item.kind}
							href={kindHref(item.kind)}
							aria-current={kind === item.kind ? "page" : undefined}
							className={buttonVariants({
								variant: kind === item.kind ? "default" : "outline",
								size: "sm",
							})}
						>
							{item.label}
						</Link>
					))}
				</nav>
			)}
			{kind === "accounts" ? (
				accountView === "history" ? (
					<AccountImportHistory />
				) : (
					<ImportWizard key="accounts" kind="accounts" />
				)
			) : kind === "grades" ? (
				termReady && term ? (
					<ImportWizard
						key={`grades-${term.id}`}
						kind="grades"
						term={JSON.parse(JSON.stringify(term))}
					/>
				) : (
					<NoData
						title="无法导入成绩"
						description={
							term
								? "成绩只能在测评周期的录入阶段导入。请从成绩页确认当前周期状态后再试。"
								: "当前没有可用的测评周期，请先在周期管理中创建并启用。"
						}
					/>
				)
			) : !participationReady ? (
				<NoData
					title="无法开始导入"
					description={
						term
							? "参与名单只能在测评周期的录入阶段维护。请从活动管理确认当前周期状态。"
							: "当前没有可用的测评周期，请先在周期管理中创建并启用。"
					}
				/>
			) : !activity ? (
				<Card>
					<CardHeader>
						<CardTitle>选择活动</CardTitle>
						<CardDescription>
							{term
								? `${term.name} · 仅列出你可以维护且已发布的活动。`
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
												{item.points} 分
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
								description="活动须由你维护且已发布。请先在活动管理中创建并发布活动。"
							/>
						)}
					</CardContent>
				</Card>
			) : (
				<ImportWizard
					key={activity.id}
					kind="participation"
					term={term ? JSON.parse(JSON.stringify(term)) : undefined}
					activityId={activity.id}
					activityName={activity.name}
					rosterCommitted={!!activity.rosterCommitted}
					hasActiveEvidence={hasActiveEvidence}
					points={activity.points}
				/>
			)}
		</>
	);
}
