import { authenticatedApi } from "@/server/route-handler";
import { listAuditLogs } from "@/server/audit-query";

export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  return authenticatedApi(request, ["ADMIN"], sessionId => listAuditLogs(sessionId, params));
}
