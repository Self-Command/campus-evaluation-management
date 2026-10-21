import { authenticatedApi } from "@/server/route-handler";
import { changeDeductionChange } from "@/server/deduction-changes";
import { z } from "zod";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return authenticatedApi(request, ["COUNSELOR", "COLLEGE"], async sessionId => {
    const body = await request.json();
    return changeDeductionChange(sessionId, z.string().min(1).parse(body.termId), (await context.params).id, body);
  }, true);
}
