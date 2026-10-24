import { notFound } from "next/navigation";
import { pageSession } from "@/server/page-session";
import { PageHeading } from "@/components/dashboard/page-heading";
import { Organizations } from "./_components/organizations";

const copy = {
	ADMIN: {
		title: "学院与班级",
		description: "在“班级目录”维护班级与责任辅导员，在“学院与专业”维护组织层级；删除前系统会检查关联数据。",
	},
	COLLEGE: {
		title: "本院班级",
		description: "查看本院班级及责任辅导员；在“学院与专业”维护本院专业，删除前系统会检查关联数据。",
	},
} as const;

export default async function Page() {
	const user = await pageSession();
	if (user.role !== "ADMIN" && user.role !== "COLLEGE") notFound();
	const text = copy[user.role];
	return (
		<>
			<PageHeading title={text.title} description={text.description} />
			<Organizations />
		</>
	);
}
