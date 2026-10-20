import { authenticatedApi } from "@/server/route-handler";
import { uploadBrandAsset } from "@/server/settings";
import { AccountError } from "@/server/accounts";
export async function POST(request:Request) { return authenticatedApi(request,["ADMIN"],async sessionId => { const length=Number(request.headers.get("content-length")); if(length>1024*1024) throw new AccountError("品牌图片须在1MB以内",413); const reader=request.body?.getReader(); if(!reader) throw new AccountError("请选择图片"); const chunks:Uint8Array[]=[]; let size=0; while(true) { const {done,value}=await reader.read(); if(done) break; size+=value.length; if(size>1024*1024){await reader.cancel();throw new AccountError("品牌图片须在1MB以内",413);} chunks.push(value); } return uploadBrandAsset(sessionId,Buffer.concat(chunks)); },true); }
