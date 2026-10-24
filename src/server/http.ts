import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AccountError } from "@/server/accounts";
import { AuditError } from "@/server/audit";
import { OpsError } from "@/server/ops-common";
import { ScoringError } from "@/lib/scoring/validate";

const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

function originValue(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function configuredOrigins() {
  const origins = new Set<string>();
  for (const value of [process.env.NEXTAUTH_URL, ...(process.env.APP_TRUSTED_ORIGINS ?? "").split(",")]) {
    const origin = originValue(value);
    if (!origin) continue;
    origins.add(origin);
    const url = new URL(origin);
    // Local development is commonly opened as either localhost or 127.0.0.1.
    // Keep the same protocol and port while accepting the two loopback aliases.
    if (loopbackHosts.has(url.hostname)) {
      for (const host of loopbackHosts) {
        const alias = new URL(origin);
        alias.hostname = host;
        origins.add(alias.origin);
      }
    }
  }
  return origins;
}

export function sameOrigin(request: Request) {
  const rawOrigin = request.headers.get("origin");
  const origin = originValue(rawOrigin);
  if (!origin || rawOrigin !== origin) return false;
  if (configuredOrigins().has(origin)) return true;
  try {
    // Also accept the browser's own request origin. This keeps deployments
    // working when their public host differs from NEXTAUTH_URL, while still
    // rejecting cross-site form posts. Proxies with a rewritten request URL
    // must configure NEXTAUTH_URL or APP_TRUSTED_ORIGINS explicitly.
    return originValue(new URL(request.url).origin) === origin;
  } catch {
    return false;
  }
}
export function apiError(error: unknown) {
  const headers = { "Cache-Control": "no-store" };
  if (error instanceof ScoringError) return NextResponse.json({ error: error.message }, { status: 400, headers });
  if (error instanceof AccountError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
  if (error instanceof AuditError) return NextResponse.json({ error: error.message }, { status: 400, headers });
  if (error instanceof OpsError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers });
  if (error instanceof ZodError) return NextResponse.json({ error: error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("；") }, { status: 400, headers });
  if (error instanceof SyntaxError) return NextResponse.json({ error: "请求格式无效，请检查填写内容" }, { status: 400, headers });
  if (typeof error === "object" && error && "code" in error && error.code === "P2002") return NextResponse.json({ error: "记录已存在，请核对后重试" }, { status: 409, headers });
  console.error("业务操作失败", error instanceof Error ? error.name : "UnknownError");
  return NextResponse.json({ error: "操作暂时无法完成，请稍后重试" }, { status: 500, headers });
}
