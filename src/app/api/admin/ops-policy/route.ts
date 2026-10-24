import { readOpsPolicy, updateOpsPolicy } from "@/server/ops-policy";
import { authenticatedApi } from "@/server/route-handler";

export async function GET(request: Request) {
  return authenticatedApi(request, ["ADMIN"], readOpsPolicy);
}

export async function PUT(request: Request) {
  return authenticatedApi(request, ["ADMIN"], async sessionId => updateOpsPolicy(sessionId, await request.json()), true);
}
