import { auditExportContentType, exportAuditLogs } from "@/server/audit-query";
import { authenticatedApi } from "@/server/route-handler";

export async function POST(request: Request) {
  return authenticatedApi(request, ["ADMIN"], async sessionId => {
    const { stream, filename, total } = await exportAuditLogs(sessionId, await request.json());
    return new Response(stream, {
      headers: {
        "Content-Type": auditExportContentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Export-Rows": String(total),
      },
    });
  }, true);
}
