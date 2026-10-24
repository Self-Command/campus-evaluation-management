import { authenticatedApi } from "@/server/route-handler";
import { listAccountImports } from "@/server/account-import";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  return authenticatedApi(request, ["ADMIN"], sessionId => listAccountImports(sessionId, {
    q: query.get("q") ?? "",
    targetRole: query.get("role") || undefined,
    status: query.get("status") || undefined,
    page: query.get("page") ?? 1,
  }));
}
