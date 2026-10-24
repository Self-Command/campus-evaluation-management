import { notFound } from "next/navigation";
import { pageSession } from "@/server/page-session";
import { PageHeading } from "@/components/dashboard/page-heading";
import { Settings } from "./_components/settings";
export default async function Page() {
  const user = await pageSession();
  if (user.role !== "ADMIN") notFound();
  return (
    <>
      <PageHeading title="系统设置" description="管理站点品牌、登录页、默认外观和登录安全。保存后立即生效。" />
      <Settings />
    </>
  );
}
