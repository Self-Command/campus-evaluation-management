import { NextResponse } from "next/server";
import { z } from "zod";
import { authorize } from "@/server/authorization";
import { apiError } from "@/server/http";
import { exportStudentGradeWorkbook } from "@/server/grade-export";
import { exportClassGradeWorkbook } from "@/server/class-grade-export";

// Authorized formula workbook download. The scope is taken from the signed-in account,
// so a forged studentId/classId simply fails the scope check instead of leaking data.
export async function GET(request: Request) {
  const auth = await authorize(["ADMIN", "COLLEGE", "COUNSELOR", "STUDENT"]);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status, headers: { "Cache-Control": "no-store" } });
  try {
    const query = new URL(request.url).searchParams;
    const termId = z.string().min(1).max(100).parse(query.get("termId"));
    const classId = query.get("classId");
    if (classId) {
      const { buffer, fileName } = await exportClassGradeWorkbook(auth.user.sessionId, termId, { classId });
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
