-- Audit records gain operator snapshots, request metadata, first-class reasons
-- and a result. Historic rows keep their original values and degrade to
-- SYSTEM/SUCCESS rather than being guessed or rewritten.
ALTER TABLE "AuditEvent"
  ADD COLUMN "actorName" TEXT,
  ADD COLUMN "actorLogin" TEXT,
  ADD COLUMN "actorRole" TEXT,
  ADD COLUMN "category" TEXT NOT NULL DEFAULT 'SYSTEM',
  ADD COLUMN "targetType" TEXT,
  ADD COLUMN "targetLabel" TEXT,
  ADD COLUMN "reason" TEXT,
  ADD COLUMN "result" TEXT NOT NULL DEFAULT 'SUCCESS',
  ADD COLUMN "requestId" TEXT,
  ADD COLUMN "route" TEXT,
  ADD COLUMN "method" TEXT,
  ADD COLUMN "ip" TEXT,
  ADD COLUMN "userAgent" TEXT;

CREATE INDEX "AuditEvent_createdAt_id_idx" ON "AuditEvent"("createdAt", "id");
CREATE INDEX "AuditEvent_actorId_createdAt_idx" ON "AuditEvent"("actorId", "createdAt");
CREATE INDEX "AuditEvent_category_createdAt_idx" ON "AuditEvent"("category", "createdAt");
CREATE INDEX "AuditEvent_action_createdAt_idx" ON "AuditEvent"("action", "createdAt");
CREATE INDEX "AuditEvent_targetType_targetId_createdAt_idx" ON "AuditEvent"("targetType", "targetId", "createdAt");
CREATE INDEX "AuditEvent_requestId_idx" ON "AuditEvent"("requestId");

CREATE TABLE "SystemPolicy" (
  "id" TEXT NOT NULL DEFAULT 'system',
  "auditRetentionDays" INTEGER NOT NULL DEFAULT 180,
  "auditAutoPurgeEnabled" BOOLEAN NOT NULL DEFAULT true,
  "backupRetentionCount" INTEGER NOT NULL DEFAULT 14,
  "backupSafetyRetentionDays" INTEGER NOT NULL DEFAULT 7,
  "previousDatabaseRetentionDays" INTEGER NOT NULL DEFAULT 7,
  "restoreReportRetentionDays" INTEGER NOT NULL DEFAULT 180,
  "restoreCandidateTtlMinutes" INTEGER NOT NULL DEFAULT 30,
  "lastPurgeAt" TIMESTAMP(3),
  "lastPurgeCount" INTEGER,
  "lastPurgeResult" TEXT,
  "lastRestoreAt" TIMESTAMP(3),
  "revision" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SystemPolicy_pkey" PRIMARY KEY ("id")
);
