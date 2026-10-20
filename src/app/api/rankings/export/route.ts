import { authenticatedApi } from "@/server/route-handler";
import { rankingCsv } from "@/server/rankings";
import { z } from "zod";
export async function GET(request:Request) { return authenticatedApi(request,["ADMIN"],async sessionId => { const q=new URL(request.url).searchParams; const csv=await rankingCsv(sessionId,z.string().min(1).max(100).parse(q.get("termId")),Object.fromEntries(q)); return new Response(csv,{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":'attachment; filename="evaluation-ranking.csv"',"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}}); }); }
