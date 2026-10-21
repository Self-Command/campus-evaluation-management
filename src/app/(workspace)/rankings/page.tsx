import { MeasurementEmpty } from "@/components/dashboard/measurement-empty";
import { notFound } from "next/navigation";
import { pageSession } from "@/server/page-session";
import { measurementContext } from "@/lib/measurement-context";
import { PageHeading } from "@/components/dashboard/page-heading";
import { TermContext } from "@/components/dashboard/term-context";
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
  return (
    <>
      <PageHeading title="排名与导出" description="按已发布结果查看排名，并导出同一份名单。" />
      <TermContext terms={terms} selected={term?.id} />
      {term ? (
        <Rankings
          key={JSON.stringify(p)}
          termId={term.id}
          filters={{
            publicationId: p.publicationId || "",
            college: p.college || "",
            major: p.major || "",
            className: p.className || "",
            page: Math.max(1, Math.min(100000, Number(p.page) || 1)),
          }}
        />
      ) : (
        <MeasurementEmpty admin={user.role === "ADMIN"} />
      )}
    </>
  );
}
