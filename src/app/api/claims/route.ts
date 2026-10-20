import { authenticatedApi } from "@/server/route-handler";
import { pageClaims, submitClaim } from "@/server/claims";
import { z } from "zod";
export async function GET(request: Request) { return authenticatedApi(request, ["ADMIN","STUDENT"], async sessionId => { const q = new URL(request.url).searchParams; return pageClaims(sessionId, z.string().min(1).max(100).parse(q.get("termId")), Number(q.get("page") || 1), q.get("status") || undefined); }); }
export async function POST(request: Request) { return authenticatedApi(request, ["STUDENT"], async sessionId => { const body = await request.json(); return submitClaim(sessionId, z.string().min(1).max(100).parse(body.termId), body); }, true); }
