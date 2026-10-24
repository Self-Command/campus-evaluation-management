import { authenticatedApi } from "@/server/route-handler";
import { getRestoreReport } from "@/server/restore";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return authenticatedApi(request, ["ADMIN"], async sessionId => ({ report: await getRestoreReport(sessionId, (await params).id) }));
}
