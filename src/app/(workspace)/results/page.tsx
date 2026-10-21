import { StudentDirectory } from "@/components/dashboard/student-directory";
import { MeasurementEmpty } from "@/components/dashboard/measurement-empty";
import { notFound } from "next/navigation";
import { pageSession } from "@/server/page-session";
import { measurementContext } from "@/lib/measurement-context";
import { PageHeading, NoData } from "@/components/dashboard/page-heading";
import { TermContext } from "@/components/dashboard/term-context";
import { ResultView } from "./_components/result-view";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ termId?: string; login?: string; q?: string; page?: string }>;
}) {
  const user = await pageSession();
  if (user.role !== "ADMIN" && user.role !== "STUDENT") notFound();
  const p = await searchParams;
  const { terms, term } = await measurementContext(user.sessionId, p.termId);
  return (
    <>
      <PageHeading
        title={user.role === "STUDENT" ? "我的成绩" : "成绩查询"}
        description="查看成绩明细、计分依据，以及参与和扣分记录，确认发布结果。"
      />
      <TermContext terms={terms} selected={term?.id} />
      {!term ? (
        <MeasurementEmpty admin={user.role === "ADMIN"} />
      ) : user.role === "ADMIN" && !p.login ? (
        <StudentDirectory key={term.id} termId={term.id} />
      ) : term.phase === "CONFIGURATION" ? (
        <NoData title="评分方案配置中" description="评分方案生效后，可以查看成绩和计分依据。" />
      ) : (
        <ResultView key={`${term.id}-${p.login || ""}`} termId={term.id} role={user.role} login={p.login || ""} />
      )}
    </>
  );
}
