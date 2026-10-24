import { notFound } from "next/navigation";
import { pageSession } from "@/server/page-session";
import { PageHeading } from "@/components/dashboard/page-heading";
import { Backups } from "./_components/backups";

export default async function BackupsPage() {
  const user = await pageSession();
  if (user.role !== "ADMIN") notFound();
  return (
    <>
      <PageHeading
        title="数据库备份"
        description="创建、下载和上传 PostgreSQL 自定义格式备份；备份只包含数据库，不包含证明与活动附件文件。整库恢复需先完成候选库预检。"
      />
      <Backups />
    </>
  );
}
