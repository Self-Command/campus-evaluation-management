import { authenticatedApi } from "@/server/route-handler";
import { getStudentResult } from "@/server/results";
import { getCurrentSession } from "@/server/auth";
import { AccountError } from "@/server/accounts";
import { db } from "@/server/db";
import { z } from "zod";
export async function GET(request: Request) { return authenticatedApi(request, ["ADMIN","STUDENT"], async sessionId => {
  const q = new URL(request.url).searchParams, termId = z.string().min(1).max(100).parse(q.get("termId"));
  const actor = await getCurrentSession(sessionId); if (!actor) throw new AccountError("请重新登录",401);
  const login = z.string().trim().max(64).parse(q.get("studentLogin") || "");
  if (actor.user.role === "STUDENT" && login && login !== actor.user.login) throw new AccountError("只能查看本人测评结果",403);
  const target = actor.user.role === "ADMIN" ? await db.user.findUnique({where:{login},select:{id:true}}) : null;
  if (actor.user.role === "ADMIN" && !target) throw new AccountError("请选择有效学生学号",404);
  return getStudentResult(sessionId,termId,target?.id);
}); }
