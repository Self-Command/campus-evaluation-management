import { readFileSync } from "node:fs";
import { readJson, restoreStateFile, writeJsonAtomic } from "@/server/ops-common";

export type RestorePhase =
  | "preflight"
  | "ready"
  | "confirmed"
  | "snapshot"
  | "exported"
  | "swapping"
  | "swapped"
  | "completed"
  | "failed"
  | "rolled-back";

export type RestoreState = {
  id: string;
  backupId: string;
  phase: RestorePhase;
  maintenance: boolean;
  switched: boolean;
  candidateDatabase: string;
  previousDatabase: string | null;
  safetyBackupId?: string;
  reportPath?: string;
  fingerprint?: string;
  preflightExpiresAt?: string;
  reason?: string;
  actorId: string;
  actorName: string;
  actorLogin?: string;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  auditExport?: { count: number; bytes: number; sha256: string; firstAt: string | null; lastAt: string | null };
  errorCode?: string;
  message?: string;
};

export function readRestoreStateSync(): RestoreState | null {
  try {
    const raw = readFileSync(restoreStateFile(), "utf8");
    const parsed = JSON.parse(raw) as RestoreState;
    if (!parsed || typeof parsed.id !== "string" || typeof parsed.maintenance !== "boolean") return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function readRestoreState() {
  return readJson<RestoreState>(restoreStateFile());
}

export async function writeRestoreState(state: RestoreState) {
  await writeJsonAtomic(restoreStateFile(), { ...state, updatedAt: new Date().toISOString() });
}

export async function patchRestoreState(patch: Partial<RestoreState> & Pick<RestoreState, "id">) {
  const current = await readRestoreState();
  if (!current || current.id !== patch.id) return null;
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await writeRestoreState(next);
  return next;
}

export function maintenanceState() {
  const state = readRestoreStateSync();
  return state?.maintenance ? state : null;
}
