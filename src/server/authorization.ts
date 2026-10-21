import { getServerSession } from "next-auth";
import { authOptions } from "@/server/auth";
import type { Role } from "@/generated/prisma/client";
export async function authorize(roles: Role[], allowPasswordChange = false) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: "请重新登录", status: 401 } as const;
  if (!allowPasswordChange && session.user.mustChangePassword) return { error: "请先修改初始密码", status: 403 } as const;
  if (!roles.includes(session.user.role)) return { error: "没有访问权限", status: 403 } as const;
  return { user: session.user } as const;
}
