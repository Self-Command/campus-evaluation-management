import { notFound } from "next/navigation";
import { pageSession } from "@/server/page-session";
import { PageHeading } from "@/components/dashboard/page-heading";
import { AuditLogs } from "./_components/audit-logs";

export default async function AuditLogsPage() {
  const user = await pageSession();
  if (user.role !== "ADMIN") notFound();
  return (
    <>
      <PageHeading
        title="操作日志"
        description="查询全部管理操作、修改理由与敏感数据访问；支持按时间、角色、动作和结果筛选，导出前需二次认证。"
      />
      <AuditLogs />
    </>
  );
}
