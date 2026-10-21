import { NextResponse } from "next/server";
import { z } from "zod";
import { authorize } from "@/server/authorization";
import { AccountError } from "@/server/accounts";
import {
	previewParticipationImport,
	commitParticipationImport,
	type ParticipationImportRow,
} from "@/server/participation-import";
import { parseAccountFile } from "@/server/spreadsheet";
import { boundedForm } from "@/server/upload-form";
import { apiError, sameOrigin } from "@/server/http";
import { consumeLimit } from "@/server/rate-limit";

const requiredHeaders = ["学号", "姓名", "学院", "专业", "班级"] as const;

function rowsFromTable(
	headers: string[],
	rows: { value: string; numeric: boolean }[][],
) {
	const index = new Map(headers.map((header, position) => [header, position]));
	const missing = requiredHeaders.filter((header) => !index.has(header));
	if (missing.length)
		throw new AccountError(`名单表头缺少：${missing.join("、")}`);
	const loginIndex = index.get("学号")!;
	const scoreIndex = index.get("活动原始分") ?? -1;
	return rows.map((row, line) => {
		if (row[loginIndex]?.numeric)
			throw new AccountError(`第${line + 2}行学号必须为文本单元格`);
		const cell = (header: (typeof requiredHeaders)[number]) =>
			row[index.get(header)!]?.value ?? "";
		const score = scoreIndex >= 0 ? (row[scoreIndex]?.value ?? "") : "";
		const parsed: ParticipationImportRow = {
			login: cell("学号"),
			name: cell("姓名"),
			college: cell("学院"),
			major: cell("专业"),
			className: cell("班级"),
			...(score ? { score } : {}),
		};
		return parsed;
	});
}

export async function POST(request: Request) {
	if (!sameOrigin(request))
		return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
	const auth = await authorize(["ADMIN", "PUBLISHER", "COLLEGE"]);
	if ("error" in auth)
		return NextResponse.json({ error: auth.error }, { status: auth.status });
	try {
		if (!(await consumeLimit("participation-import", auth.user.id, 30)))
			throw new AccountError("操作频繁，请稍后重试", 429);
		const form = await boundedForm(request),
			action = form.get("action");
		const termId = z.string().min(1).max(100).parse(form.get("termId"));
		let result: unknown;
		if (action === "commit")
			result = await commitParticipationImport(
				auth.user.sessionId,
				termId,
				z.string().min(1).max(100).parse(form.get("id")),
			);
		else {
			const file = form.get("file");
			if (!(file instanceof File)) throw new AccountError("请选择名单文件");
			const table = await parseAccountFile(
				file.name,
				Buffer.from(await file.arrayBuffer()),
				{ maxRows: 2000, maxBytes: 5 * 1024 * 1024 },
			);
			if (action === "columns")
				result = { headers: table.headers, count: table.rows.length };
			else if (action === "preview") {
				result = await previewParticipationImport(auth.user.sessionId, termId, {
					activityId: z.string().min(1).max(100).parse(form.get("activityId")),
					kind: form.get("kind") || "INITIAL",
					rows: rowsFromTable(table.headers, table.rows),
					note: form.get("note"),
					reason: form.get("reason") || undefined,
				});
			} else throw new AccountError("操作无效");
		}
		return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
	} catch (error) {
		return apiError(error);
	}
}
