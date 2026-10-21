import { notFound } from "next/navigation";
import { pageSession } from "@/server/page-session";
import { measurementContext } from "@/lib/measurement-context";
import { PageHeading } from "@/components/dashboard/page-heading";
import { TermContext } from "@/components/dashboard/term-context";
import { MeasurementEmpty } from "@/components/dashboard/measurement-empty";
import { DeductionWorkspace } from "./_components/deduction-workspace";

const copy = {
	COUNSELOR: {
		title: "扣分管理",
		description: "为负责班级登记扣分事件或申请撤销，提交学院审核通过后计入总分。",
	},
	COLLEGE: {
		title: "扣分审核",
		description: "审核本院辅导员提交的扣分事件与撤销申请，退回必须填写理由。",
	},
	ADMIN: {
		title: "扣分管理与审核",
		description: "查看全校扣分事件与审核进度；组织或数据异常时可按留痕方式例外更正。",
	},
} as const;

export default async function Page({
	searchParams,
}: {
	searchParams: Promise<{ termId?: string }>;
}) {
	const user = await pageSession();
	if (user.role !== "ADMIN" && user.role !== "COLLEGE" && user.role !== "COUNSELOR") notFound();
	const p = await searchParams;
	const { terms, term } = await measurementContext(user.sessionId, p.termId);
	const text = copy[user.role];
	return (
		<>
			<PageHeading title={text.title} description={text.description} />
			<TermContext terms={terms} selected={term?.id} />
			{term ? (
				<DeductionWorkspace
					key={term.id}
					term={{ id: term.id, name: term.name, phase: term.phase, disposition: term.disposition }}
					role={user.role}
				/>
			) : (
				<MeasurementEmpty admin={user.role === "ADMIN"} />
			)}
		</>
	);
}
