import { NextResponse } from "next/server";
import { authorize } from "@/server/authorization";
import { apiError, sameOrigin } from "@/server/http";
import {
	attachmentDownloadHeaders,
	attachmentEtagMatches,
	deleteActivityAttachment,
	describeActivityAttachment,
	downloadActivityAttachment,
} from "@/server/activity-attachments";

const roles = ["ADMIN", "COLLEGE", "PUBLISHER", "COUNSELOR", "STUDENT"] as const;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
	const auth = await authorize([...roles]);
	if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
	try {
		const { id } = await params;
		const { file: described } = await describeActivityAttachment(auth.user.sessionId, id);
		const headers = attachmentDownloadHeaders(described);
		if (attachmentEtagMatches(request.headers.get("if-none-match"), headers.ETag)) {
			return new Response(null, {
				status: 304,
				headers: {
					ETag: headers.ETag,
					"Cache-Control": headers["Cache-Control"],
					Vary: headers.Vary,
				},
			});
		}
		const { bytes } = await downloadActivityAttachment(auth.user.sessionId, id);
		return new Response(new Uint8Array(bytes), { headers });
	} catch (error) {
		return apiError(error);
	}
}

export async function HEAD(_request: Request, { params }: { params: Promise<{ id: string }> }) {
	const auth = await authorize([...roles]);
	if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
	try {
		const { id } = await params;
		const { file } = await describeActivityAttachment(auth.user.sessionId, id);
		return new Response(null, { headers: attachmentDownloadHeaders(file) });
	} catch (error) {
		return apiError(error);
	}
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
	if (!sameOrigin(request)) return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
	const auth = await authorize(["ADMIN", "COLLEGE", "PUBLISHER"]);
	if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
	try {
		const { id } = await params;
		await deleteActivityAttachment(auth.user.sessionId, id);
		return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
	} catch (error) {
		return apiError(error);
	}
}
