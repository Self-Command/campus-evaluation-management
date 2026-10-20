import { publicSettings } from "@/server/settings";
import type { Metadata } from "next";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toast";
import { PreferencesStoreProvider } from "@/stores/preferences/preferences-provider";
import { PREFERENCE_DEFAULTS } from "@/lib/preferences/preferences-config";
import { ThemeBootScript } from "@/scripts/theme-boot";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const settings = await publicSettings();
  return {
    title: { default: settings.pageTitle, template: `%s · ${settings.siteName}` },
    description: settings.siteDescription,
    robots: { index: false, follow: false },
    icons: settings.faviconAssetId ? { icon: `/api/brand-assets/${settings.faviconAssetId}` } : undefined,
  };
}
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const settings = await publicSettings();
  return (
    <html
      lang="zh-CN"
      data-theme-mode="light"
      data-theme-preset={settings.themePreset}
      data-content-layout="centered"
      data-navbar-style="sticky"
      data-sidebar-variant="inset"
      data-sidebar-collapsible="icon"
      data-font="geist"
      suppressHydrationWarning
    >
      <head>
        <ThemeBootScript />
      </head>
      <body className="min-h-screen antialiased">
        <TooltipProvider>
          <PreferencesStoreProvider initialValues={{ ...PREFERENCE_DEFAULTS, theme_preset: settings.themePreset }}>
            {children}
            <Toaster />
          </PreferencesStoreProvider>
        </TooltipProvider>
      </body>
    </html>
  );
}
