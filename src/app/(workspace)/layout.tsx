import { publicSettings } from "@/server/settings";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { cn } from "cn";
import { pageSession } from "@/server/page-session";
import { AppSidebar } from "@/components/dashboard/app-sidebar";
import { HeaderControls } from "@/components/dashboard/header-controls";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { roleLabels } from "@/lib/business-labels";
export default async function Layout({ children }: Readonly<{ children: ReactNode }>) {
  const user = await pageSession();
  const settings = await publicSettings();
  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get("sidebar_state")?.value !== "false";
  return (
    <SidebarProvider
      defaultOpen={defaultOpen}
      style={{ "--sidebar-width": "calc(var(--spacing) * 68)" } as React.CSSProperties}
    >
      <AppSidebar user={user} brand={settings} />
      <SidebarInset
        className={cn(
          "[html[data-content-layout=centered]_&>*]:mx-auto",
          "[html[data-content-layout=centered]_&>*]:w-full",
          "[html[data-content-layout=centered]_&>*]:max-w-screen-2xl",
          "peer-data-[variant=inset]:border",
          "[--dashboard-header-height:--spacing(12)]",
          "min-w-0 max-w-full",
        )}
      >
        <header
          className={cn(
            "flex h-12 shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12",
            "[html[data-navbar-style=sticky]_&]:sticky [html[data-navbar-style=sticky]_&]:top-0 [html[data-navbar-style=sticky]_&]:z-50 [html[data-navbar-style=sticky]_&]:overflow-hidden [html[data-navbar-style=sticky]_&]:rounded-t-[inherit] [html[data-navbar-style=sticky]_&]:bg-background/50 [html[data-navbar-style=sticky]_&]:backdrop-blur-md",
          )}
        >
          <div className="flex w-full items-center justify-between px-4 lg:px-6">
            <div className="flex min-w-0 items-center gap-1 lg:gap-2">
              <SidebarTrigger className="-ml-1" aria-label="展开或收起导航" />
              <Separator
                orientation="vertical"
                className="mx-2 data-[orientation=vertical]:h-4 data-[orientation=vertical]:self-center"
              />
              <span className="truncate text-sm">{settings.siteName}</span>
              <span className="hidden text-xs text-muted-foreground sm:inline">{roleLabels[user.role]}</span>
            </div>
            <div className="flex items-center gap-2">
              <HeaderControls />
            </div>
          </div>
        </header>
        <main id="main-content" className="min-h-0 min-w-0 flex-1 p-4 md:p-6">
          <div className="flex min-w-0 max-w-full flex-col gap-6 [&>*]:min-w-0 [&>*]:max-w-full">{children}</div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
