import { purgeAuditLogs } from "@/server/ops-policy";
import { authenticatedApi } from "@/server/route-handler";

export async function POST(request: Request) {
  return authenticatedApi(request, ["ADMIN"], async sessionId => purgeAuditLogs(sessionId, await request.json()), true);
}
