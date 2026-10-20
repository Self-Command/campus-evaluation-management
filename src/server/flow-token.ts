import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { AccountError } from "@/server/accounts";

function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    if ("toJSON" in value && typeof value.toJSON === "function") return canonical(value.toJSON());
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}
export function stateDigest(value: unknown) { return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex"); }
function sign(value: string) {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new AccountError("服务安全配置不完整", 500);
  return createHmac("sha256", secret).update(value).digest("base64url");
}
export function issueFlowToken(actorId: string, purpose: string, state: unknown) {
  const expiresAt = new Date(Date.now() + 900_000).toISOString();
  const encoded = Buffer.from(JSON.stringify({ actorId, purpose, digest: stateDigest(state), expiresAt })).toString("base64url");
  return { token: `${encoded}.${sign(encoded)}`, expiresAt };
}
export function verifyFlowToken(token: string, actorId: string, purpose: string, state: unknown) {
  const parts = token.split(".");
  if (parts.length !== 2) throw new AccountError("预检无效，请重新核对", 409);
  const [encoded, signature] = parts;
  const expected = sign(encoded);
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new AccountError("预检无效，请重新核对", 409);
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString());
    if (parsed.actorId !== actorId || parsed.purpose !== purpose || parsed.digest !== stateDigest(state) || !Number.isFinite(Date.parse(parsed.expiresAt)) || new Date(parsed.expiresAt) <= new Date()) throw new Error("stale");
  } catch { throw new AccountError("预检已过期或名单、规则、记录已变化，请重新核对", 409); }
}
