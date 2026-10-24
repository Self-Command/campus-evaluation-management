import { authenticatedApi } from "@/server/route-handler";
import { deleteBackup, getBackup } from "@/server/backup";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return authenticatedApi(request, ["ADMIN"], async sessionId => getBackup(sessionId, (await params).id));
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return authenticatedApi(request, ["ADMIN"], async sessionId => deleteBackup(sessionId, (await params).id, await request.json()), true);
}
