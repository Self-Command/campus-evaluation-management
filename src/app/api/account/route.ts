import { authenticatedApi } from "@/server/route-handler";
import { selfAccount } from "@/server/account-self";
export async function GET(request: Request) { return authenticatedApi(request, ["ADMIN", "PUBLISHER", "STUDENT"], sessionId => selfAccount(sessionId)); }
export async function PATCH(request: Request) { return authenticatedApi(request, ["ADMIN", "PUBLISHER", "STUDENT"], async sessionId => selfAccount(sessionId, await request.json()), true); }
