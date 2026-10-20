import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Feedback } from "./feedback";
export function RemoteState({ loading, error, reload }: { loading: boolean; error: string; reload: () => void }) {
  return (
    <>
      {loading && (
        <div className="flex flex-col gap-3" role="status" aria-label="正在读取">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-32 w-full" />
        </div>
      )}
      {error && (
        <div className="flex flex-col gap-3">
          <Feedback error={error} />
          <Button variant="outline" className="self-start" onClick={reload}>
            重试
          </Button>
        </div>
      )}
    </>
  );
}
