import { notFound } from "next/navigation";
import { pageSession } from "@/server/page-session";
import { PageHeading } from "@/components/dashboard/page-heading";
import { Settings } from "./_components/settings";
export default async function Page() {
  const user = await pageSession();
  if (user.role !== "ADMIN") notFound();
  return (
    <>
      <PageHeading title="系统设置" description="维护站名、标题、标识与基础主题；保存后对全站生效。" />
      <Settings />
    </>
  );
}
