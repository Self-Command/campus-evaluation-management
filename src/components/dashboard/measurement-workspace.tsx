"use client";
// Complete dashboard/profile/page.tsx tab workspace, with retained full-width scrolling tabs and padded content panels.
import type { ReactNode } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { hasUnsavedChanges } from "./use-unsaved-changes";
export function MeasurementWorkspace({
  tabs,
  active,
  termId,
}: {
  tabs: { id: string; label: string; content: ReactNode }[];
  active?: string;
  termId: string;
}) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const value = tabs.some((tab) => tab.id === active) ? active! : tabs[0].id;
  return (
    <div className="flex min-w-0 max-w-full flex-col gap-4 py-4">
      <Tabs
        className="min-h-0 min-w-0 max-w-full flex-1 gap-0"
        value={value}
        onValueChange={(next) => {
          if (hasUnsavedChanges() && !window.confirm("切换工作区将离开尚未保存的内容，是否继续？")) return;
          const query = new URLSearchParams(params);
          query.set("termId", termId);
          query.set("tab", String(next));
          query.delete("page");
          query.delete("status");
          router.replace(`${path}?${query}`, { scroll: false });
        }}
      >
        <div className="scrollbar-none touch-pan-x overflow-x-auto overscroll-x-contain border-y">
          <TabsList
            className="w-max min-w-full justify-start gap-4 *:data-[slot=tabs-trigger]:flex-none"
            variant="line"
          >
            {tabs.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <div className="min-w-0 max-w-full">
          {tabs.map((tab) => (
            <TabsContent key={tab.id} className="flex flex-col gap-5 py-4" value={tab.id}>
              {tab.content}
            </TabsContent>
          ))}
        </div>
      </Tabs>
    </div>
  );
}
