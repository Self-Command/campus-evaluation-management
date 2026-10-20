import { notFound } from "next/navigation";
import { pageSession } from "@/server/page-session";
import { getActivity } from "@/server/activities";
import { listTerms } from "@/server/terms";
import { ActivityDetail } from "../_components/activity-detail";
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
	let returnHref: string | undefined;
	if (returnTo) {
		try {
			const destination = new URL(returnTo, "http://measurement.local");
			if (
				destination.origin === "http://measurement.local" &&
				[
					"/activities",
					"/activity-feed",
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
			returnHref={returnHref}
		/>
	);
}
