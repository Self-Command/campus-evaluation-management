import { publicSettings } from "@/server/settings";
import Image from "next/image";
// Adapted from auth/v1/login/page.tsx and auth/_components/login-form.tsx.
import Link from "next/link";
import { Command } from "lucide-react";
import { pageSession } from "@/server/page-session";
import { AuthForm } from "@/components/dashboard/auth-form";
export default async function Page() {
  const user = await pageSession(true);
  const brand = await publicSettings();
  return (
    <div className="flex min-h-dvh">
      <div className="hidden bg-primary lg:block lg:w-1/3">
        <div className="flex h-full flex-col items-center justify-center p-12 text-center">
          <div className="flex flex-col gap-6">
            {brand.logoAssetId ? (
              <Image
                src={`/api/brand-assets/${brand.logoAssetId}`}
                alt=""
                width={64}
                height={64}
                unoptimized
                className="mx-auto size-16 object-contain"
              />
            ) : (
              <Command className="mx-auto size-12 text-primary-foreground" />
            )}
            <div className="flex flex-col gap-2">
              <h1 className="font-light text-5xl text-primary-foreground">{brand.siteName}</h1>
              <p className="text-primary-foreground/80 text-xl">{brand.siteDescription}</p>
            </div>
          </div>
        </div>
      </div>
      <div className="flex w-full items-center justify-center bg-background p-6 sm:p-8 lg:w-2/3">
        <div className="flex w-full max-w-md flex-col gap-10 py-12 lg:py-24">
          <div className="flex flex-col gap-4 text-center">
            <h1 className="font-medium tracking-tight">{user.mustChangePassword ? "设置新密码" : "修改密码"}</h1>
            <div className="mx-auto max-w-xl text-muted-foreground">
              {user.mustChangePassword
                ? "首次登录或密码重置后，请先设置新密码。"
                : "修改后将退出所有已登录会话，请重新登录。"}
            </div>
          </div>
          <div className="flex flex-col gap-4">
            <AuthForm change />
            {!user.mustChangePassword && (
              <Link href="/" className="text-center text-sm underline underline-offset-4">
                返回工作台
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
