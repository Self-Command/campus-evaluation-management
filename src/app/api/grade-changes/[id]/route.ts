import { authenticatedApi } from "@/server/route-handler";
import { changeGradeChange } from "@/server/grade-changes";
import { z } from "zod";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return authenticatedApi(request, ["COUNSELOR", "COLLEGE"], async sessionId => {
    const body = await request.json();
    return changeGradeChange(sessionId, z.string().min(1).parse(body.termId), (await context.params).id, body);
  }, true);
}
