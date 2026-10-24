import { authenticatedApi } from "@/server/route-handler";
import { backupDownloadLink } from "@/server/backup";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return authenticatedApi(request, ["ADMIN"], async sessionId => backupDownloadLink(sessionId, (await params).id, await request.json()), true);
}
