import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AccountError } from "@/server/accounts";
import { ScoringError } from "@/lib/scoring/validate";
export function sameOrigin(request: Request) { return request.headers.get("origin") === new URL(process.env.NEXTAUTH_URL!).origin; }
export function apiError(error: unknown) {
  const headers = { "Cache-Control": "no-store" };
  if (error instanceof ScoringError) return NextResponse.json({ error: error.message }, { status: 400, headers });
  if (error instanceof AccountError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
  if (error instanceof ZodError) return NextResponse.json({ error: error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("；") }, { status: 400, headers });
  if (error instanceof SyntaxError) return NextResponse.json({ error: "请求格式无效，请检查填写内容" }, { status: 400, headers });
  if (typeof error === "object" && error && "code" in error && error.code === "P2002") return NextResponse.json({ error: "记录已存在，请核对后重试" }, { status: 409, headers });
  console.error("业务操作失败", error instanceof Error ? error.name : "UnknownError");
  return NextResponse.json({ error: "操作暂时无法完成，请稍后重试" }, { status: 500, headers });
}
