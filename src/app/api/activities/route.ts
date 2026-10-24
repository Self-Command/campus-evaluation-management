import { z } from "zod";
import { authenticatedApi } from "@/server/route-handler";
import {
	pageActivities,
	pageActivityFeed,
	saveActivity,
	publishActivity,
	endActivity,
	reassignActivity,
} from "@/server/activities";
import {
	pageRecognitions,
	reviewParticipation,
	changeParticipation,
} from "@/server/recognitions";
import { saveActivityEvidence } from "@/server/activity-evidence";
import { AccountError } from "@/server/accounts";

const reviewActions = [
	"counselorApprove",
	"counselorReturn",
	"collegeApprove",
	"collegeReturn",
	"revoke",
] as const;
const changeActions = ["resubmit", "remove"] as const;
const actionSchema = z.enum([
	"save",
	"reassign",
	"publish",
	"unpublish",
	"end",
	"reopen",
	"evidence",
	...reviewActions,
	...changeActions,
]);

export async function GET(request: Request) {
	return authenticatedApi(
		request,
		["ADMIN", "PUBLISHER", "COLLEGE", "COUNSELOR", "STUDENT"],
		(sessionId) => {
			const query = new URL(request.url).searchParams;
			const termId = z.string().min(1).max(100).parse(query.get("termId"));
			const page = z.coerce
				.number()
				.int()
				.min(1)
				.max(100000)
				.parse(query.get("page") ?? 1);
			const search = (query.get("q") ?? "").slice(0, 80);
			return query.get("view") === "reviews"
				? pageRecognitions(
						sessionId,
						termId,
						page,
						query.get("status") || undefined,
						search,
					)
				: query.get("view") === "feed"
					? pageActivityFeed(sessionId, termId, search, page)
					: pageActivities(sessionId, termId, search, page);
		},
	);
}

export async function POST(request: Request) {
	return authenticatedApi(
		request,
		["ADMIN", "PUBLISHER", "COLLEGE", "COUNSELOR"],
		async (sessionId) => {
			const body = await request.json();
			const { termId, action } = z
				.object({
					termId: z.string().min(1).max(100),
					action: actionSchema,
				})
				.parse(body);
			const { termId: _termId, action: _action, ...payload } = body;
			void _termId;
			void _action;
			if (action === "save") return saveActivity(sessionId, termId, payload);
			if (action === "reassign")
				return reassignActivity(sessionId, termId, payload);
			if (action === "publish" || action === "unpublish")
				return publishActivity(sessionId, termId, { ...payload, action });
			if (action === "end" || action === "reopen")
				return endActivity(sessionId, termId, { ...payload, action });
			if (action === "evidence")
				return saveActivityEvidence(sessionId, termId, payload);
			if ((reviewActions as readonly string[]).includes(action))
				return reviewParticipation(sessionId, termId, { ...payload, action });
			if ((changeActions as readonly string[]).includes(action))
				return changeParticipation(sessionId, termId, { ...payload, action });
			throw new AccountError("操作无效");
		},
		true,
	);
}
