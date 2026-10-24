import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { authorize } from "@/server/authorization";
import { AccountError } from "@/server/accounts";
import { previewAccountImport, commitAccountImport, importFieldsFor, type ImportRow } from "@/server/account-import";
import { parseAccountFile } from "@/server/spreadsheet";
import { apiError, sameOrigin } from "@/server/http";
import { consumeLimit } from "@/server/rate-limit";
import { parseAccountImportRole, templateFor } from "@/lib/imports/templates";

import { boundedForm } from "@/server/upload-form";
const mappingSchema = z.record(z.string(), z.number().int().min(0).max(29));
export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  const auth = await authorize(["ADMIN"]);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    if (!await consumeLimit("account-import", auth.user.id, 20)) return NextResponse.json({ error: "操作频繁，请稍后重试" }, { status: 429 });
    const form = await boundedForm(request, 1024 * 1024);
    const action = form.get("action");
    let result: unknown;
    if (action === "commit") {
      const id = z.string().min(1).max(100).parse(form.get("id"));
      let resolutions: unknown = [];
      try {
        resolutions = JSON.parse(String(form.get("resolutions") ?? "[]"));
      } catch {
        throw new AccountError("疑似重复处理方式无效，请重新预览");
      }
      result = await commitAccountImport(auth.user.sessionId, id, { resolutions });
    } else {
      const file = form.get("file");
      if (!(file instanceof File)) throw new AccountError("请选择名单文件");
      const bytes = Buffer.from(await file.arrayBuffer());
      const fileHash = createHash("sha256").update(bytes).digest("hex");
      const table = await parseAccountFile(file.name, bytes);
      if (action === "columns") result = { headers: table.headers, sample: table.rows.slice(0, 3).map(row => row.map(cell => cell.value)), count: table.rows.length };
      else if (action === "preview") {
        const role = parseAccountImportRole(form.get("role") as string | null);
        const fields = importFieldsFor(role);
        const note = z.string().trim().min(2).max(500).parse(form.get("note"));
        const rawMapping = mappingSchema.parse(JSON.parse(String(form.get("mapping"))));
        const mapping = Object.fromEntries(fields.map(field => {
          const index = rawMapping[field];
          if (index === undefined) throw new AccountError("字段映射不完整，请重新选择列");
          return [field, index];
        })) as Record<string, number>;
        if (new Set(Object.values(mapping)).size !== fields.length) throw new AccountError("每个字段需选择不同的列");
        if (Object.values(mapping).some(index => index >= table.headers.length)) throw new AccountError("表格列选择无效，请重新读取文件列");
        const rows = table.rows.map(row => {
          if (row[mapping.login]?.numeric) throw new AccountError(role === "STUDENT" ? "学号列必须使用文本单元格，避免前导零或长数字丢失" : "登录账号列必须使用文本单元格，避免长数字丢失");
          return Object.fromEntries(fields.map(field => [field, row[mapping[field]]?.value ?? ""])) as ImportRow;
        });
        result = await previewAccountImport(auth.user.sessionId, { rows, targetRole: role, note, fileHash, templateVersion: templateFor("accounts", role).version });
      } else throw new AccountError("操作无效");
    }
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
