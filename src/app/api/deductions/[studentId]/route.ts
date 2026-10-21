import { authenticatedApi } from "@/server/route-handler";
import { readDeductionDetail } from "@/server/deduction-changes";
import { z } from "zod";

export async function GET(request: Request, context: { params: Promise<{ studentId: string }> }) {
  const termId = new URL(request.url).searchParams.get("termId");
  return authenticatedApi(request, ["ADMIN", "COLLEGE", "COUNSELOR"], async sessionId =>
    readDeductionDetail(sessionId, z.string().min(1).parse(termId), (await context.params).studentId));
}
