import { authenticatedApi } from "@/server/route-handler";
import { publicationHistory, previewPublication, publishResults, extendChecking, setPublicationCohort } from "@/server/publications";
import { z } from "zod";
type Context = { params: Promise<{id:string}> };
export async function GET(request: Request, context: Context) { return authenticatedApi(request, ["ADMIN"], async sessionId => publicationHistory(sessionId,(await context.params).id)); }
export async function POST(request: Request, context: Context) { return authenticatedApi(request, ["ADMIN"], async sessionId => { const body=await request.json(), id=(await context.params).id; const action=z.enum(["preview","publish","extend","cohort"]).parse(body.action); return action==="preview" ? previewPublication(sessionId,id) : action==="extend" ? extendChecking(sessionId,id,body) : action==="cohort" ? setPublicationCohort(sessionId,id,body) : publishResults(sessionId,id,body); },true); }
