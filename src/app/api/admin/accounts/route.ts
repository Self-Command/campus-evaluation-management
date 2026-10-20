import { NextResponse } from "next/server";
import { authorize } from "@/server/authorization";
import { createAccount, listAccounts } from "@/server/accounts";
import { apiError, sameOrigin } from "@/server/http";
import { z } from "zod";
export async function GET(request: Request) {
  const auth = await authorize(["ADMIN"]);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const url = new URL(request.url);
  const page = Number(url.searchParams.get("page") ?? 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000) return NextResponse.json({ error: "页码无效" }, { status: 400 });
  try {
    const role = z.enum(["ADMIN", "PUBLISHER", "STUDENT"]).optional().parse(url.searchParams.get("role") || undefined);
    const disabled = z.enum(["true", "false"]).optional().parse(url.searchParams.get("disabled") || undefined);
    return NextResponse.json(await listAccounts(auth.user.sessionId, (url.searchParams.get("q") ?? "").slice(0, 80), page, { role, disabled: disabled === undefined ? undefined : disabled === "true" }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  const auth = await authorize(["ADMIN"]);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try { return NextResponse.json(await createAccount(auth.user.sessionId, await request.json()), { status: 201, headers: { "Cache-Control": "no-store" } }); } catch (error) { return apiError(error); }
}
