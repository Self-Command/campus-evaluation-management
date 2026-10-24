import { NextResponse } from "next/server";
import { authenticatedApi } from "@/server/route-handler";
import { confirmRestore, restoreStatusToken } from "@/server/restore";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return authenticatedApi(request, ["ADMIN"], async sessionId => {
    const result = await confirmRestore(sessionId, (await params).id, await request.json());
    const response = NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set("campus_restore_status", restoreStatusToken(result.restoreId), {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/api/system/restore-status",
      maxAge: 2 * 60 * 60,
    });
    return response;
  }, true);
}
