"use client";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { GraduationCap, LogOut, ShieldCheck, ChevronsUpDown } from "lucide-react";
import { signOut } from "next-auth/react";
import { useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { navigation } from "@/navigation/sidebar/sidebar-items";
import { roleLabels, type AppRole } from "@/lib/business-labels";
import { usePreferencesStore } from "@/stores/preferences/preferences-provider";
import { NavMain } from "./nav-main";
export function AppSidebar({
  user,
  brand,
}: {
  user: { name?: string | null; role: AppRole };
  brand: { siteName: string; siteDescription: string; logoAssetId: string | null };
}) {
  const { isMobile, setOpenMobile } = useSidebar();
  const path = usePathname();
  const previous = useRef(path);
  useEffect(() => {
    if (previous.current !== path) {
      setOpenMobile(false);
      previous.current = path;
    }
  }, [path, setOpenMobile]);
  const { variant, collapsible } = usePreferencesStore(
    useShallow((s) => ({ variant: s.values.sidebar_variant, collapsible: s.values.sidebar_collapsible })),
  );
  return (
    <Sidebar variant={variant} collapsible={collapsible}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href={user.role === "COLLEGE" || user.role === "COUNSELOR" ? "/students" : "/"} />}>
              {brand.logoAssetId ? (
                <Image
                  src={`/api/brand-assets/${brand.logoAssetId}`}
                  alt=""
                  width={28}
                  height={28}
                  unoptimized
                  className="size-7 object-contain"
                />
              ) : (
                <GraduationCap />
              )}
              <div className="grid min-w-0 text-left">
                <span className="truncate text-base font-semibold">{brand.siteName}</span>
                <span className="truncate text-xs text-muted-foreground">{brand.siteDescription}</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent className="gap-4">
        <NavMain items={navigation(user.role)} />
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger render={<SidebarMenuButton size="lg" />}>
                <Avatar>
                  <AvatarFallback>{user.name?.slice(0, 1) || "用"}</AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left">
                  <span className="truncate font-medium">{user.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{roleLabels[user.role]}</span>
                </div>
                <ChevronsUpDown />
              </DropdownMenuTrigger>
              <DropdownMenuContent side={isMobile ? "top" : "right"} align="end" className="min-w-56">
                <DropdownMenuGroup>
                  <DropdownMenuItem render={<Link href="/account" />}>
                    <ShieldCheck />
                    个人资料与安全
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={() => void signOut({ callbackUrl: "/login" })}>
                    <LogOut />
                    退出登录
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
