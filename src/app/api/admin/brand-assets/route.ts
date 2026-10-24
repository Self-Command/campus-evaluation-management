import { authenticatedApi } from "@/server/route-handler";
import { uploadBrandAsset, type BrandAssetKind } from "@/server/settings";
import { AccountError } from "@/server/accounts";
export async function POST(request: Request) {
  return authenticatedApi(request, ["ADMIN"], async sessionId => {
    const requested = request.headers.get("x-asset-kind") ?? "brand";
    if (requested !== "brand" && requested !== "login-background") throw new AccountError("图片用途无效");
    const kind = requested as BrandAssetKind;
    const maxBytes = kind === "login-background" ? 5 * 1024 * 1024 : 1024 * 1024;
    const label = kind === "login-background" ? "登录页背景" : "品牌图片";
    const length = Number(request.headers.get("content-length"));
    if (length > maxBytes) throw new AccountError(`${label}须在${maxBytes / 1024 / 1024}MB以内`, 413);
    const reader = request.body?.getReader();
    if (!reader) throw new AccountError("请选择图片");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) { await reader.cancel(); throw new AccountError(`${label}须在${maxBytes / 1024 / 1024}MB以内`, 413); }
      chunks.push(value);
    }
    return uploadBrandAsset(sessionId, Buffer.concat(chunks), kind);
  }, true);
}
