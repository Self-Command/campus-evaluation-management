import type { ReactNode } from "react";
import Image from "next/image";
import { GraduationCap } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ThemePicker } from "@/components/dashboard/theme-picker";
import { authGlassStyle, type AuthGlowTone } from "@/lib/auth-glass";
import type { ThemeMode, ThemePreset } from "@/lib/preferences/theme";

type AuthBrand = {
  siteName: string;
  siteDescription: string;
  logoAssetId: string | null;
  logoSize: number;
  loginBackgroundAssetId: string | null;
  loginNotice: string;
  loginCardBlur: number;
  loginCardOpacity: number;
  loginCardSaturation: number;
  loginCardGlow: number;
  loginCardGlowTone: AuthGlowTone;
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
      <header className="relative z-10 flex items-center justify-between gap-4 px-5 py-4 sm:px-8">
        <div className="flex min-w-0 items-center gap-3">
          {brand.logoAssetId ? (
            // Natural aspect ratio matters for wide wordmarks; next/image would
            // force the square width/height ratio declared at build time.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/brand-assets/${brand.logoAssetId}`}
              alt={brand.siteName}
              style={{ maxHeight: `min(${brand.logoSize}px, 18vh)`, width: "auto" }}
              className="h-auto w-auto max-w-[min(62vw,26rem)] shrink-0 object-contain"
            />
          ) : (
            <>
              <GraduationCap className={`size-8 shrink-0 ${foreground}`} />
              <div className="grid min-w-0">
                <span className={`truncate text-base font-semibold ${foreground}`}>{brand.siteName}</span>
                <span className={`hidden truncate text-xs sm:block ${muted}`}>{brand.siteDescription}</span>
              </div>
            </>
          )}
        </div>
        <ThemePicker
          siteDefaults={{ themePreset: brand.themePreset, themeMode: brand.defaultThemeMode }}
          imageBackground={hasImage}
        />
      </header>
      <main className="relative z-10 flex flex-1 items-center justify-center px-4 py-4 sm:py-6">
        <div
          className="auth-glass-scope relative w-full max-w-[27rem]"
          data-auth-glow-tone={brand.loginCardGlowTone}
          style={authGlassStyle(brand)}
        >
          <div aria-hidden className="auth-glass-aurora" />
          <Card className="auth-glass-card relative z-10 w-full gap-5 rounded-2xl py-6 ring-0 sm:py-7">
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
        </div>
      </main>
      <footer className={`relative z-10 px-5 py-4 text-center text-xs sm:px-8 ${muted}`}>
        {brand.siteName} · {brand.siteDescription}
      </footer>
    </div>
  );
}
