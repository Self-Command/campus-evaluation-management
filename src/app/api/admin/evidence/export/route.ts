import { authenticatedApi } from "@/server/route-handler";
import { exportStudentEvidence } from "@/server/attachments-admin";

export async function POST(request: Request) {
  return authenticatedApi(request, ["ADMIN"], async sessionId => {
    const { stream, headers } = await exportStudentEvidence(sessionId, await request.json());
    return new Response(stream, { headers });
  }, true);
}
