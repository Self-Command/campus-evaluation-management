import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { maintenanceState } from "@/server/restore-state";

const requestIdPattern = /^[A-Za-z0-9._-]{8,64}$/;

function trustedClientIp(request: NextRequest) {
  if (process.env.TRUST_PROXY !== "true") return "";
  const forwarded = request.headers.get("x-forwarded-for");
  if (!forwarded) return "";
  // One trusted reverse proxy appends the real client address on the right.
  const candidate = forwarded.split(",").at(-1)?.trim() ?? "";
  return isIP(candidate) && candidate.length <= 45 ? candidate : "";
}

function withRequestContext(request: NextRequest, requestId: string) {
  const headers = new Headers(request.headers);
  headers.set("x-request-id", requestId);
  headers.set("x-audit-route", request.nextUrl.pathname.slice(0, 300));
  headers.set("x-audit-method", request.method);
  const ip = trustedClientIp(request);
  if (ip) headers.set("x-client-ip", ip);
  else headers.delete("x-client-ip");
  return headers;
}

export function proxy(request: NextRequest) {
  const incoming = request.headers.get("x-request-id")?.trim() ?? "";
  const requestId = requestIdPattern.test(incoming) ? incoming : randomUUID();
  const headers = withRequestContext(request, requestId);
  const pathname = request.nextUrl.pathname;
  const maintenance = maintenanceState();
  const exempt = pathname === "/maintenance" || pathname === "/api/system/restore-status" ||
    pathname === "/api/health/live" || pathname === "/api/health/ready";
  if (maintenance && !exempt) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "系统正在执行数据库恢复，暂时无法处理请求", code: "MAINTENANCE" },
        { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "60", "x-request-id": requestId } },
      );
    }
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>系统维护中</title><style>
      :root{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;background:#f4f6f8;color:#111827}
      .card{width:min(92vw,520px);padding:40px;border:1px solid #e5e7eb;border-radius:16px;background:#fff;box-shadow:0 18px 60px rgba(15,23,42,.08)}
      .mark{width:42px;height:42px;border-radius:12px;background:#111827;color:#fff;display:grid;place-items:center;font-weight:700;margin-bottom:22px}
      h1{font-size:22px;margin:0 0 12px}p{margin:0;line-height:1.7;color:#4b5563;font-size:14px}.hint{margin-top:18px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280}
      @media(prefers-color-scheme:dark){body{background:#0b0f16;color:#f9fafb}.card{background:#111827;border-color:#1f2937;box-shadow:none}p{color:#9ca3af}.mark{background:#f9fafb;color:#111827}.hint{border-color:#1f2937;color:#6b7280}}
    </style></head><body><main class="card"><div class="mark">评</div><h1>系统正在维护</h1><p>管理员正在执行数据库恢复，系统已暂停所有登录与业务操作，以避免产生新的写入。</p><p class="hint">恢复完成后页面会自动恢复访问；如长时间未恢复，请联系系统管理员。</p></main></body></html>`;
    return new Response(html, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Retry-After": "60", "x-request-id": requestId } });
  }
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("x-request-id", requestId);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?|ttf|map)$).*)"],
};
