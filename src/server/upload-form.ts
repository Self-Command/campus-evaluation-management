import { AccountError } from "@/server/accounts";

export async function boundedForm(request: Request, maxBytes = 1024 * 1024) {
	const reader = request.body?.getReader();
	if (!reader) throw new AccountError("请选择名单文件");
	const chunks: Uint8Array[] = [];
	let size = 0;
	// Multipart boundaries and headers are not part of the declared file limit.
	const overhead = 256 * 1024;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > maxBytes + overhead) {
				await reader.cancel();
				throw new AccountError(
					`文件需为${Math.round(maxBytes / (1024 * 1024))}MB以内`,
				);
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	return new Response(Buffer.concat(chunks), {
		headers: { "Content-Type": request.headers.get("content-type") ?? "" },
	}).formData();
}
