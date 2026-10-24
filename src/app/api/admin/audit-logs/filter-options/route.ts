import { authenticatedApi } from "@/server/route-handler";
import { auditFilterOptions } from "@/server/audit-query";

export async function GET(request: Request) {
  return authenticatedApi(request, ["ADMIN"], auditFilterOptions);
}
