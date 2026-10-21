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
  if (user.role !== "ADMIN" && user.role !== "STUDENT") notFound();
  const p = await searchParams;
  const { terms, term } = await measurementContext(user.sessionId, p.termId);
  return (
    <>
      <PageHeading
        title={user.role === "ADMIN" ? "成绩异议处理" : "我的成绩异议"}
        description={
          user.role === "ADMIN"
            ? "查看异议理由、证明材料和每次处理结果。"
            : "查看本人提交的异议、处理进度和更正结果。"
        }
      />
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
