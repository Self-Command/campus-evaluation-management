import { authenticatedApi } from "@/server/route-handler";
import { abortPreflight } from "@/server/restore";

export async function POST(request: Request) {
  const body = await request.json() as { restoreId?: string; reason?: unknown } & Record<string, unknown>;
  return authenticatedApi(request, ["ADMIN"], async sessionId => abortPreflight(sessionId, String(body.restoreId ?? ""), { reason: body.reason }), true);
}
