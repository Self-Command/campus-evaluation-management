import { authenticatedApi } from "@/server/route-handler";
import { pageResultStudents } from "@/server/results";
import { z } from "zod";

export async function GET(request: Request) {
  return authenticatedApi(request, ["ADMIN"], sessionId => {
    const query = new URL(request.url).searchParams;
    const termId = z.string().min(1).max(100).parse(query.get("termId"));
    return pageResultStudents(sessionId, termId, Object.fromEntries(query));
  });
}
