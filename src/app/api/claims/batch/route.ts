import { z } from "zod";
import { parseBatchBody, runBatch } from "@/server/batch-review";
import { changeClaim } from "@/server/claims";
import { authenticatedApi } from "@/server/route-handler";

const actionSchema = z.enum(["approve", "return", "rescore", "revoke"]);
const reasonRequired = ["return", "rescore", "revoke"] as const;

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
				auditAction: "CLAIM_BATCH_CHANGED",
				execute: async (item, context) => {
					const saved = await changeClaim(
						sessionId,
						data.termId,
						item.id,
						{ revision: item.revision, action: data.action, reason: data.reason },
						context,
					);
					return { revision: saved.revision, status: saved.status };
				},
			});
		},
		true,
	);
}
