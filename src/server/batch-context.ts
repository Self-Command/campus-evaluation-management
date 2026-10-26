export type BatchContext = { batchId: string; index: number; total: number };

export function batchAuditDetails(batch?: BatchContext) {
  return batch ? { batchId: batch.batchId, batchIndex: batch.index, batchTotal: batch.total } : {};
}
