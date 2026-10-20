import { authenticatedApi } from "@/server/route-handler";
import { changeAppeal } from "@/server/appeals";
import { z } from "zod";
export async function PATCH(request:Request,context:{params:Promise<{id:string}>}) { return authenticatedApi(request,["ADMIN","STUDENT"],async sessionId => { const body=await request.json(); return changeAppeal(sessionId,z.string().min(1).max(100).parse(body.termId),(await context.params).id,body); },true); }
