import { notFound } from "next/navigation";
import { pageSession } from "@/server/page-session";
import { listAccounts } from "@/server/accounts";
import { PageHeading } from "@/components/dashboard/page-heading";
import { Accounts } from "./_components/accounts";
export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; role?: string; disabled?: string }>;
}) {
  const user = await pageSession();
  if (user.role !== "ADMIN") notFound();
  const p = await searchParams;
  const page = Math.max(1, Math.min(100000, Math.floor(Number(p.page) || 1)));
  const role = ["ADMIN", "PUBLISHER", "STUDENT"].includes(p.role || "")
    ? (p.role as "ADMIN" | "PUBLISHER" | "STUDENT")
    : undefined;
  const disabled = p.disabled === "true" ? true : p.disabled === "false" ? false : undefined;
  const result = await listAccounts(user.sessionId, (p.q || "").slice(0, 80), page, { role, disabled });
  return (
    <>
      <PageHeading
        title="账号管理"
        description="管理三类账号的访问角色、启停状态与密码重置。学生组织信息在学生档案中维护。"
      />
      <Accounts
        data={JSON.parse(JSON.stringify(result))}
        query={p.q || ""}
        selfId={user.id}
        filters={{ role: role || "", disabled: disabled === undefined ? "" : String(disabled) }}
      />
    </>
  );
}
