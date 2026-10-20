import { authenticatedApi } from "@/server/route-handler";
import { inputHistory } from "@/server/input-history";
export async function GET(request: Request) { return authenticatedApi(request, ["ADMIN", "STUDENT"], sessionId => inputHistory(sessionId, Object.fromEntries(new URL(request.url).searchParams))); }
