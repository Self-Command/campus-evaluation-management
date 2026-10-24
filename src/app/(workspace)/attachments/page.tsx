import { notFound } from "next/navigation";
import { pageSession } from "@/server/page-session";
import { PageHeading } from "@/components/dashboard/page-heading";
import { Attachments } from "./_components/attachments";

export default async function AttachmentsPage() {
  const user = await pageSession();
  if (user.role !== "ADMIN") notFound();
  return (
    <>
      <PageHeading
        title="附件管理"
        description="按当前组织范围查看活动附件与学生证明，一个活动只显示一行；可按学院、专业、班级或全校导出 ZIP 与清单。"
      />
      <Attachments />
    </>
  );
}
