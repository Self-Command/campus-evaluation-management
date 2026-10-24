import { publicSettings } from "@/server/settings";
// Adapted from Studio Admin auth/v1/login/page.tsx (MIT) and the approved
// full-screen authentication shell design.
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/server/auth";

import { LoginForm } from "./_components/login-form";
import { Feedback } from "@/components/dashboard/feedback";
import { AuthShell } from "@/components/auth/auth-shell";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ changed?: string }> }) {
  const session = await getServerSession(authOptions);
  if (session?.user) redirect(session.user.mustChangePassword ? "/change-password" : "/");
  const brand = await publicSettings();
  const changed = (await searchParams).changed;
  return (
    <AuthShell
      brand={brand}
      title="欢迎登录"
      description="输入学校分配的学号或账号及密码，进入综合测评工作台。"
      footerNote="账号由学校统一分配。如忘记密码，请联系管理员重置。"
    >
      {changed && <Feedback success="密码已更新，请使用新密码登录。" />}
      <LoginForm />
    </AuthShell>
  );
}
