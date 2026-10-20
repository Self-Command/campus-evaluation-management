import { authenticatedApi } from "@/server/route-handler";
import { previewSettlement, lockSettlement, reopenTerm } from "@/server/publications";
import { z } from "zod";
export async function POST(request:Request,context:{params:Promise<{id:string}>}) { return authenticatedApi(request,["ADMIN"],async sessionId => { const body=await request.json(), id=(await context.params).id; const action=z.enum(["preview","lock","reopen"]).parse(body.action); return action==="preview" ? previewSettlement(sessionId,id) : action==="lock" ? lockSettlement(sessionId,id,body) : reopenTerm(sessionId,id,body); },true); }
