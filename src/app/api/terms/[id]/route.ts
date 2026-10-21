import { authenticatedApi } from "@/server/route-handler";
import { readTermManagement, manageTerm } from "@/server/terms";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return authenticatedApi(request, ["ADMIN"], sessionId => readTermManagement(sessionId, id));
}
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return authenticatedApi(request, ["ADMIN"], async sessionId => manageTerm(sessionId, id, await request.json()), true);
}
