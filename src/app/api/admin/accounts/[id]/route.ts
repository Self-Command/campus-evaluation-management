import { NextResponse } from "next/server";
import { authorize } from "@/server/authorization";
import { accountUsage, deleteAccount, updateAccount } from "@/server/accounts";
import { authenticatedApi } from "@/server/route-handler";
import { apiError, sameOrigin } from "@/server/http";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return authenticatedApi(request, ["ADMIN"], async sessionId => accountUsage(sessionId, (await params).id));
}
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return authenticatedApi(request, ["ADMIN"], async sessionId => deleteAccount(sessionId, (await params).id, await request.json()), true);
}
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  const auth = await authorize(["ADMIN"]);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try { return NextResponse.json(await updateAccount(auth.user.sessionId, (await params).id, await request.json())); } catch (error) { return apiError(error); }
}
