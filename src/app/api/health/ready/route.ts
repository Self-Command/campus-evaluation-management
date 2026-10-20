import { NextResponse } from "next/server";
import { db } from "@/server/db";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    await db.user.findFirst({ select: { id: true } });
    const migration = await db.$queryRaw<{ pending: bigint }[]>`SELECT COUNT(*) AS pending FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL`;
    if (Number(migration[0].pending)) throw new Error("Migration incomplete");
    return NextResponse.json({ status: "ready" }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ status: "not_ready" }, { status: 503 }); }
}
