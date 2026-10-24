import { applyRetention, cleanupExpiredUploads, cleanupStaleTasks } from "@/server/backup";
import { runScheduledAuditPurge } from "@/server/ops-policy";
import { cleanupRestoreArtifacts, reconcileRestoreOnStartup } from "@/server/restore";
import { readRestoreStateSync } from "@/server/restore-state";

const FIRST_CYCLE_DELAY_MS = 10 * 60_000;
const CYCLE_INTERVAL_MS = 24 * 60 * 60_000;

let started = false;

async function safely(label: string, task: () => Promise<unknown>) {
  // Restore reconciliation must run even while maintenance mode is on; it is the
  // only startup path that can roll back an interrupted database swap. Other
  // maintenance tasks stay paused until the restore state is terminal.
  if (label !== "restore-reconcile" && readRestoreStateSync()?.maintenance) return;
  try {
    await task();
  } catch (error) {
    console.error("后台维护任务失败", label, error instanceof Error ? error.name : "UnknownError");
  }
}

async function startupCycle() {
  await safely("restore-reconcile", reconcileRestoreOnStartup);
  await safely("backup-stale", cleanupStaleTasks);
  await safely("upload-expired", cleanupExpiredUploads);
  await safely("restore-artifacts", cleanupRestoreArtifacts);
}

async function dailyCycle() {
  await safely("audit-purge", runScheduledAuditPurge);
  await safely("backup-retention", applyRetention);
  await safely("backup-stale", cleanupStaleTasks);
  await safely("upload-expired", cleanupExpiredUploads);
  await safely("restore-reconcile", reconcileRestoreOnStartup);
  await safely("restore-artifacts", cleanupRestoreArtifacts);
}

export function startOpsMaintenance() {
  if (started) return;
  started = true;
  setTimeout(() => void startupCycle(), 2_000).unref?.();
  setTimeout(() => void dailyCycle(), FIRST_CYCLE_DELAY_MS).unref?.();
  setInterval(() => void dailyCycle(), CYCLE_INTERVAL_MS).unref?.();
}
