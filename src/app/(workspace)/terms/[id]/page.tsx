import Link from "next/link";
import { notFound } from "next/navigation";
import { pageSession } from "@/server/page-session";
import { listTerms } from "@/server/terms";
import { pageActivities } from "@/server/activities";
import { pageRecognitions } from "@/server/recognitions";
import { schemeSchema } from "@/lib/scoring/types";
import { MeasurementWorkspace } from "@/components/dashboard/measurement-workspace";
import { TermContext } from "@/components/dashboard/term-context";
import { PageHeading } from "@/components/dashboard/page-heading";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
	Card,
	CardHeader,
	CardTitle,
	CardDescription,
	CardContent,
} from "@/components/ui/card";
import { SchemeEditor } from "../_components/scheme-editor";
import { ActivityList } from "../../activities/_components/activity-list";

import { phaseLabels } from "@/lib/business-labels";
export default async function Page({
	params,
	searchParams,
}: {
	params: Promise<{ id: string }>;
	searchParams: Promise<{
		tab?: string;
		q?: string;
		status?: string;
		page?: string;
		publicationId?: string;
		college?: string;
		major?: string;
		className?: string;
		returnTo?: string;
	}>;
}) {
	const user = await pageSession();
	const { id } = await params;
	const p = await searchParams;
	const terms = await listTerms(user.sessionId);
	const found = terms.find((t) => t.id === id);
	if (!found) notFound();
	const term = { ...found, scheme: schemeSchema.parse(found.scheme) };
	const admin = user.role === "ADMIN";
	const returnHref =
		p.returnTo === "/terms" || p.returnTo?.startsWith("/terms?")
			? p.returnTo
			: "/terms";
	if (user.role === "COLLEGE" || user.role === "COUNSELOR")
		return (
			<>
				<PageHeading
					title={term.name}
					description="查阅本周期完整评分模块、计分规则与扣分制度。"
					action={
						<Link
							href={returnHref}
							className={buttonVariants({ variant: "outline" })}
						>
							返回周期名录
						</Link>
					}
				/>
				<TermContext terms={terms} selected={id} />
				<SchemeEditor
					key={`${id}-${term.revision}`}
					term={JSON.parse(JSON.stringify(term))}
					admin={false}
					returnHref={returnHref}
				/>
			</>
		);
	const page = Math.max(1, Math.min(100000, Math.floor(Number(p.page) || 1)));
	const query = (p.q || "").slice(0, 80);
	const status = [
		"PENDING",
		"APPROVED",
		"REJECTED",
		"NEEDS_CHANGES",
		"WITHDRAWN",
		"REVOKED",
	].includes(p.status || "")
		? p.status
		: undefined;
	const [activities, recognitions] = await Promise.all([
		pageActivities(
			user.sessionId,
			id,
			query,
			!p.tab || p.tab === "overview" ? page : 1,
		),
		pageRecognitions(
			user.sessionId,
			id,
			p.tab === "recognitions" ? page : 1,
			status,
		),
	]);

	return (
		<>
			<PageHeading
				title={term.name}
				description="查看周期阶段、制度修订与活动目录，配置完整评分制度。"
				action={
					<Link
						href={returnHref}
						className={buttonVariants({ variant: "outline" })}
					>
						全部周期
					</Link>
				}
			/>
			<TermContext terms={terms} selected={id} />
			<MeasurementWorkspace
				termId={id}
				active={p.tab}
				tabs={[
					{
						id: "overview",
						label: "周期总览",
						content: (
							<>
								<div className="grid gap-4 md:grid-cols-3">
									<Card>
										<CardHeader>
											<CardTitle>当前阶段</CardTitle>
											<CardDescription>{term.name}</CardDescription>
										</CardHeader>
										<CardContent>
											<Badge variant="outline">{phaseLabels[term.phase]}</Badge>
										</CardContent>
									</Card>
									<Card>
										<CardHeader>
											<CardTitle>评分方案</CardTitle>
											<CardDescription>当前生效或配置中的制度</CardDescription>
										</CardHeader>
										<CardContent>
											<p className="text-sm">
												{term.scheme.nodes.length} 个模块 · 修订 {term.revision}
											</p>
										</CardContent>
									</Card>
									<Card>
										<CardHeader>
											<CardTitle>下一步工作</CardTitle>
											<CardDescription>
												{term.phase === "CONFIGURATION"
													? "完成制度并开启申报"
													: term.phase === "ACTIVE"
														? "录入并审核完整成绩"
														: term.phase === "CHECKING"
															? "学生核对、处理异议与结算"
															: "查看历史快照或理由更正"}
											</CardDescription>
										</CardHeader>
										<CardContent>
											<p className="mb-3 text-sm">
												{recognitions.total} 条认定记录 · 周期输入修订{" "}
												{term.inputRevision}
											</p>
											<div className="flex flex-wrap gap-2">
												{[
													{ url: "activities", label: "活动目录" },
													{
														url: "recognitions",
														label: admin ? "活动认定审核" : "认定记录",
													},
													...(user.role !== "PUBLISHER"
														? [
																{ url: "claims", label: "个人申报" },
																{ url: "results", label: "测评结果" },
																{ url: "appeals", label: "结果异议" },
															]
														: []),
													...(admin
														? [
																{ url: "grades", label: "成绩录入" },
																{ url: "deductions", label: "扣分管理" },
																{ url: "publication", label: "发布结算" },
																{ url: "rankings", label: "排名导出" },
															]
														: []),
												].map((item) => (
													<Link
														key={item.url}
														href={`/${item.url}?termId=${id}`}
														className={buttonVariants({
															variant: "outline",
															size: "sm",
														})}
													>
														{item.label}
													</Link>
												))}
											</div>
										</CardContent>
									</Card>
								</div>
								<ActivityList
									data={JSON.parse(JSON.stringify(activities))}
									term={JSON.parse(JSON.stringify(term))}
									role={user.role}
									query={query}
								/>
							</>
						),
					},
					{
						id: "scheme",
						label: "评分制度",
						content: (
							<SchemeEditor
								key={`${id}-${term.revision}`}
								term={JSON.parse(JSON.stringify(term))}
								admin={admin}
								returnHref={returnHref}
							/>
						),
					},
				]}
			/>
		</>
	);
}
