import { NextResponse } from "next/server";
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
  const auth = await authorize(["ADMIN"]);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    if (!await consumeLimit("grade-import", auth.user.id, 30)) throw new AccountError("操作频繁，请稍后重试", 429);
    const form = await boundedForm(request), action = form.get("action"), termId = z.string().min(1).max(100).parse(form.get("termId"));
    let result: unknown;
    if (action === "commit") result = await commitGradeImport(auth.user.sessionId, termId, z.string().min(1).max(100).parse(form.get("id")));
    else {
      const file = form.get("file");
      if (!(file instanceof File)) throw new AccountError("请选择成绩文件");
      const table = await parseAccountFile(file.name, Buffer.from(await file.arrayBuffer()));
      if (action === "columns") result = { headers: table.headers, count: table.rows.length };
      else if (action === "preview") {
        const column = z.coerce.number().int().min(0).max(table.headers.length - 1).parse(form.get("column"));
        const valueColumn = z.coerce.number().int().min(0).max(table.headers.length - 1).parse(form.get("valueColumn"));
        if (column === valueColumn) throw new AccountError("学号与成绩必须对应不同列");
        const rows = table.rows.map((row, index) => {
          if (row[column]?.numeric) throw new AccountError(`第${index + 2}行学号必须为文本单元格`);
          return { login: row[column]?.value ?? "", value: row[valueColumn]?.value ?? "" };
        });
        result = await previewGradeImport(auth.user.sessionId, termId, { nodeId: form.get("nodeId"), rows, reason: form.get("reason") });
      } else throw new AccountError("操作无效");
    }
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
