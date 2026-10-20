import { MeasurementEmpty } from "@/components/dashboard/measurement-empty";
import { notFound } from "next/navigation";
import { pageSession } from "@/server/page-session";
import { measurementContext } from "@/lib/measurement-context";
import { PageHeading } from "@/components/dashboard/page-heading";
import { TermContext } from "@/components/dashboard/term-context";
import { Publication } from "./_components/publication";
export default async function Page({
	searchParams,
}: {
	searchParams: Promise<{ termId?: string }>;
}) {
	const user = await pageSession();
	if (user.role !== "ADMIN") notFound();
	const p = await searchParams;
	const { terms, term } = await measurementContext(user.sessionId, p.termId);
	return (
		<>
			<PageHeading
				title="发布与结算"
				description="检查完整成绩，发布学生核对，再保存不可变结算快照。"
			/>
			<TermContext terms={terms} selected={term?.id} />
			{term ? (
				<Publication key={term.id} termId={term.id} />
			) : (
				<MeasurementEmpty admin={user.role === "ADMIN"} />
			)}
		</>
	);
}
