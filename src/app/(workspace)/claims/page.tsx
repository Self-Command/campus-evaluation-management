import { notFound } from "next/navigation";
import { pageSession } from "@/server/page-session";
import { measurementContext } from "@/lib/measurement-context";
import { PageHeading } from "@/components/dashboard/page-heading";
import { TermContext } from "@/components/dashboard/term-context";
import { MeasurementEmpty } from "@/components/dashboard/measurement-empty";
import { Claims, type Claim } from "./_components/claims";
import { schemeSchema } from "@/lib/scoring/types";
import { pageClaims, claimFilterSchema } from "@/server/claims";

const titles = {
	ADMIN: "成果申报监督",
	COLLEGE: "成果申报审核",
	COUNSELOR: "成果申报审核",
	STUDENT: "成果申报",
} as const;
const descriptions = {
	ADMIN:
		"查看学生申报、辅导员评分和学院审核记录；已通过的申报可按规则撤销。",
	COLLEGE:
		"审核辅导员已评分的申报：通过、退回学生修改，或退回辅导员重新评分。",
	COUNSELOR:
		"核对学生提交的成果和证明，选择计分项并评分，再提交学院审核。",	STUDENT:
		"提交成果、发生日期、说明和证明；辅导员评分、学院审核后可随时查看进度。",
} as const;

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
				...(typeof entry.action === "string" ? { action: entry.action } : {}),
				...(typeof entry.before === "string" ? { before: entry.before } : {}),
				...(typeof entry.after === "string" ? { after: entry.after } : {}),
				...(typeof entry.reason === "string" ? { reason: entry.reason } : {}),
				...(typeof entry.score === "string" ? { score: entry.score } : {}),
			});
		}
	const profile = row.student?.studentProfile;
	return {
		id: row.id,
		revision: row.revision,
		status: row.status,
		title: row.title,
		occurredOn: row.occurredOn,
		note: row.note,
		reviewReason: row.reviewReason,
		createdAt: row.createdAt.toISOString(),
		scoreNodeId: row.scoreNodeId,
		score: row.score?.toFixed() ?? null,
		scorer: row.scorer,
		reviewer: row.reviewer,
		projectName: row.project?.name ?? null,
		student: row.student
			? {
					id: row.student.id,
					name: row.student.name,
					login: row.student.login,
					studentNumber: profile?.studentNumber ?? row.student.login,
					className:
						profile?.schoolClass?.name ?? profile?.className ?? "未分班",
					organization: [
						profile?.schoolClass?.major?.college?.name,
						profile?.schoolClass?.major?.name,
					]
						.filter(Boolean)
						.join(" · "),
				}
			: {
					id: row.studentId,
					name: "学生档案不可用",
					login: "—",
					studentNumber: "—",
					className: "—",
					organization: "",
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
	if (
		user.role !== "ADMIN" &&
		user.role !== "STUDENT" &&
		user.role !== "COUNSELOR" &&
		user.role !== "COLLEGE"
	)
		notFound();
	const role = user.role as keyof typeof titles;
	const p = await searchParams;
	if (p.status && !claimFilterSchema.safeParse(p.status).success) notFound();
	const { terms, term } = await measurementContext(user.sessionId, p.termId);
	const page = Math.max(1, Math.min(100000, Math.floor(Number(p.page) || 1)));
	const claims = term
		? await pageClaims(user.sessionId, term.id, page, p.status)
		: null;
	return (
		<>
			<PageHeading title={titles[role]} description={descriptions[role]} />
			<TermContext terms={terms} selected={term?.id} />
			{term ? (
				<Claims
					key={`${term.id}-${p.page || 1}-${p.status || ""}`}
					term={{
						id: term.id,
						phase: term.phase,
						disposition: term.disposition,
						revision: term.revision,
						scheme: schemeSchema.parse(term.scheme),
					}}
					role={role}
					page={page}
					status={p.status || ""}
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
