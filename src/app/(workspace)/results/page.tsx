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
        title={user.role === "STUDENT" ? "我的测评" : "测评结果"}
        description="查看完整成绩、模块计算过程、认定与扣分依据及版本确认。"
      />
      <TermContext terms={terms} selected={term?.id} />
      {!term ? (
        <MeasurementEmpty admin={user.role === "ADMIN"} />
      ) : user.role === "ADMIN" && !p.login ? (
        <StudentDirectory key={term.id} termId={term.id} />
      ) : term.phase === "CONFIGURATION" ? (
        <NoData title="本周期评分方案配置中" description="评分方案生效后可以查看当前成绩与计分依据。" />
      ) : (
        <ResultView key={`${term.id}-${p.login || ""}`} termId={term.id} role={user.role} login={p.login || ""} />
      )}
    </>
  );
}
