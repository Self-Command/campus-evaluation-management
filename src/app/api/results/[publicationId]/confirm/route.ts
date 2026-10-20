import { authenticatedApi } from "@/server/route-handler";
import { confirmResult } from "@/server/publications";
import { z } from "zod";
export async function POST(request: Request, context: {params:Promise<{publicationId:string}>}) { return authenticatedApi(request,["STUDENT"],async sessionId => {const body=await request.json(); return confirmResult(sessionId,z.string().min(1).max(100).parse(body.termId),(await context.params).publicationId,z.string().parse(body.resultHash));},true); }
