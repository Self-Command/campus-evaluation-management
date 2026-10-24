import { authenticatedApi } from "@/server/route-handler";
import { listEvidence } from "@/server/attachments-admin";

function query(request: Request) {
  const params = new URL(request.url).searchParams;
  const result: Record<string, string> = {};
  for (const [key, value] of params) {
    if (value !== "") result[key] = value;
  }
  return result;
}

export async function GET(request: Request) {
  return authenticatedApi(request, ["ADMIN"], sessionId => listEvidence(sessionId, query(request)));
}
