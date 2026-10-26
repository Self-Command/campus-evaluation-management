import { z } from "zod";
import { parseBatchBody, runBatch } from "@/server/batch-review";
import { changeGradeChange } from "@/server/grade-changes";
import { authenticatedApi } from "@/server/route-handler";

const actionSchema = z.enum(["approve", "return", "abandon"]);
const reasonRequired = ["return"] as const;

export async function POST(request: Request) {
	return authenticatedApi(
		request,
		["COUNSELOR", "COLLEGE"],
		async (sessionId) => {
			const data = parseBatchBody(await request.json(), actionSchema, reasonRequired);
			return runBatch({
				sessionId,
				termId: data.termId,
				action: data.action,
				batchId: data.batchId,
				items: data.items,
				auditAction: "GRADE_BATCH_CHANGED",
				execute: async (item, context) => {
					const saved = await changeGradeChange(
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
