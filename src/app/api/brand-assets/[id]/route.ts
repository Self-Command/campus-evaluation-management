import { getServerSession } from "next-auth";
import { authOptions } from "@/server/auth";
import { getBrandAsset } from "@/server/settings";
import { apiError } from "@/server/http";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const asset = await getBrandAsset(
      (await context.params).id,
      async () => (await getServerSession(authOptions))?.user?.sessionId,
    );
    return new Response(new Uint8Array(asset.bytes), {
      headers: {
        "Content-Type": asset.mime,
        "Cache-Control": asset.publicAsset ? "public, max-age=31536000, immutable" : "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
