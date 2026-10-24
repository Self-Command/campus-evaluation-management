import { NextResponse } from "next/server";
import { authorize } from "@/server/authorization";
import { apiError, sameOrigin } from "@/server/http";
import { AccountError } from "@/server/accounts";
import { attachmentLimits, uploadActivityAttachment } from "@/server/activity-attachments";
import { consumeLimit } from "@/server/rate-limit";

export async function POST(request: Request) {
	if (!sameOrigin(request)) return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
	const auth = await authorize(["ADMIN", "COLLEGE", "PUBLISHER"]);
	if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
	try {
		if (!(await consumeLimit("activity-attachment-upload", auth.user.id, 60)))
			return NextResponse.json({ error: "上传频繁，请稍后重试" }, { status: 429 });
		const limits = await attachmentLimits();
		const reader = request.body?.getReader();
		if (!reader) throw new AccountError("请选择附件");
		const chunks: Uint8Array[] = [];
		let size = 0;
		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				size += value.length;
				if (size > limits.maxBytes) {
					await reader.cancel();
					throw new AccountError(`单个附件不能超过 ${limits.maxSizeMb}MB`);
				}
				chunks.push(value);
			}
		} finally {
			reader.releaseLock();
		}
		const name = decodeURIComponent(request.headers.get("x-file-name") ?? "附件");
		const activityId = request.headers.get("x-activity-id") || undefined;
		const result = await uploadActivityAttachment(auth.user.sessionId, name, Buffer.concat(chunks), activityId);
		return NextResponse.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
	} catch (error) {
		return apiError(error);
	}
}
