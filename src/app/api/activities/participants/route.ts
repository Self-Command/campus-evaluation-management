import { z } from "zod";
import { authenticatedApi } from "@/server/route-handler";
import { pageActivityParticipants } from "@/server/activity-participants";

export async function GET(request: Request) {
	return authenticatedApi(
		request,
		["ADMIN", "PUBLISHER", "COLLEGE", "COUNSELOR"],
		(sessionId) => {
			const query = new URL(request.url).searchParams;
			return pageActivityParticipants(
				sessionId,
				z.string().min(1).parse(query.get("termId")),
				z.string().min(1).parse(query.get("activityId")),
				z.coerce
					.number()
					.int()
					.min(1)
					.max(100000)
					.parse(query.get("page") ?? 1),
				(query.get("q") ?? "").slice(0, 80),
				{
					status: query.get("status") || undefined,
					removed: query.get("removed") || undefined,
				},
			);
		},
	);
}
