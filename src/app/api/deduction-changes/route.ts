import { authenticatedApi } from "@/server/route-handler";
import { submitDeductionChange, readDeductionQueue } from "@/server/deduction-changes";
import { z } from "zod";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  return authenticatedApi(request, ["ADMIN", "COLLEGE", "COUNSELOR"], sessionId =>
    readDeductionQueue(sessionId, z.string().min(1).parse(query.get("termId")), { status: query.get("status") ?? undefined, page: query.get("page") ?? undefined }));
}

export async function POST(request: Request) {
  return authenticatedApi(request, ["COUNSELOR"], async sessionId => {
    const body = await request.json();
    return submitDeductionChange(sessionId, z.string().min(1).parse(body.termId), body);
  }, true);
}
