import { authenticatedApi } from "@/server/route-handler";
import { listProjects, saveProject } from "@/server/claims";
import { z } from "zod";
export async function GET(request: Request) { return authenticatedApi(request, ["ADMIN","COLLEGE","COUNSELOR"], sessionId => listProjects(sessionId, z.string().min(1).max(100).parse(new URL(request.url).searchParams.get("termId")))); }
export async function POST(request: Request) { return authenticatedApi(request, ["ADMIN"], async sessionId => { const body = await request.json(); return saveProject(sessionId, z.string().min(1).max(100).parse(body.termId), body); }, true); }
