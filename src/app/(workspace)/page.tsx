import { pageSession } from "@/server/page-session";
import { getWorkbench } from "@/server/workbench";
import { measurementContext } from "@/lib/measurement-context";
import { TermContext } from "@/components/dashboard/term-context";
import { AdminWorkbench } from "./_components/admin-workbench";
import { CollegeWorkbench } from "./_components/college-workbench";
import { CounselorWorkbench } from "./_components/counselor-workbench";
import { PublisherWorkbench } from "./_components/publisher-workbench";
import { StudentWorkbench } from "./_components/student-workbench";
export default async function Page({
	searchParams,
}: {
	searchParams: Promise<{ termId?: string }>;
}) {
	const user = await pageSession();
	const p = await searchParams;
	const { terms, term } = await measurementContext(user.sessionId, p.termId);
	const data = await getWorkbench(user.sessionId, term?.id);
	const context = <TermContext terms={terms} selected={term?.id} />;
	if (data.role === "ADMIN")
		return <AdminWorkbench data={data} context={context} />;
	if (data.role === "PUBLISHER")
		return <PublisherWorkbench data={data} context={context} />;
	if (data.role === "COLLEGE")
		return <CollegeWorkbench data={data} context={context} />;
	if (data.role === "COUNSELOR")
		return <CounselorWorkbench data={data} context={context} />;
	return <StudentWorkbench data={data} context={context} />;
}
