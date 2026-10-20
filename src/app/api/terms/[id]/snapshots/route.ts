import { authenticatedApi } from "@/server/route-handler";
import { listSnapshots } from "@/server/publications";
export async function GET(request:Request,context:{params:Promise<{id:string}>}) { return authenticatedApi(request,["ADMIN"],async sessionId => listSnapshots(sessionId,(await context.params).id)); }
