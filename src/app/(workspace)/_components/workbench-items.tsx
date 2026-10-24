import Link from "next/link";
import type { WorkbenchData } from "@/server/workbench";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { dateText, statusLabels } from "@/lib/business-labels";
type WorkItem = Extract<WorkbenchData, { role: "ADMIN" }>["reviewQueue"][number];
function workItemStatus(item: WorkItem) {
  if (item.kind === "ACTIVITY" && item.status === "PENDING_COUNSELOR") return "待辅导员核对";
  if (item.kind === "CLAIM" && item.status === "PENDING_COUNSELOR") return "待辅导员评分";
  return statusLabels[item.status] || item.status;
}
// productivity/_components/tasks-section.tsx: retained divided rows, responsive title/status/time grouping.
export function WorkbenchItems({
  items,
  emptyTitle,
  emptyDescription,
}: {
  items: WorkItem[];
  emptyTitle: string;
  emptyDescription: string;
}) {
  return items.length ? (
    <div className="flex min-w-0 flex-col divide-y">
      {items.map((item) => (
        <Link
          key={`${item.kind}-${item.id}`}
          href={item.href}
          className="flex min-w-0 items-center gap-2 py-4 hover:bg-muted/30"
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex min-w-0 flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="break-words font-medium text-sm">{item.title}</span>
                  <Badge variant="outline">{workItemStatus(item)}</Badge>
                </div>
                <p className="break-words text-sm text-muted-foreground">{item.description}</p>
              </div>
              <time dateTime={item.at.toISOString()} className="shrink-0 text-xs text-muted-foreground">
                {dateText(item.at)}
              </time>
            </div>
          </div>
        </Link>
      ))}
    </div>
  ) : (
    <Empty className="min-h-36 p-5">
      <EmptyHeader>
        <EmptyTitle>{emptyTitle}</EmptyTitle>
        <EmptyDescription>{emptyDescription}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
