import { authenticatedApi } from "@/server/route-handler";
import { completeUploadSession } from "@/server/backup";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return authenticatedApi(request, ["ADMIN"], async sessionId => completeUploadSession(sessionId, (await params).id, await request.json().catch(() => ({}))), true);
}
