import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { pageSession } from "@/server/page-session";
import { measurementContext } from "@/lib/measurement-context";
import { PageHeading } from "@/components/dashboard/page-heading";
import { TermContext } from "@/components/dashboard/term-context";
import { MeasurementEmpty } from "@/components/dashboard/measurement-empty";
import { GradeWorkspace } from "./_components/grade-workspace";

const copy = {
	COUNSELOR: {
		title: "成绩录入",
		description: "为负责班级录入成绩并提交学院审核；审核通过前有效成绩保持不变。",
	},
	COLLEGE: {
		title: "成绩审核",
		description: "审核本院辅导员提交的成绩修订，退回必须填写理由，通过后按批准值生效。",
	},
	ADMIN: {
		title: "成绩录入与审核",
		description: "查看全校成绩录入与审核进度；组织或数据异常时可按留痕方式例外更正。",
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
			<PageHeading
				title={text.title}
				description={text.description}
				action={
					term && (user.role === "ADMIN" || user.role === "COUNSELOR") ? (
						<>
							<Link
								href={`/imports?kind=grades&termId=${term.id}`}
								className={buttonVariants({ variant: "outline" })}
							>
								导入成绩
							</Link>
							{user.role === "ADMIN" && (
								<a
									href={`/api/grades/export?termId=${term.id}&scope=school`}
									className={buttonVariants({ variant: "outline" })}
								>
									导出全校成绩明细表
								</a>
							)}
						</>
					) : undefined
				}
			/>
			<TermContext terms={terms} selected={term?.id} />
			{term ? (
				<GradeWorkspace
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
