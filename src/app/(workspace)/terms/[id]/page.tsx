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
					description="查看本周期评分模块、计分规则和扣分制度。"
					action={
						<Link
							href={returnHref}
							className={buttonVariants({ variant: "outline" })}
						>
							返回周期列表
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
		"PENDING_COUNSELOR",
		"PENDING_COLLEGE",
		"RETURNED",
		"APPROVED",
		"SUPERSEDED",
		"WITHDRAWN",
		"REVOKED",
		"REJECTED",
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
				description="查看周期阶段、评分方案、活动名单和审核记录。"
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
											<CardDescription>当前使用的评分方案</CardDescription>
										</CardHeader>
										<CardContent>
											<p className="text-sm">
												{term.scheme.nodes.length} 个模块 · 第 {term.revision} 版
											</p>
										</CardContent>
									</Card>
									<Card>
										<CardHeader>
											<CardTitle>下一步工作</CardTitle>
											<CardDescription>
												{term.phase === "CONFIGURATION"
													? "完成评分方案并开启申报"
													: term.phase === "ACTIVE"
														? "录入并审核成绩"
														: term.phase === "CHECKING"
															? "学生确认、处理异议并锁定"
															: "查看存档或更正记录"}
											</CardDescription>
										</CardHeader>
										<CardContent>
											<p className="mb-3 text-sm">
												{recognitions.total} 条参与记录 · 成绩第{" "}
												{term.inputRevision} 版
											</p>
											<div className="flex flex-wrap gap-2">
												{[
													{ url: "activities", label: "活动管理" },
													{
														url: "recognitions",
														label: admin ? "活动参与审核" : "参与记录",
													},
													...(user.role !== "PUBLISHER"
														? [
																{ url: "claims", label: "成果申报" },
																{ url: "results", label: "成绩" },
																{ url: "appeals", label: "成绩异议" },
															]
														: []),
													...(admin
														? [
																{ url: "grades", label: "成绩录入" },
																{ url: "deductions", label: "扣分管理" },
																{ url: "publication", label: "结果发布" },
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
						label: "评分方案",
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
