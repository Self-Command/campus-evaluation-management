import { authenticatedApi } from "@/server/route-handler";
import { listOrganizations, saveOrganization } from "@/server/organizations";

export async function GET(request: Request) {
  return authenticatedApi(request, ["ADMIN", "COLLEGE", "COUNSELOR"], listOrganizations);
}
export async function POST(request: Request) {
  return authenticatedApi(request, ["ADMIN", "COLLEGE"], async sessionId => saveOrganization(sessionId, await request.json()), true);
}
