import { authenticatedApi } from "@/server/route-handler";
import { getRankings } from "@/server/rankings";
import { z } from "zod";
export async function GET(request:Request) { return authenticatedApi(request,["ADMIN","STUDENT"],sessionId => { const q=new URL(request.url).searchParams; return getRankings(sessionId,z.string().min(1).max(100).parse(q.get("termId")),Object.fromEntries(q)); }); }
