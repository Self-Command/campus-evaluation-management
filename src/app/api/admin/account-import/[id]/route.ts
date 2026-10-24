import { authenticatedApi } from "@/server/route-handler";
import { readAccountImport } from "@/server/account-import";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return authenticatedApi(request, ["ADMIN"], async sessionId => {
    const { id } = await context.params;
    return readAccountImport(sessionId, id);
  });
}
