import { authenticatedApi } from "@/server/route-handler";
import { exportRankingGradeWorkbook } from "@/server/rankings";
import { z } from "zod";

// The ranking page exports the selected publication (latest by default) as the same
// school-wide detail workbook used elsewhere; role scope and ordering live in the builder.
export async function GET(request: Request) {
  return authenticatedApi(request, ["ADMIN"], async (sessionId) => {
    const query = new URL(request.url).searchParams;
    const termId = z.string().min(1).max(100).parse(query.get("termId"));
    const publicationId = z.string().min(1).max(100).optional().parse(query.get("publicationId") || undefined);
    const { buffer, fileName } = await exportRankingGradeWorkbook(sessionId, termId, { publicationId });
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
