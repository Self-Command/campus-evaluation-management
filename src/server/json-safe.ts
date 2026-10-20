import { Prisma } from "@/generated/prisma/client";

// Business decimals must round-trip through forms without exponential notation.
// Authorization services still select the allowed fields; this is serialization only.
export function jsonSafe(value: unknown): unknown {
  if (Prisma.Decimal.isDecimal(value)) return value.toFixed();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]));
  return value;
}
