import { NextResponse } from "next/server";
import { authorize } from "@/server/authorization";
import { resetAccountPassword } from "@/server/accounts";
import { apiError, sameOrigin } from "@/server/http";
import { consumeLimit } from "@/server/rate-limit";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  const auth = await authorize(["ADMIN"]);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    if (!(await consumeLimit("admin-password-reset", auth.user.id, 20))) return NextResponse.json({ error: "操作过于频繁，请稍后再试" }, { status: 429 });
    return NextResponse.json(await resetAccountPassword(auth.user.sessionId, (await params).id, await request.json()), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
