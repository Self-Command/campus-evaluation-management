import { authenticatedApi } from "@/server/route-handler";
import { adminTransaction, AccountError } from "@/server/accounts";
import { digest } from "@/server/publications";
export async function GET(request:Request,context:{params:Promise<{id:string}>}) { return authenticatedApi(request,["ADMIN"],sessionId => adminTransaction(sessionId,async tx => { const snapshot=await tx.settlementSnapshot.findUnique({where:{id:(await context.params).id}}); if(!snapshot) throw new AccountError("结算快照不存在",404); if(digest(snapshot.payload)!==snapshot.sha256) throw new AccountError("快照校验失败",500); return snapshot; })); }
