import type { ReactNode } from "react";
import Image from "next/image";
import { GraduationCap } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ThemePicker } from "@/components/dashboard/theme-picker";
import type { ThemeMode, ThemePreset } from "@/lib/preferences/theme";

type AuthBrand = {
  siteName: string;
  siteDescription: string;
  logoAssetId: string | null;
  logoSize: number;
  loginBackgroundAssetId: string | null;
  loginNotice: string;
  themePreset: ThemePreset;
  defaultThemeMode: ThemeMode;
};

export function AuthShell({
  brand,
  title,
  description,
  children,
  footerNote,
}: {
  brand: AuthBrand;
  title: string;
  description: string;
  children: ReactNode;
  footerNote?: ReactNode;
}) {
  const hasImage = !!brand.loginBackgroundAssetId;
  const foreground = hasImage ? "text-white" : "text-foreground";
  const muted = hasImage ? "text-white/75" : "text-muted-foreground";
  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden">
      <div aria-hidden className="absolute inset-0 z-0">
        {hasImage ? (
          <>
            <Image
              src={`/api/brand-assets/${brand.loginBackgroundAssetId}`}
              alt=""
              fill
              priority
              unoptimized
              sizes="100vw"
              className="object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/30 to-black/65" />
          </>
        ) : (
          <div className="auth-default-background absolute inset-0" />
        )}
      </div>
      <header className="relative z-10 flex items-center justify-between gap-4 px-5 py-5 sm:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <div className={`flex shrink-0 items-center justify-center rounded-xl p-1.5 ring-1 ${hasImage ? "bg-white/10 ring-white/20" : "bg-background/70 ring-foreground/10"}`}>
            {brand.logoAssetId ? (
              <Image
                src={`/api/brand-assets/${brand.logoAssetId}`}
                alt=""
                width={brand.logoSize}
                height={brand.logoSize}
                unoptimized
                style={{ width: brand.logoSize, height: brand.logoSize }}
                className="object-contain"
              />
            ) : (
              <GraduationCap className={`size-8 ${foreground}`} />
            )}
          </div>
          <div className="grid min-w-0">
            <span className={`truncate text-base font-semibold ${foreground}`}>{brand.siteName}</span>
            <span className={`hidden truncate text-xs sm:block ${muted}`}>{brand.siteDescription}</span>
          </div>
        </div>
        <ThemePicker
          siteDefaults={{ themePreset: brand.themePreset, themeMode: brand.defaultThemeMode }}
          imageBackground={hasImage}
        />
      </header>
      <main className="relative z-10 flex flex-1 items-center justify-center px-4 py-8 sm:py-10">
        <Card className="w-full max-w-[27rem] gap-5 rounded-2xl bg-card/95 py-6 shadow-2xl ring-1 ring-foreground/10 backdrop-blur-xl sm:py-7">
          <CardHeader className="gap-1.5 px-6 text-center sm:px-8">
            <span className="text-xs font-medium tracking-[0.2em] text-muted-foreground">统一登录</span>
            <CardTitle className="text-2xl tracking-tight">{title}</CardTitle>
            <CardDescription className="text-balance">{description}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5 px-6 sm:px-8">
            {brand.loginNotice && (
              <p className="whitespace-pre-wrap rounded-lg border bg-muted/60 px-3 py-2.5 text-sm leading-relaxed text-foreground">
                {brand.loginNotice}
              </p>
            )}
            {children}
            {footerNote && <div className="text-center text-xs leading-relaxed text-muted-foreground">{footerNote}</div>}
          </CardContent>
        </Card>
      </main>
      <footer className={`relative z-10 px-5 py-5 text-center text-xs sm:px-8 ${muted}`}>
        {brand.siteName} · {brand.siteDescription}
      </footer>
    </div>
  );
}
