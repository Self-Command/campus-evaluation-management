import { z } from "zod";
import { parseBatchBody, runBatch } from "@/server/batch-review";
import { changeAppeal } from "@/server/appeals";
import { authenticatedApi } from "@/server/route-handler";

const actionSchema = z.enum(["process"]);
const reasonRequired: readonly string[] = [];

export async function POST(request: Request) {
	return authenticatedApi(
		request,
		["ADMIN"],
		async (sessionId) => {
			const data = parseBatchBody(await request.json(), actionSchema, reasonRequired);
			return runBatch({
				sessionId,
				termId: data.termId,
				action: data.action,
				batchId: data.batchId,
				items: data.items,
				auditAction: "APPEAL_BATCH_CHANGED",
				execute: async (item, context) => {
					const saved = await changeAppeal(
						sessionId,
						data.termId,
						item.id,
						{ revision: item.revision, action: data.action },
						context,
					);
					return { revision: saved.revision, status: saved.status };
				},
			});
		},
		true,
	);
}
