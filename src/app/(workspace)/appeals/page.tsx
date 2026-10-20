import { notFound } from "next/navigation";
import { pageSession } from "@/server/page-session";
import { measurementContext } from "@/lib/measurement-context";
import { PageHeading } from "@/components/dashboard/page-heading";
import { TermContext } from "@/components/dashboard/term-context";
import { MeasurementEmpty } from "@/components/dashboard/measurement-empty";
import { Appeals } from "./_components/appeals";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ termId?: string; page?: string; status?: string }>;
}) {
  const user = await pageSession();
  if (user.role === "PUBLISHER") notFound();
  const p = await searchParams;
  const { terms, term } = await measurementContext(user.sessionId, p.termId);
  return (
    <>
      <PageHeading title="结果异议" description="逐项核对提出原因、证明材料、处理状态及后续更正版本。" />
      <TermContext terms={terms} selected={term?.id} />
      {term ? (
        <Appeals
          key={`${term.id}-${p.page || 1}-${p.status || ""}`}
          termId={term.id}
          role={user.role}
          page={Math.max(1, Math.min(100000, Math.floor(Number(p.page) || 1)))}
          status={p.status || ""}
        />
      ) : (
        <MeasurementEmpty admin={user.role === "ADMIN"} />
      )}
    </>
  );
}
