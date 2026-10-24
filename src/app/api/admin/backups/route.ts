import { authenticatedApi } from "@/server/route-handler";
import { createBackup, listBackups } from "@/server/backup";

export async function GET(request: Request) {
  return authenticatedApi(request, ["ADMIN"], listBackups);
}

export async function POST(request: Request) {
  return authenticatedApi(request, ["ADMIN"], async sessionId => createBackup(sessionId, await request.json()), true);
}
