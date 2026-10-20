import { Skeleton } from "@/components/ui/skeleton";
export default function Loading() {
  return (
    <div aria-label="正在加载" className="flex flex-col gap-6">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-5 w-64" />
      <Skeleton className="h-80 w-full" />
    </div>
  );
}
