import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { acknowledgeRestore, getRestoreStatus } from "@/server/restore";
import { apiError } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function token() {
  return (await cookies()).get("campus_restore_status")?.value;
}

export async function GET() {
  try {
    const state = await getRestoreStatus(await token());
    return NextResponse.json(state, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const result = await acknowledgeRestore(await token(), body);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
