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
				title="结果发布"
				description="核对成绩和参评名单，发布后让学生确认，确认无误再锁定存档。"
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
