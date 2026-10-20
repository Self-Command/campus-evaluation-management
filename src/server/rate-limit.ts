import { createHmac } from "node:crypto";
import { db } from "@/server/db";
export async function consumeLimit(scope: string, identifier: string, limit: number) {
  const key = createHmac("sha256", process.env.NEXTAUTH_SECRET!).update(`${scope}:${identifier}`).digest("hex");
  const now = new Date();
  const attempts = await db.$queryRaw<{ count: number }[]>`INSERT INTO "LoginAttempt" (key,count,"expiresAt") VALUES (${key},1,${new Date(Date.now() + 15 * 60_000)}) ON CONFLICT (key) DO UPDATE SET count = CASE WHEN "LoginAttempt"."expiresAt" < ${now} THEN 1 ELSE "LoginAttempt".count+1 END, "expiresAt" = CASE WHEN "LoginAttempt"."expiresAt" < ${now} THEN EXCLUDED."expiresAt" ELSE "LoginAttempt"."expiresAt" END RETURNING count`;
  return attempts[0].count <= limit;
}
