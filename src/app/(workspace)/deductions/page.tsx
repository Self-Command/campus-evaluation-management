import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { MeasurementEmpty } from "@/components/dashboard/measurement-empty";
import { notFound } from "next/navigation";
import { pageSession } from "@/server/page-session";
import { measurementContext } from "@/lib/measurement-context";
import { PageHeading } from "@/components/dashboard/page-heading";
import { TermContext } from "@/components/dashboard/term-context";
import {
	GradeManager,
	type GradeManagerInitial,
} from "../grades/_components/grade-manager";
import { listGrades } from "@/server/grades";
import { listDeductions } from "@/server/deductions";
import { AccountError } from "@/server/accounts";
export default async function Page({
	searchParams,
}: {
	searchParams: Promise<{ termId?: string; login?: string }>;
}) {
	const user = await pageSession();
	if (user.role !== "ADMIN") notFound();
	const p = await searchParams;
	const { terms, term } = await measurementContext(user.sessionId, p.termId);
	let initialData: GradeManagerInitial | undefined;
	let initialError = "";
	if (term && p.login) {
		try {
			const [grades, deductions] = await Promise.all([
				listGrades(user.sessionId, term.id, p.login),
				listDeductions(user.sessionId, term.id, p.login),
			]);
			initialData = {
				student: grades.student,
				grades: grades.inputs,
				deductions: deductions.records,
			};
		} catch (error) {
			initialError =
				error instanceof AccountError
					? error.message
					: "读取指定学生扣分失败，请重新选择学生或稍后重试。";
		}
	}
	return (
		<>
			<PageHeading
				title="扣分管理"
				description="按学生维护扣分项目、扣分额、生效状态及业务理由。"
				action={
					term && term.phase !== "ACTIVE" ? (
						<Link
							href={`/publication?termId=${term.id}`}
							className={buttonVariants({ variant: "outline" })}
						>
							查看发布与更正
						</Link>
					) : undefined
				}
			/>
			<TermContext terms={terms} selected={term?.id} />
			{term ? (
				<GradeManager
					key={`${term.id}-${p.login || ""}`}
					term={JSON.parse(JSON.stringify(term))}
					mode="deductions"
					readOnly={term.phase !== "ACTIVE" || term.disposition !== "NORMAL"}
					initialData={
						initialData ? JSON.parse(JSON.stringify(initialData)) : undefined
					}
					initialError={initialError}
				/>
			) : (
				<MeasurementEmpty admin />
			)}
		</>
	);
}
