import { authenticatedApi } from "@/server/route-handler";
import { getRestoreJob } from "@/server/restore";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return authenticatedApi(request, ["ADMIN"], async sessionId => getRestoreJob(sessionId, (await params).id));
}
