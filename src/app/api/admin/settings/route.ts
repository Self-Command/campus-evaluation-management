import { authenticatedApi } from "@/server/route-handler";
import { readSettings, saveSettings } from "@/server/settings";
export async function GET(request:Request) { return authenticatedApi(request,["ADMIN"],readSettings); }
export async function PUT(request:Request) { return authenticatedApi(request,["ADMIN"],async sessionId => saveSettings(sessionId,await request.json()),true); }
