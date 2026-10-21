import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authOptions, changePassword } from "@/server/auth";
import { consumeLimit } from "@/server/rate-limit";
import { sameOrigin } from "@/server/http";
export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "请重新登录" }, { status: 401 });
  if (!(await consumeLimit("password-change", session.user.id, 10))) return NextResponse.json({ error: "尝试过于频繁，请15分钟后重试" }, { status: 429 });
  const data = z.object({ currentPassword: z.string().min(1).max(128), newPassword: z.string().min(12).max(72).regex(/[A-Za-z]/).regex(/[0-9]/).refine(v => Buffer.byteLength(v, "utf8") <= 72) }).safeParse(await request.json().catch(() => null));
  if (!data.success) return NextResponse.json({ error: "新密码需为12–72位，包含字母和数字，UTF-8长度不超过72字节" }, { status: 400 });
  const ok = await changePassword(session.user.sessionId, data.data.currentPassword, data.data.newPassword);
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "当前密码不正确、新旧密码相同或会话已失效" }, { status: 400 });
}
