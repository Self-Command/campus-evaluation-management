import { authenticatedApi } from "@/server/route-handler";
import { readGradeDetail } from "@/server/grade-changes";
import { z } from "zod";

export async function GET(request: Request, context: { params: Promise<{ studentId: string }> }) {
  const termId = new URL(request.url).searchParams.get("termId");
  return authenticatedApi(request, ["ADMIN", "COLLEGE", "COUNSELOR"], async sessionId =>
    readGradeDetail(sessionId, z.string().min(1).parse(termId), (await context.params).studentId));
}
