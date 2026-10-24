import { publicSettings } from "@/server/settings";
// Adapted from the approved authentication shell and the existing password form.
import Link from "next/link";
import { pageSession } from "@/server/page-session";
import { AuthForm } from "@/components/dashboard/auth-form";
import { AuthShell } from "@/components/auth/auth-shell";
export default async function Page() {
  const user = await pageSession(true);
  const brand = await publicSettings();
  return (
    <AuthShell
      brand={brand}
      title={user.mustChangePassword ? "设置新密码" : "修改密码"}
      description={
        user.mustChangePassword
          ? "首次登录或密码重置后，请先设置新密码。"
          : "修改后将退出所有已登录会话，请重新登录。"
      }
    >
      <AuthForm change />
      {!user.mustChangePassword && (
        <div className="text-center">
          <Link href="/" className="text-sm underline underline-offset-4">
            返回工作台
          </Link>
        </div>
      )}
    </AuthShell>
  );
}
