import { authenticatedApi } from "@/server/route-handler";
import { audienceAction } from "@/server/activity-policy";
export async function POST(request: Request) { return authenticatedApi(request, ["ADMIN", "PUBLISHER"], async sessionId => audienceAction(sessionId, await request.json()), true); }
