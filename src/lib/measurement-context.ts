import "server-only";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { listTerms } from "@/server/terms";
export async function measurementContext(sessionId: string, requested?: string) {
  const terms = await listTerms(sessionId);
  if (requested) {
    const term = terms.find((item) => item.id === requested);
    if (!term) notFound();
    return { terms, term };
  }
  const remembered = (await cookies()).get("measurement_term")?.value;
  const normal = terms.filter(item => item.disposition === "NORMAL");
  const term =
    normal.find((item) => item.id === remembered) ||
    normal.find((item) => ["ACTIVE", "CHECKING"].includes(item.phase)) ||
    normal[0];
  return { terms, term };
}
