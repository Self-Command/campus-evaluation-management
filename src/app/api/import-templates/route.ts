import { NextResponse } from "next/server";
import { authorize } from "@/server/authorization";
import { apiError } from "@/server/http";
import { resolveImportTemplate } from "@/server/import-templates";
import {
	importRoles,
	parseImportKind,
	templateCsv,
} from "@/lib/imports/templates";

export async function GET(request: Request) {
	const url = new URL(request.url);
	const kind = parseImportKind(url.searchParams.get("kind"));
	if (!kind)
		return NextResponse.json({ error: "模板类型无效" }, { status: 400 });
	const auth = await authorize(importRoles[kind]);
	if ("error" in auth)
		return NextResponse.json({ error: auth.error }, { status: auth.status });
	try {
		const template = await resolveImportTemplate(auth.user.sessionId, kind, {
			termId: url.searchParams.get("termId"),
			nodeId: url.searchParams.get("nodeId"),
			activityId: url.searchParams.get("activityId"),
			accountRole: url.searchParams.get("role"),
		});
		return new Response(templateCsv(template), {
			headers: {
				"Content-Type": "text/csv; charset=utf-8",
				"Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(template.name)}`,
				"X-Import-Template-Version": template.version,
				"Cache-Control": "private, no-store",
			},
		});
	} catch (error) {
		return apiError(error);
	}
}
