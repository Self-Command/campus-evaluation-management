import { notFound } from "next/navigation";
import { pageSession } from "@/server/page-session";
import { PageHeading } from "@/components/dashboard/page-heading";
import { Students } from "./_components/students";
export default async function Page() {
	const user = await pageSession();
	if (user.role !== "ADMIN" && user.role !== "COLLEGE" && user.role !== "COUNSELOR") notFound();
	return (
		<>
			<PageHeading
				title="学生档案"
				description="查看学生名单，按学院、专业和班级筛选；管理员和学院可更正学生班级。"
			/>
			<Students role={user.role} />
		</>
	);
}
