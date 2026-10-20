import { NextResponse } from "next/server";
import { authorize } from "@/server/authorization";
import { apiError } from "@/server/http";
import { downloadEvidence } from "@/server/evidence";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize(["ADMIN", "PUBLISHER", "STUDENT"]);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { id } = await params;
    const { file, bytes } = await downloadEvidence(auth.user.sessionId, id);
    return new Response(bytes, { headers: { "Content-Type": file.mime, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'" } });
  } catch (error) { return apiError(error); }
}
