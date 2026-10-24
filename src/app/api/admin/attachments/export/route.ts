import { authenticatedApi } from "@/server/route-handler";
import { exportActivityAttachments } from "@/server/attachments-admin";

export async function POST(request: Request) {
  return authenticatedApi(request, ["ADMIN"], async sessionId => {
    const { stream, headers } = await exportActivityAttachments(sessionId, await request.json());
    return new Response(stream, { headers });
  }, true);
}
