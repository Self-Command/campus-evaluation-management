import { AccountError } from "@/server/accounts";
export async function boundedForm(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new AccountError("请选择名单文件");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1100 * 1024) { await reader.cancel(); throw new AccountError("文件需为1MB以内"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return new Response(Buffer.concat(chunks), { headers: { "Content-Type": request.headers.get("content-type") ?? "" } }).formData();
}
