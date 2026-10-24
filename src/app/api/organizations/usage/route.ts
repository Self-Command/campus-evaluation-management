import { authenticatedApi } from "@/server/route-handler";
import { organizationUsage } from "@/server/organizations";

export async function GET(request: Request) {
	const query = new URL(request.url).searchParams;
	return authenticatedApi(request, ["ADMIN", "COLLEGE"], sessionId =>
		organizationUsage(sessionId, query.get("kind") ?? "", query.get("id") ?? ""),
	);
}
