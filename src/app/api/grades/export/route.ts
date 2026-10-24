import { NextResponse } from "next/server";
import { z } from "zod";
import { authorize } from "@/server/authorization";
import { apiError } from "@/server/http";
import { exportStudentGradeWorkbook } from "@/server/grade-export";
import { exportClassGradeWorkbook } from "@/server/class-grade-export";
import { MAX_EXPORT_COLLEGES } from "@/server/export-limits";

// Authorized formula workbook download. The scope is taken from the signed-in account,
// so a forged studentId/classId simply fails the scope check instead of leaking data.
export async function GET(request: Request) {
  const auth = await authorize(["ADMIN", "COLLEGE", "COUNSELOR", "STUDENT"]);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status, headers: { "Cache-Control": "no-store" } });
  try {
    const query = new URL(request.url).searchParams;
    const termId = z.string().min(1).max(100).parse(query.get("termId"));
    const classIds = z.array(z.string().min(1).max(100)).max(100).parse(query.getAll("classId"));
    const collegeIds = z.array(z.string().min(1).max(100)).max(MAX_EXPORT_COLLEGES).parse(query.getAll("collegeId"));
    const scope = z.enum(["school", "college", "counselor"]).optional().parse(query.get("scope") ?? undefined);
    if (classIds.length || collegeIds.length || scope) {
      const { buffer, fileName } = await exportClassGradeWorkbook(auth.user.sessionId, termId, { ...(classIds.length ? { classIds } : {}), ...(collegeIds.length ? { collegeIds } : {}), ...(scope ? { scope } : {}) });
      return new Response(new Uint8Array(buffer), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    const studentId = z.string().min(1).max(100).parse(query.get("studentId"));
    const { buffer, fileName } = await exportStudentGradeWorkbook(auth.user.sessionId, termId, { studentId });
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
