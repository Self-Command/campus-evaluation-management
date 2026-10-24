import { NextResponse } from "next/server";
import { authorize } from "@/server/authorization";
import { apiError, sameOrigin } from "@/server/http";
import { writeUploadSession } from "@/server/backup";

export const runtime = "nodejs";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "请求来源无效" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  const auth = await authorize(["ADMIN"]);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status, headers: { "Cache-Control": "no-store" } });
  try {
    const token = request.headers.get("x-upload-token") ?? "";
    const offset = Number(request.headers.get("x-upload-offset") ?? "0");
    const result = await writeUploadSession(auth.user.sessionId, (await params).id, token, request.body, offset);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
