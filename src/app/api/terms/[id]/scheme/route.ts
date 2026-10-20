import { NextResponse } from "next/server";
import { z } from "zod";
import { authorize } from "@/server/authorization";
import { apiError, sameOrigin } from "@/server/http";
import { activateTerm, saveScheme } from "@/server/terms";
import { calculate } from "@/lib/scoring/calculate";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  const auth = await authorize(["ADMIN"]);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { id } = await params;
    const body = await request.json();
    const action = z.enum(["save", "activate", "preview"]).parse(body.action);
    const result = action === "save" ? await saveScheme(auth.user.sessionId, id, body) : action === "activate" ? await activateTerm(auth.user.sessionId, id, body) : calculate(body.scheme, z.object({ values: z.record(z.string(), z.string()), deductions: z.record(z.string(), z.string()) }).parse(body.input));
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
