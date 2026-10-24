import { headers } from "next/headers";
import type { Prisma } from "@/generated/prisma/client";
import { auditActionMeta, isAuditAction, type AuditAction, type AuditResult } from "@/server/audit-actions";

const blockedKeys = new Set([
  "password",
  "passwordhash",
  "token",
  "secret",
  "cookie",
  "authorization",
  "captcha",
  "session",
  "sessionid",
  "databaseurl",
  "connectionstring",
  "apikey",
  "privatekey",
]);

const maxDetailsBytes = 16 * 1024;
const maxStringLength = 2_000;

export class AuditError extends Error {
  status = 400;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth > 6) return "[depth-limit]";
  if (typeof value === "string") return value.length > maxStringLength ? `${value.slice(0, maxStringLength)}…[truncated]` : value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.slice(0, 200).map(item => sanitizeValue(item, depth + 1));
  if (isRecord(value)) {
    const next: UnknownRecord = {};
    for (const [key, item] of Object.entries(value)) {
      if (blockedKeys.has(key.toLowerCase())) {
        next[key] = "[redacted]";
        continue;
      }
      next[key] = sanitizeValue(item, depth + 1);
    }
    return next;
  }
  return value;
}

export function sanitizeAuditDetails(details: unknown): Prisma.InputJsonValue | undefined {
  if (details === undefined || details === null) return undefined;
  const sanitized = sanitizeValue(details, 0);
  const serialized = JSON.stringify(sanitized);
  if (serialized.length <= maxDetailsBytes) return JSON.parse(serialized) as Prisma.InputJsonValue;
  return {
    truncated: true,
    note: "详情超过 16 KiB，已截断",
    keys: isRecord(sanitized) ? Object.keys(sanitized).slice(0, 50) : [],
  };
}

type AuditActor = {
  id: string;
  name: string;
  login: string;
  role: string;
};

type AuditInput = {
  action: AuditAction;
  actorId?: string | null;
  actor?: AuditActor | null;
  targetType?: string;
  targetId?: string | null;
  targetLabel?: string | null;
  reason?: string | null;
  result?: AuditResult;
  details?: unknown;
  route?: string;
  method?: string;
  ip?: string;
  userAgent?: string;
  requestId?: string;
};

type AuditClient = Pick<Prisma.TransactionClient, "auditEvent" | "user">;

export async function requestMetadata() {
  try {
    const incoming = await headers();
    return {
      requestId: incoming.get("x-request-id") ?? undefined,
      route: incoming.get("x-audit-route") ?? undefined,
      method: incoming.get("x-audit-method") ?? undefined,
      ip: incoming.get("x-client-ip") ?? undefined,
      userAgent: incoming.get("user-agent")?.slice(0, 512) ?? undefined,
    };
  } catch {
    return {};
  }
}

function normalizeReason(reason: string | null | undefined) {
  const trimmed = reason?.trim();
  return trimmed ? trimmed.slice(0, 1_000) : null;
}

export async function recordAudit(tx: AuditClient, input: AuditInput) {
  if (!isAuditAction(input.action)) throw new AuditError(`未登记的审计动作：${input.action}`);
  const meta = auditActionMeta(input.action);
  const legacyReason = isRecord(input.details) && typeof input.details.reason === "string" ? input.details.reason : null;
  const reason = normalizeReason(input.reason ?? legacyReason);
  if (meta.requiresReason && !reason) throw new AuditError(`动作 ${meta.label} 必须填写理由`);
  const request = await requestMetadata();
  let actor = input.actor ?? null;
  if (!actor && input.actorId) {
    const row = await tx.user.findUnique({ where: { id: input.actorId }, select: { id: true, name: true, login: true, role: true } });
    actor = row ?? null;
  }
  return tx.auditEvent.create({
    data: {
      actorId: input.actorId ?? (actor?.id || null),
      actorName: actor?.name ?? null,
      actorLogin: actor?.login ?? null,
      actorRole: actor?.role ?? null,
      action: input.action,
      category: meta.category,
      targetType: input.targetType ?? meta.targetType ?? null,
      targetId: input.targetId ?? null,
      targetLabel: input.targetLabel?.slice(0, 200) ?? null,
      reason,
      result: input.result ?? "SUCCESS",
      requestId: input.requestId ?? request.requestId ?? null,
      route: input.route ?? request.route ?? null,
      method: input.method ?? request.method ?? null,
      ip: input.ip ?? request.ip ?? null,
      userAgent: input.userAgent ?? request.userAgent ?? null,
      details: sanitizeAuditDetails(input.details),
    },
  });
}

export async function recordAuditBestEffort(tx: AuditClient, input: AuditInput) {
  try {
    return await recordAudit(tx, input);
  } catch (error) {
    console.error("审计写入失败", error instanceof Error ? error.name : "UnknownError");
    return null;
  }
}

const securityWindowMs = 60_000;
const securityLimitPerWindow = 60;
const securityThrottles = new Map<string, { windowStart: number; count: number; summaryWritten: boolean }>();

export async function recordSecurityAuditBestEffort(tx: AuditClient, input: AuditInput) {
  const request = await requestMetadata();
  const key = `${request.ip ?? "unknown"}|${input.action}`;
  const now = Date.now();
  const windowStart = Math.floor(now / securityWindowMs) * securityWindowMs;
  let state = securityThrottles.get(key);
  if (!state || state.windowStart !== windowStart) {
    if (securityThrottles.size > 5_000) {
      for (const [entryKey, entry] of securityThrottles) if (entry.windowStart < windowStart) securityThrottles.delete(entryKey);
    }
    state = { windowStart, count: 0, summaryWritten: false };
    securityThrottles.set(key, state);
  }
  state.count += 1;
  if (state.count <= securityLimitPerWindow) return recordAuditBestEffort(tx, input);
  if (state.summaryWritten) return null;
  state.summaryWritten = true;
  return recordAuditBestEffort(tx, {
    ...input,
    details: { ...(isRecord(input.details) ? input.details : { original: input.details ?? null }), throttled: true, suppressedCount: state.count - securityLimitPerWindow, windowSeconds: 60 },
  });
}

export function maskLogin(login: string) {
  const clean = login.trim();
  if (clean.length <= 2) return `${clean.slice(0, 1)}*`;
  if (clean.length <= 6) return `${clean.slice(0, 2)}***`;
  return `${clean.slice(0, 3)}***${clean.slice(-2)}`;
}
