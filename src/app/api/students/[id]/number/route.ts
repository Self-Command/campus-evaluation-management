import { authenticatedApi } from "@/server/route-handler";
import { correctStudentNumber } from "@/server/students";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return authenticatedApi(request, ["ADMIN"], async sessionId => {
    const { id } = await context.params;
    return correctStudentNumber(sessionId, id, await request.json());
  }, true);
}
