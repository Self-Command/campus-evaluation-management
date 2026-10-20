import { NextResponse } from "next/server";
import { z } from "zod";
import { authorize } from "@/server/authorization";
import { AccountError } from "@/server/accounts";
import { previewAccountImport, commitAccountImport, importFields, type ImportRow } from "@/server/account-import";
import { parseAccountFile } from "@/server/spreadsheet";
import { apiError, sameOrigin } from "@/server/http";
import { consumeLimit } from "@/server/rate-limit";

import { boundedForm } from "@/server/upload-form";
const mappingSchema = z.object({ login: z.number().int().min(0).max(29), name: z.number().int().min(0).max(29), college: z.number().int().min(0).max(29), major: z.number().int().min(0).max(29), className: z.number().int().min(0).max(29) });
export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  const auth = await authorize(["ADMIN"]);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    if (!await consumeLimit("account-import", auth.user.id, 20)) return NextResponse.json({ error: "操作频繁，请稍后重试" }, { status: 429 });
    const form = await boundedForm(request);
    const action = form.get("action");
    let result: unknown;
    if (action === "commit") {
      const id = z.string().min(1).max(100).parse(form.get("id"));
      result = await commitAccountImport(auth.user.sessionId, id);
    } else {
      const file = form.get("file");
      if (!(file instanceof File)) throw new AccountError("请选择名单文件");
      const table = await parseAccountFile(file.name, Buffer.from(await file.arrayBuffer()));
      if (action === "columns") result = { headers: table.headers, sample: table.rows.slice(0, 3).map(row => row.map(cell => cell.value)), count: table.rows.length };
      else if (action === "preview") {
        const mapping = mappingSchema.parse(JSON.parse(String(form.get("mapping"))));
        if (new Set(Object.values(mapping)).size !== importFields.length) throw new AccountError("每个字段需选择不同的列");
        if (Object.values(mapping).some(index => index >= table.headers.length)) throw new AccountError("列映射无效");
        const rows = table.rows.map(row => {
          if (row[mapping.login]?.numeric) throw new AccountError("学号列必须使用文本单元格，避免前导零或长数字丢失");
          return Object.fromEntries(importFields.map(field => [field, row[mapping[field]]?.value ?? ""])) as ImportRow;
        });
        result = await previewAccountImport(auth.user.sessionId, rows);
      } else throw new AccountError("操作无效");
    }
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
