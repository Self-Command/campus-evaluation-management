import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { authorize } from "@/server/authorization";
import { AccountError } from "@/server/accounts";
import { previewGradeImport, commitGradeImport } from "@/server/grade-import";
import { parseAccountFile } from "@/server/spreadsheet";
import { boundedForm } from "@/server/upload-form";
import { apiError, sameOrigin } from "@/server/http";
import { consumeLimit } from "@/server/rate-limit";
export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  const auth = await authorize(["ADMIN", "COUNSELOR"]);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    if (!await consumeLimit("grade-import", auth.user.id, 30)) throw new AccountError("操作频繁，请稍后重试", 429);
    const form = await boundedForm(request, 1024 * 1024), action = form.get("action"), termId = z.string().min(1).max(100).parse(form.get("termId"));
    let result: unknown;
    if (action === "commit") result = await commitGradeImport(auth.user.sessionId, termId, z.string().min(1).max(100).parse(form.get("id")));
    else {
      const file = form.get("file");
      if (!(file instanceof File)) throw new AccountError("请选择成绩文件");
      const bytes = Buffer.from(await file.arrayBuffer());
      const fileHash = createHash("sha256").update(bytes).digest("hex");
      const table = await parseAccountFile(file.name, bytes);
      if (action === "columns") result = { headers: table.headers, count: table.rows.length };
      else if (action === "preview") {
        let rawMapping: unknown;
        try {
          rawMapping = JSON.parse(String(form.get("mapping") ?? "{}"));
        } catch {
          throw new AccountError("列对应关系无效，请重新读取文件列");
        }
        const mapping = z.object({
          login: z.coerce.number().int().min(0).max(table.headers.length - 1),
          name: z.coerce.number().int().min(0).max(table.headers.length - 1),
          value: z.coerce.number().int().min(0).max(table.headers.length - 1),
        }).parse(rawMapping);
        if (new Set(Object.values(mapping)).size !== 3) throw new AccountError("学号、姓名、成绩必须分别对应不同的列");
        const optionalColumn = (header: string) => {
          const index = table.headers.findIndex((value) => value.trim() === header);
          return index < 0 ? null : index;
        };
        const collegeColumn = optionalColumn("学院");
        const majorColumn = optionalColumn("专业");
        const classNameColumn = optionalColumn("班级");
        const rows = table.rows.map((row, index) => {
          if (row[mapping.login]?.numeric) throw new AccountError(`第${index + 2}行学号必须为文本单元格`);
          return {
            login: row[mapping.login]?.value ?? "",
            name: row[mapping.name]?.value ?? "",
            college: collegeColumn == null ? "" : (row[collegeColumn]?.value ?? ""),
            major: majorColumn == null ? "" : (row[majorColumn]?.value ?? ""),
            className: classNameColumn == null ? "" : (row[classNameColumn]?.value ?? ""),
            value: row[mapping.value]?.value ?? "",
          };
        });
        result = await previewGradeImport(auth.user.sessionId, termId, { nodeId: form.get("nodeId"), rows, reason: form.get("reason") }, { fileHash, templateVersion: "grades-v4" });
      } else throw new AccountError("操作无效");
    }
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
