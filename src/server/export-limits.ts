import { AccountError } from "@/server/account-error";
import { EXPORT_BATCH_SIZE, MAX_EXPORT_STUDENTS, MAX_EXPORT_STUDENTS_TEXT } from "@/lib/export-limits";

export { EXPORT_BATCH_SIZE, MAX_EXPORT_COLLEGES, MAX_EXPORT_STUDENTS, MAX_EXPORT_STUDENTS_TEXT } from "@/lib/export-limits";

export const EXPORT_TRANSACTION_TIMEOUT_MS = 60_000;

export function assertExportCapacity(count: number, hint = "请按学院或班级分批导出") {
  if (count > MAX_EXPORT_STUDENTS) {
    throw new AccountError(`导出范围共 ${count} 人，超过单次 ${MAX_EXPORT_STUDENTS_TEXT} 人上限，${hint}`, 413);
  }
}

export function chunkItems<T>(items: T[], size = EXPORT_BATCH_SIZE): T[][] {
  if (size <= 0) throw new Error("分批大小必须大于零");
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) batches.push(items.slice(index, index + size));
  return batches;
}
