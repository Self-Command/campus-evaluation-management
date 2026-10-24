import { authenticatedApi } from "@/server/route-handler";
import { getAttachmentActivity } from "@/server/attachments-admin";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return authenticatedApi(request, ["ADMIN"], async sessionId => {
    const { id } = await params;
    return getAttachmentActivity(sessionId, id);
  });
}
