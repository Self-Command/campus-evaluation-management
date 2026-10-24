-- Import batches can be revoked only as a whole. The original result and row
-- results stay frozen as the record of what the batch created.
ALTER TABLE "AccountImport"
  ADD COLUMN "revokedAt" TIMESTAMP(3),
  ADD COLUMN "revokedBy" TEXT,
  ADD COLUMN "revokeReason" TEXT,
  ADD COLUMN "revokeResult" JSONB;

CREATE INDEX "AccountImport_createdAt_idx" ON "AccountImport"("createdAt");
