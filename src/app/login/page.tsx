import { publicSettings } from "@/server/settings";
import Image from "next/image";
// Adapted directly from Studio Admin auth/v1/login/page.tsx (MIT).
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/server/auth";

import { Command } from "lucide-react";

import { LoginForm } from "./_components/login-form";
import { Feedback } from "@/components/dashboard/feedback";

export default async function LoginV1({ searchParams }: { searchParams: Promise<{ changed?: string }> }) {
  const session = await getServerSession(authOptions);
  if (session?.user) redirect(session.user.mustChangePassword ? "/change-password" : "/");
  const brand = await publicSettings();
  const changed = (await searchParams).changed;
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

      <div className="flex w-full items-center justify-center bg-background p-8 lg:w-2/3">
        <div className="flex w-full max-w-md flex-col gap-10 py-24 lg:py-32">
          <div className="flex flex-col gap-4 text-center">
            <h1 className="font-medium tracking-tight">登录</h1>
            <div className="mx-auto max-w-xl text-muted-foreground">欢迎回来。请输入学校分配的学号或账号及密码。</div>
          </div>
          <div className="flex flex-col gap-4">
            {changed && <Feedback success="密码已更新，请使用新密码登录。" />}
            <LoginForm />
            <p className="text-center text-muted-foreground text-xs">
              账号由学校统一分配。如忘记密码，请联系管理员重置。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
