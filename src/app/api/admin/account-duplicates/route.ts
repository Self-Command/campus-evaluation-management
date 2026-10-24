import { NextResponse } from "next/server";
import { authorize } from "@/server/authorization";
import {
	disableDuplicateAccount,
	listDuplicateGroups,
} from "@/server/account-duplicates";
import { apiError, sameOrigin } from "@/server/http";
import { consumeLimit } from "@/server/rate-limit";

export async function GET() {
	const auth = await authorize(["ADMIN"]);
	if ("error" in auth)
		return NextResponse.json({ error: auth.error }, { status: auth.status });
	try {
		return NextResponse.json(
			await listDuplicateGroups(auth.user.sessionId),
			{ headers: { "Cache-Control": "no-store" } },
		);
	} catch (error) {
		return apiError(error);
	}
}

export async function POST(request: Request) {
	if (!sameOrigin(request))
		return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
	const auth = await authorize(["ADMIN"]);
	if ("error" in auth)
		return NextResponse.json({ error: auth.error }, { status: auth.status });
	try {
		if (!(await consumeLimit("account-duplicate", auth.user.id, 20)))
			return NextResponse.json(
				{ error: "操作频繁，请稍后重试" },
				{ status: 429 },
			);
		return NextResponse.json(
			await disableDuplicateAccount(
				auth.user.sessionId,
				await request.json(),
			),
			{ headers: { "Cache-Control": "no-store" } },
		);
	} catch (error) {
		return apiError(error);
	}
}
