import { z } from "zod";
import { authenticatedApi } from "@/server/route-handler";
import { pageActivities, pageActivityFeed, saveActivity, confirmActivity, publishActivity } from "@/server/activities";
import { pageRecognitions, submitParticipation, reviewParticipation, changeParticipation } from "@/server/recognitions";
import { saveActivityScore } from "@/server/activity-participants";
export async function GET(request: Request) {
  return authenticatedApi(request, ["ADMIN", "PUBLISHER", "STUDENT"], sessionId => {
    const query = new URL(request.url).searchParams;
    const termId = z.string().min(1).max(100).parse(query.get("termId"));
    const page = z.coerce.number().int().min(1).max(100000).parse(query.get("page") ?? 1), search = (query.get("q") ?? "").slice(0, 80);
    return query.get("view") === "reviews" ? pageRecognitions(sessionId, termId, page, query.get("status") || undefined) : query.get("view") === "feed" ? pageActivityFeed(sessionId, termId, search, page) : pageActivities(sessionId, termId, search, page);
  });
}
export async function POST(request: Request) {
  return authenticatedApi(request, ["ADMIN", "PUBLISHER", "STUDENT"], async sessionId => {
    const body = await request.json();
    const { termId, action } = z.object({ termId: z.string().min(1).max(100), action: z.enum(["save", "confirm", "submit", "review", "withdraw", "resubmit", "revoke", "close", "publish", "unpublish", "score"]) }).parse(body);
    if (action === "save") return saveActivity(sessionId, termId, body);
    if (action === "confirm") return confirmActivity(sessionId, termId, body);
    if (action === "publish" || action === "unpublish") return publishActivity(sessionId, termId, body);
    if (action === "score") return saveActivityScore(sessionId, termId, body);
    if (action === "submit") return submitParticipation(sessionId, termId, body);
    if (action === "review") return reviewParticipation(sessionId, termId, body);
    return changeParticipation(sessionId, termId, body);
  }, true);
}

