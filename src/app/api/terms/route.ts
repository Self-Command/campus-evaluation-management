import { NextResponse } from "next/server";
import { authorize } from "@/server/authorization";
import { apiError, sameOrigin } from "@/server/http";
import { listTerms, createTerm } from "@/server/terms";
export async function GET() {
  const auth = await authorize(["ADMIN", "PUBLISHER", "STUDENT"]);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try { return NextResponse.json(await listTerms(auth.user.sessionId), { headers: { "Cache-Control": "no-store" } }); } catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  const auth = await authorize(["ADMIN"]);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try { return NextResponse.json(await createTerm(auth.user.sessionId, await request.json()), { status: 201 }); } catch (error) { return apiError(error); }
}
