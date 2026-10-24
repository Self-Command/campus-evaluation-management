import { notFound } from "next/navigation";
import { pageSession } from "@/server/page-session";
import { getActivity } from "@/server/activities";
import { listTerms } from "@/server/terms";
import { listOrganizations } from "@/server/organizations";
import { ActivityDetail } from "../_components/activity-detail";
import { attachmentLimits } from "@/server/activity-attachments";
export default async function ActivityPage({
	params,
	searchParams,
}: {
	params: Promise<{ id: string }>;
	searchParams: Promise<{ returnTo?: string }>;
}) {
	const user = await pageSession();
	const { id } = await params;
	let activity;
	try {
		activity = await getActivity(user.sessionId, id);
	} catch {
		notFound();
	}
	const term = (await listTerms(user.sessionId)).find(
		(t) => t.id === activity.termId,
	);
	if (!term) notFound();
	const { returnTo } = await searchParams;
	const limits = await attachmentLimits();
	const colleges =
		user.role === "ADMIN"
			? (await listOrganizations(user.sessionId)).colleges.map((college) => ({
					id: college.id,
					name: college.name,
					code: college.code,
				}))
			: [];
	let returnHref: string | undefined;
	if (returnTo) {
		try {
			const destination = new URL(returnTo, "http://measurement.local");
			if (
				destination.origin === "http://measurement.local" &&
				[
					"/activities",
					"/activity-feed",
					"/my-activities",
					"/recognitions",
					`/terms/${term.id}`,
				].includes(destination.pathname) &&
				destination.searchParams.get("termId") === term.id
			) {
				returnHref = destination.pathname + destination.search;
			}
		} catch {
			/* Invalid return addresses use the activity directory. */
		}
	}
	return (
		<ActivityDetail
			activity={JSON.parse(JSON.stringify(activity))}
			term={JSON.parse(JSON.stringify(term))}
			user={{ id: user.id, role: user.role }}
			colleges={colleges}
			limits={limits}
			now={new Date().toISOString()}
			returnHref={returnHref}
		/>
	);
}
