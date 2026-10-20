import { NextResponse } from "next/server";
import { authorize } from "@/server/authorization";
import { saveGrade, listGrades } from "@/server/grades";
import { apiError, sameOrigin } from "@/server/http";
import { z } from "zod";
export async function GET(request: Request) {
  const auth = await authorize(["ADMIN"]);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const query = new URL(request.url).searchParams;
    return NextResponse.json(await listGrades(auth.user.sessionId, z.string().min(1).parse(query.get("termId")), z.string().min(1).parse(query.get("studentLogin"))), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  const auth = await authorize(["ADMIN"]);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json();
    return NextResponse.json(await saveGrade(auth.user.sessionId, z.string().min(1).parse(body.termId), body), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
