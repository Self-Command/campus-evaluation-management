import Link from "next/link";
import { MeasurementEmpty } from "@/components/dashboard/measurement-empty";
import { notFound } from "next/navigation";
import { pageSession } from "@/server/page-session";
import { measurementContext } from "@/lib/measurement-context";
import { NoData, PageHeading } from "@/components/dashboard/page-heading";
import { TermContext } from "@/components/dashboard/term-context";
import { buttonVariants } from "@/components/ui/button";
import { Rankings } from "./_components/rankings";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{
    termId?: string;
    publicationId?: string;
    college?: string;
    major?: string;
    className?: string;
    page?: string;
  }>;
}) {
  const user = await pageSession();
  if (user.role !== "ADMIN") notFound();
  const p = await searchParams;
  const { terms, term } = await measurementContext(user.sessionId, p.termId);
  const publicationId = p.publicationId || term?.publishedResultSetId || "";
  return (
    <>
      <PageHeading title="排名与导出" description="按已发布结果查看排名；导出全校成绩明细，按学院、专业、班级顺序排列。" />
      <TermContext terms={terms} selected={term?.id} />
      {term && publicationId ? (
        <Rankings
          key={JSON.stringify(p)}
          termId={term.id}
          filters={{
            publicationId,
            college: p.college || "",
            major: p.major || "",
            className: p.className || "",
            page: Math.max(1, Math.min(100000, Number(p.page) || 1)),
          }}
        />
      ) : term ? (
        <div className="flex flex-col items-center gap-3">
          <NoData
            title="本周期尚未发布结果"
            description="发布当前周期的测评结果后，这里会按发布版本显示排名，并可导出全校成绩明细表。"
          />
          <Link href={`/publication?termId=${term.id}`} className={buttonVariants()}>
            前往结果发布
          </Link>
        </div>
      ) : (
        <MeasurementEmpty admin={user.role === "ADMIN"} />
      )}
    </>
  );
}
