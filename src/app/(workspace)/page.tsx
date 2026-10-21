import { pageSession } from "@/server/page-session";
import { redirect } from "next/navigation";
import { getWorkbench } from "@/server/workbench";
import { measurementContext } from "@/lib/measurement-context";
import { TermContext } from "@/components/dashboard/term-context";
import { AdminWorkbench } from "./_components/admin-workbench";
import { PublisherWorkbench } from "./_components/publisher-workbench";
import { StudentWorkbench } from "./_components/student-workbench";
export default async function Page({
	searchParams,
}: {
	searchParams: Promise<{ termId?: string }>;
}) {
	const user = await pageSession();
	if (user.role === "COLLEGE" || user.role === "COUNSELOR")
		redirect("/students");
	const p = await searchParams;
	const { terms, term } = await measurementContext(user.sessionId, p.termId);
	const data = await getWorkbench(user.sessionId, term?.id);
	const context = <TermContext terms={terms} selected={term?.id} />;
	if (data.role === "ADMIN")
		return <AdminWorkbench data={data} context={context} />;
	if (data.role === "PUBLISHER")
		return <PublisherWorkbench data={data} context={context} />;
	return <StudentWorkbench data={data} context={context} />;
}
