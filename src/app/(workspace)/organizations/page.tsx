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
				title="组织目录"
				description="维护学院、专业、班级及责任辅导员，归属变更保留理由和修订。"
			/>
			<Organizations />
		</>
	);
}
