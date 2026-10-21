import { MeasurementEmpty } from "@/components/dashboard/measurement-empty";
import { pageSession } from "@/server/page-session";
import { measurementContext } from "@/lib/measurement-context";
import { pageRecognitions } from "@/server/recognitions";
import { PageHeading } from "@/components/dashboard/page-heading";
import { TermContext } from "@/components/dashboard/term-context";
import { Recognitions } from "./_components/recognitions";
export default async function RecognitionsPage({
	searchParams,
}: {
	searchParams: Promise<{
		termId?: string;
		page?: string;
		status?: string;
		tab?: string;
	}>;
}) {
	const user = await pageSession();
	const p = await searchParams;
	const { terms, term } = await measurementContext(user.sessionId, p.termId);
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
	const data = term
		? await pageRecognitions(
				user.sessionId,
				term.id,
				Math.max(1, Math.min(100000, Number(p.page) || 1)),
				status,
			)
		: null;
	return (
		<>
			<PageHeading
				title={user.role === "ADMIN" ? "活动认定审核" : "活动认定"}
				description="核对参与事实、证明材料及审核意见，同一活动的有效事实只计分一次。"
			/>
			<TermContext terms={terms} selected={term?.id} />
			{term && data ? (
				<Recognitions
					key={`${term.id}-${p.page || 1}-${status || ""}`}
					data={JSON.parse(JSON.stringify(data))}
					term={{
						id: term.id,
						phase: term.phase,
						disposition: term.disposition,
					}}
					role={user.role}
					userId={user.id}
					status={status || ""}
				/>
			) : (
				<MeasurementEmpty admin={user.role === "ADMIN"} />
			)}
		</>
	);
}
