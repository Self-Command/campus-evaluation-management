import { authenticatedApi } from "@/server/route-handler";
import { getAuditLog } from "@/server/audit-query";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return authenticatedApi(request, ["ADMIN"], async sessionId => getAuditLog(sessionId, (await params).id));
}
