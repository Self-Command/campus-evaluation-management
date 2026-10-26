import { z } from "zod";
import { parseBatchBody, runBatch } from "@/server/batch-review";
import { reviewParticipation } from "@/server/recognitions";
import { authenticatedApi } from "@/server/route-handler";

const actionSchema = z.enum(["counselorApprove", "counselorReturn", "collegeApprove", "collegeReturn", "revoke"]);
const reasonRequired = ["counselorReturn", "collegeReturn", "revoke"] as const;

export async function POST(request: Request) {
	return authenticatedApi(
		request,
		["ADMIN", "COUNSELOR", "COLLEGE"],
		async (sessionId) => {
			const data = parseBatchBody(await request.json(), actionSchema, reasonRequired);
			return runBatch({
				sessionId,
				termId: data.termId,
				action: data.action,
				batchId: data.batchId,
				items: data.items,
				auditAction: "PARTICIPATION_BATCH_REVIEWED",
				execute: async (item, context) => {
					const saved = await reviewParticipation(
						sessionId,
						data.termId,
						{ id: item.id, revision: item.revision, action: data.action, reason: data.reason },
						context,
					);
					return { revision: saved.revision, status: saved.status };
				},
			});
		},
		true,
	);
}
