import { MeasurementEmpty } from "@/components/dashboard/measurement-empty";
import { pageSession } from "@/server/page-session";
import { measurementContext } from "@/lib/measurement-context";
import { pageRecognitions } from "@/server/recognitions";
import { PageHeading } from "@/components/dashboard/page-heading";
import { TermContext } from "@/components/dashboard/term-context";
import { Recognitions } from "./_components/recognitions";
const filterableStatuses = [
	"PENDING",
	"PENDING_COUNSELOR",
	"PENDING_COLLEGE",
	"RETURNED",
	"APPROVED",
	"SUPERSEDED",
	"WITHDRAWN",
	"REVOKED",
	"REJECTED",
];
export default async function RecognitionsPage({
	searchParams,
}: {
	searchParams: Promise<{
		termId?: string;
		page?: string;
		status?: string;
		q?: string;
		tab?: string;
	}>;
}) {
	const user = await pageSession();
	const p = await searchParams;
	const { terms, term } = await measurementContext(user.sessionId, p.termId);
	const status = filterableStatuses.includes(p.status || "")
		? p.status
		: undefined;
	const query = (p.q || "").slice(0, 80);
	const data = term
		? await pageRecognitions(
				user.sessionId,
				term.id,
				Math.max(1, Math.min(100000, Number(p.page) || 1)),
				status,
				query,
			)
		: null;
	return (
		<>
			<PageHeading
				title={
					user.role === "ADMIN"
						? "活动参与审核"
						: user.role === "STUDENT"
							? "我的活动参与"
							: user.role === "PUBLISHER"
								? "活动参与"
								: "活动参与审核"
				}
				description={
					user.role === "STUDENT"
						? "查看本人活动参与、活动得分和审核结果。"
						: user.role === "COUNSELOR"
							? "核对学生的参与记录、活动得分和证明，通过后交学院审核。"
							: user.role === "COLLEGE"
								? "审核本学院学生的活动参与；活动主办学院只维护活动，不能审核其他学院学生。"
								: user.role === "ADMIN"
									? "查看活动参与记录、活动得分、证明和两级审核结果。"
									: "查看你负责活动的参与记录、得分和审核进度。"
				}
			/>
			<TermContext terms={terms} selected={term?.id} />
			{term && data ? (
				<Recognitions
					key={`${term.id}-${p.page || 1}-${status || ""}-${query}`}
					data={JSON.parse(JSON.stringify(data))}
					term={{
						id: term.id,
						phase: term.phase,
						disposition: term.disposition,
					}}
					role={user.role}
					status={status || ""}
					query={query}
				/>
			) : (
				<MeasurementEmpty admin={user.role === "ADMIN"} />
			)}
		</>
	);
}
