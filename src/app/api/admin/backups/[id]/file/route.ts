import { apiError } from "@/server/http";
import { openBackupDownload } from "@/server/backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ticket = new URL(request.url).searchParams.get("ticket") ?? "";
    const { stream, filename, size } = await openBackupDownload((await params).id, ticket);
    return new Response(stream, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${filename.replaceAll(/[^A-Za-z0-9._-]/g, "_")}"`,
        "Content-Length": String(size),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
