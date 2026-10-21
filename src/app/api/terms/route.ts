import { NextResponse } from "next/server";
import { authorize } from "@/server/authorization";
import { apiError, sameOrigin } from "@/server/http";
import { listTerms, createTerm, termViewSchema } from "@/server/terms";
export async function GET(request: Request) {
  const auth = await authorize(["ADMIN", "PUBLISHER", "STUDENT", "COLLEGE", "COUNSELOR"]);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try { const view = termViewSchema.parse(new URL(request.url).searchParams.get("view") ?? "normal"); return NextResponse.json(await listTerms(auth.user.sessionId, { view }), { headers: { "Cache-Control": "no-store" } }); } catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  const auth = await authorize(["ADMIN"]);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try { return NextResponse.json(await createTerm(auth.user.sessionId, await request.json()), { status: 201 }); } catch (error) { return apiError(error); }
}
