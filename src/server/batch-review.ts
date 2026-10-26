import { z } from "zod";
import { AccountError } from "@/server/account-error";
import { recordAudit } from "@/server/audit";
import type { AuditAction } from "@/server/audit-actions";
import { getCurrentSession } from "@/server/auth";
import type { BatchContext } from "@/server/batch-context";
import { db } from "@/server/db";

export const batchItemSchema = z.object({
  id: z.string().min(1).max(100),
  revision: z.number().int().nonnegative(),
}).strict();

export const batchBodySchema = z.object({
  termId: z.string().min(1).max(100),
  batchId: z.string().min(8).max(100),
  action: z.string().min(1).max(100),
  reason: z.string().trim().min(2).max(1000).optional(),
  items: z.array(batchItemSchema).min(1).max(100),
}).strict();

export type BatchItem = z.infer<typeof batchItemSchema>;

export type BatchOutcome = { revision: number; status?: string };
export type BatchItemResult = {
  id: string;
  ok: boolean;
  revision?: number;
  status?: string;
  statusCode?: number;
  message?: string;
  notExecuted?: boolean;
};
export type BatchResponse = {
  batchId: string;
  action: string;
  requested: number;
  succeeded: number;
  failed: number;
  notExecuted: number;
  results: BatchItemResult[];
};

export function parseBatchBody(input: unknown, actionSchema: z.ZodTypeAny, reasonRequiredActions: readonly string[]) {
  const data = batchBodySchema.extend({ action: actionSchema }).strict().parse(input) as {
    termId: string;
    batchId: string;
    action: string;
    reason?: string;
    items: BatchItem[];
  };
  if (new Set(data.items.map(item => item.id)).size !== data.items.length) throw new AccountError("批量记录不能重复");
  if (reasonRequiredActions.includes(data.action) && !data.reason) throw new AccountError("请填写操作理由");
  return data;
}

const batchBudgetMs = 45_000;

export async function runBatch({
  sessionId, termId, action, batchId, items, auditAction, execute,
}: {
  sessionId: string;
  termId: string;
  action: string;
  batchId: string;
  items: BatchItem[];
  auditAction: AuditAction;
  execute: (item: BatchItem, context: BatchContext) => Promise<BatchOutcome>;
}): Promise<BatchResponse> {
  const session = await getCurrentSession(sessionId);
  if (!session) throw new AccountError("会话已失效，请重新登录", 401);
  const startedAt = Date.now();
  const results: BatchItemResult[] = [];
  let aborted = false;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (aborted || Date.now() - startedAt > batchBudgetMs) {
      results.push({ id: item.id, ok: false, notExecuted: true, message: "未执行，请刷新后重新处理" });
      continue;
    }
    try {
      const outcome = await execute(item, { batchId, index: index + 1, total: items.length });
      results.push({ id: item.id, ok: true, revision: outcome.revision, status: outcome.status });
    } catch (error) {
      if (error instanceof AccountError) {
        results.push({ id: item.id, ok: false, statusCode: error.status, message: error.message });
        continue;
      }
      console.error("批量审核单项失败", { batchId, id: item.id, errorName: error instanceof Error ? error.name : "UnknownError" });
      results.push({ id: item.id, ok: false, statusCode: 500, message: "该记录未完成，请刷新后核对" });
      aborted = true;
    }
  }
  const succeeded = results.filter(item => item.ok).length;
  const notExecuted = results.filter(item => item.notExecuted).length;
  const failed = results.length - succeeded - notExecuted;
  await writeBatchAudit({
    session, termId, action, batchId, auditAction, results, succeeded, failed, notExecuted,
  });
  return { batchId, action, requested: items.length, succeeded, failed, notExecuted, results };
}

async function writeBatchAudit({
  session, termId, action, batchId, auditAction, results, succeeded, failed, notExecuted,
}: {
  session: NonNullable<Awaited<ReturnType<typeof getCurrentSession>>>;
  termId: string;
  action: string;
  batchId: string;
  auditAction: AuditAction;
  results: BatchItemResult[];
  succeeded: number;
  failed: number;
  notExecuted: number;
}) {
  try {
    await db.$transaction(async tx => {
      await recordAudit(tx, {
        action: auditAction,
        actorId: session.user.id,
        actor: { id: session.user.id, name: session.user.name, login: session.user.login, role: session.user.role },
        targetType: "ReviewBatch",
        targetId: batchId,
        result: failed === 0 && notExecuted === 0 ? "SUCCESS" : succeeded > 0 ? "PARTIAL" : "FAILURE",
        details: {
          termId,
          action,
          batchId,
          requested: results.length,
          succeeded,
          failed,
          notExecuted,
          failures: results
            .filter(item => !item.ok)
            .slice(0, 50)
            .map(item => ({ id: item.id, status: item.statusCode ?? null, notExecuted: Boolean(item.notExecuted) })),
        },
      });
    });
  } catch (error) {
    console.error("批量审核汇总审计写入失败", { batchId, errorName: error instanceof Error ? error.name : "UnknownError" });
  }
}
