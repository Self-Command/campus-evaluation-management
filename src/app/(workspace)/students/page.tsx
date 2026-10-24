import { notFound } from "next/navigation";
import { pageSession } from "@/server/page-session";
import { PageHeading } from "@/components/dashboard/page-heading";
import { Students } from "./_components/students";

const copy = {
	ADMIN: {
		title: "学生档案",
		description:
			"查看全校学生名单，按学院、专业和班级筛选；可更正姓名、班级和学号，删除没有业务记录的学生账号，修改均保留记录。",
	},
	COLLEGE: {
		title: "本院学生",
		description:
			"查看本院学生名单，按专业和班级筛选；可更正本院学生姓名和班级，并保留修改记录。",
	},
	COUNSELOR: {
		title: "我的学生",
		description:
			"查看负责班级的学生名单和学籍信息；姓名和班级由管理员或学院更正。",
	},
} as const;

export default async function Page() {
	const user = await pageSession();
	if (user.role !== "ADMIN" && user.role !== "COLLEGE" && user.role !== "COUNSELOR") notFound();
	const text = copy[user.role];
	return (
		<>
			<PageHeading title={text.title} description={text.description} />
			<Students role={user.role} />
		</>
	);
}
