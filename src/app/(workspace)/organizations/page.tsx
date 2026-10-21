import { notFound } from "next/navigation";
import { pageSession } from "@/server/page-session";
import { PageHeading } from "@/components/dashboard/page-heading";
import { Organizations } from "./_components/organizations";

export default async function Page() {
	const user = await pageSession();
	if (!["ADMIN", "COLLEGE"].includes(user.role)) notFound();
	return (
		<>
			<PageHeading
				title="组织架构"
				description="按学院查看专业和班级，维护名称、编码和责任辅导员。"
			/>
			<Organizations />
		</>
	);
}
