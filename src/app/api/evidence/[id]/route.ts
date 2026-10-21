import { NextResponse } from "next/server";
import { authorize } from "@/server/authorization";
import { apiError } from "@/server/http";
import { downloadEvidence } from "@/server/evidence";
import { z } from "zod";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize(["ADMIN", "PUBLISHER", "STUDENT", "COLLEGE", "COUNSELOR"]);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { id } = await params;
    const disposition = z.enum(["attachment", "inline"]).parse(new URL(request.url).searchParams.get("disposition") ?? "attachment");
    const { file, bytes } = await downloadEvidence(auth.user.sessionId, id);
    return new Response(bytes, { headers: { "Content-Type": file.mime, "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(file.name)}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "SAMEORIGIN", "Content-Security-Policy": `${disposition === "attachment" ? "sandbox; " : ""}default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`, "Cross-Origin-Resource-Policy": "same-origin" } });
  } catch (error) { return apiError(error); }
}
