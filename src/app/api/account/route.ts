import { authenticatedApi } from "@/server/route-handler";
import { selfAccount } from "@/server/account-self";
export async function GET(request: Request) { return authenticatedApi(request, ["ADMIN", "PUBLISHER", "STUDENT", "COLLEGE", "COUNSELOR"], sessionId => selfAccount(sessionId)); }
export async function PATCH(request: Request) { return authenticatedApi(request, ["ADMIN", "PUBLISHER", "STUDENT", "COLLEGE", "COUNSELOR"], async sessionId => selfAccount(sessionId, await request.json()), true); }
