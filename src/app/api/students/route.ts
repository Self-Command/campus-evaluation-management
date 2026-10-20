import { authenticatedApi } from "@/server/route-handler";
import { pageStudents } from "@/server/students";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  return authenticatedApi(request, ["ADMIN"], sessionId => pageStudents(sessionId, Object.fromEntries(query)));
}
