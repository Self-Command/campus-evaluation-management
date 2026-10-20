import { publicSettings } from "@/server/settings";
import { apiError } from "@/server/http";
export async function GET() { try { return Response.json(await publicSettings(),{headers:{"Cache-Control":"no-store"}}); } catch(error) { return apiError(error); } }
