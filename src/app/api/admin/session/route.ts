import { NextResponse } from "next/server";
import { authorize } from "@/server/authorization";
export async function GET() {
  const result = await authorize(["ADMIN"]);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ name: result.user.name, role: result.user.role }, { headers: { "Cache-Control": "no-store" } });
}
