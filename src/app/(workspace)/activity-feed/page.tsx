import { redirect } from "next/navigation";
import { pageSession } from "@/server/page-session";

// 学生的活动入口已合并到 /my-activities；此路径仅保留深链兼容。
export default async function ActivityFeedPage({
	searchParams,
}: {
	searchParams: Promise<{ termId?: string; q?: string; page?: string }>;
}) {
	const user = await pageSession();
	if (user.role !== "STUDENT") redirect("/activities");
	const p = await searchParams;
	redirect(
		`/my-activities?${new URLSearchParams({
			view: "feed",
			...(p.termId ? { termId: p.termId } : {}),
			...(p.q ? { q: p.q } : {}),
			...(p.page ? { page: p.page } : {}),
		})}`,
	);
}
