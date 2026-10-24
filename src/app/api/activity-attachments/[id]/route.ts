import { NextResponse } from "next/server";
import { authorize } from "@/server/authorization";
import { apiError, sameOrigin } from "@/server/http";
import { deleteActivityAttachment, downloadActivityAttachment } from "@/server/activity-attachments";

const roles = ["ADMIN", "COLLEGE", "PUBLISHER", "COUNSELOR", "STUDENT"] as const;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
	const auth = await authorize([...roles]);
	if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
	try {
		const { id } = await params;
		const { file, bytes } = await downloadActivityAttachment(auth.user.sessionId, id);
		const inline = file.mime.startsWith("image/") || file.mime === "application/pdf";
		return new Response(new Uint8Array(bytes), {
			headers: {
				"Content-Type": file.mime,
				"Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
				"X-Content-Type-Options": "nosniff",
				"Cache-Control": "private, no-store",
			},
		});
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
