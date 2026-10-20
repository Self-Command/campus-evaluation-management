import { NextResponse } from "next/server";
import { authorize } from "@/server/authorization";
import { apiError, sameOrigin } from "@/server/http";
import type { Role } from "@/generated/prisma/client";
import { jsonSafe } from "@/server/json-safe";

export async function authenticatedApi(request: Request, roles: Role[], operation: (sessionId: string) => Promise<unknown>, write = false) {
  if (write && !sameOrigin(request)) return NextResponse.json({ error: "请求来源无效" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  const auth = await authorize(roles);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status, headers: { "Cache-Control": "no-store" } });
  try {
    const result = await operation(auth.user.sessionId);
    return result instanceof Response ? result : NextResponse.json(jsonSafe(result), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
