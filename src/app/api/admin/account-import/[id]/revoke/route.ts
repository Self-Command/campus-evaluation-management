import { authenticatedApi } from "@/server/route-handler";
import { revokeAccountImport } from "@/server/account-import";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return authenticatedApi(request, ["ADMIN"], async sessionId => {
    const { id } = await context.params;
    return revokeAccountImport(sessionId, id, await request.json());
  }, true);
}
