import { NextResponse } from "next/server";
import { authorize } from "@/server/authorization";
import { apiError, sameOrigin } from "@/server/http";
import { AccountError } from "@/server/accounts";
import { evidenceLimits, uploadEvidence } from "@/server/evidence";
import { consumeLimit } from "@/server/rate-limit";
export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  const auth = await authorize(["ADMIN", "PUBLISHER", "COLLEGE", "STUDENT"]);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    if (!await consumeLimit("evidence-upload", auth.user.id, 30)) return NextResponse.json({ error: "上传频繁，请稍后重试" }, { status: 429 });
    const limits = await evidenceLimits();
    const reader = request.body?.getReader();
    if (!reader) throw new AccountError("请选择证明文件");
    const chunks: Uint8Array[] = []; let size = 0;
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > limits.maxSizeMb * 1024 * 1024) { await reader.cancel(); throw new AccountError(`每份证明需在${limits.maxSizeMb}MB以内`); } chunks.push(value); } } finally { reader.releaseLock(); }
    const name = decodeURIComponent(request.headers.get("x-file-name") ?? "证明文件");
    const result = await uploadEvidence(auth.user.sessionId, name, Buffer.concat(chunks));
    return NextResponse.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
