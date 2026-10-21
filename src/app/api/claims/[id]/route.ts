import { authenticatedApi } from "@/server/route-handler";
import { changeClaim } from "@/server/claims";
import { z } from "zod";
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) { return authenticatedApi(request, ["ADMIN","STUDENT","COUNSELOR","COLLEGE"], async sessionId => { const body = await request.json(); return changeClaim(sessionId, z.string().min(1).max(100).parse(body.termId), (await context.params).id, body); }, true); }
