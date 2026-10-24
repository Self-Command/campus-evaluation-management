import { authenticatedApi } from "@/server/route-handler";
import { preflightRestore } from "@/server/restore";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return authenticatedApi(request, ["ADMIN"], async sessionId => preflightRestore(sessionId, (await params).id, await request.json()), true);
}
