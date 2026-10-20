import { authenticatedApi } from "@/server/route-handler";
import { correctScoring } from "@/server/corrections";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) { return authenticatedApi(request, ["ADMIN"], async sessionId => correctScoring(sessionId, (await context.params).id, await request.json()), true); }
