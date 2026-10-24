import { authenticatedApi } from "@/server/route-handler";
import { createUploadSession } from "@/server/backup";

export async function POST(request: Request) {
  return authenticatedApi(request, ["ADMIN"], async sessionId => createUploadSession(sessionId, await request.json()), true);
}
