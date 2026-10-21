import { authenticatedApi } from "@/server/route-handler";
import { readGradeRoster } from "@/server/grade-changes";
import { z } from "zod";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  return authenticatedApi(request, ["ADMIN", "COLLEGE", "COUNSELOR"], sessionId =>
    readGradeRoster(sessionId, z.string().min(1).parse(query.get("termId")), Object.fromEntries(query)));
}
