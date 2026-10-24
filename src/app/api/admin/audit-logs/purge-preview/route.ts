import { previewAuditPurge } from "@/server/ops-policy";
import { authenticatedApi } from "@/server/route-handler";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { retentionDays?: number };
  return authenticatedApi(request, ["ADMIN"], sessionId => previewAuditPurge(sessionId, body.retentionDays), true);
}
