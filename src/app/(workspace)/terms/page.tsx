import { pageSession } from "@/server/page-session";
import { listTerms } from "@/server/terms";
import { PageHeading } from "@/components/dashboard/page-heading";
import { Terms } from "./_components/terms";
export default async function TermsPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const p = await searchParams;
  const user = await pageSession();
  const terms = await listTerms(user.sessionId);
  return (
    <>
      <PageHeading title="测评周期" description="每个周期使用一套生效评分方案，按阶段组织申报、审核与结果核对。" />
      <Terms terms={JSON.parse(JSON.stringify(terms))} admin={user.role === "ADMIN"} create={p.new === "1"} />
    </>
  );
}
