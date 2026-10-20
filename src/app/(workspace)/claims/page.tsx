import { notFound } from "next/navigation";
import { pageSession } from "@/server/page-session";
import { measurementContext } from "@/lib/measurement-context";
import { PageHeading } from "@/components/dashboard/page-heading";
import { TermContext } from "@/components/dashboard/term-context";
import { MeasurementEmpty } from "@/components/dashboard/measurement-empty";
import { Claims, type Claim, type Project } from "./_components/claims";
import { schemeSchema } from "@/lib/scoring/types";
import { listProjects, pageClaims, reviewStatusSchema } from "@/server/claims";

function projectView(
	project: Awaited<ReturnType<typeof listProjects>>[number],
): Project {
	return {
		id: project.id,
		revision: project.revision,
		name: project.name,
		description: project.description,
		nodeId: project.nodeId,
		points: project.points.toFixed(),
		enabled: project.enabled,
	};
}

function claimView(
	row: Awaited<ReturnType<typeof pageClaims>>["items"][number],
): Claim {
	const history: NonNullable<Claim["history"]> = [];
	if (Array.isArray(row.history))
		for (const entry of row.history) {
			if (
				!entry ||
				typeof entry !== "object" ||
				Array.isArray(entry) ||
				typeof entry.at !== "string"
			)
				continue;
			history.push({
				at: entry.at,
				...(typeof entry.id === "string" ? { id: entry.id } : {}),
				...(typeof entry.action === "string" ? { action: entry.action } : {}),
				...(typeof entry.after === "string" ? { after: entry.after } : {}),
				...(typeof entry.reason === "string" ? { reason: entry.reason } : {}),
			});
		}
	return {
		id: row.id,
		revision: row.revision,
		status: row.status,
		activityId: row.activityId,
		factKey: row.factKey,
		occurredOn: row.occurredOn,
		note: row.note,
		reviewReason: row.reviewReason,
		createdAt: row.createdAt.toISOString(),
		project: projectView(row.project),
		student: row.student ?? {
			id: row.studentId,
			name: "学生档案不可用",
			login: "—",
		},
		evidence: row.evidence,
		history,
	};
}
export default async function Page({
	searchParams,
}: {
	searchParams: Promise<{ termId?: string; page?: string; status?: string }>;
}) {
	const user = await pageSession();
	if (user.role === "PUBLISHER") notFound();
	const p = await searchParams;
	if (p.status && !reviewStatusSchema.safeParse(p.status).success) notFound();
	const { terms, term } = await measurementContext(user.sessionId, p.termId);
	const page = Math.max(1, Math.min(100000, Math.floor(Number(p.page) || 1)));
	const [projects, claims] = term
		? await Promise.all([
				listProjects(user.sessionId, term.id),
				pageClaims(user.sessionId, term.id, page, p.status),
			])
		: [[], null];
	return (
		<>
			<PageHeading
				title={user.role === "ADMIN" ? "个人申报审核" : "个人申报"}
				description={
					user.role === "ADMIN"
						? "配置可申报项目，审核学生事实、证明材料与处理历史。"
						: "选择认定项目，填写本人取得的成果与证明材料，提交后跟进审核。"
				}
			/>
			<TermContext terms={terms} selected={term?.id} />
			{term ? (
				<Claims
					key={`${term.id}-${p.page || 1}-${p.status || ""}`}
					term={{
						id: term.id,
						phase: term.phase,
						revision: term.revision,
						scheme: schemeSchema.parse(term.scheme),
					}}
					role={user.role}
					page={page}
					status={p.status || ""}
					initialProjects={projects.map(projectView)}
					initialClaims={
						claims
							? {
									items: claims.items.map(claimView),
									total: claims.total,
									page: claims.page,
								}
							: { items: [], total: 0, page }
					}
				/>
			) : (
				<MeasurementEmpty admin={user.role === "ADMIN"} />
			)}
		</>
	);
}
