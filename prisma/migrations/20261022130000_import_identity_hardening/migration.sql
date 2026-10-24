-- Add safe merge marker. Accounts are never deleted; a duplicate can point to
-- the retained canonical account for audit and later review.
ALTER TABLE "User" ADD COLUMN "mergedIntoId" TEXT;

ALTER TABLE "AccountImport"
  ADD COLUMN "note" TEXT,
  ADD COLUMN "fileHash" TEXT,
  ADD COLUMN "templateVersion" TEXT,
  ADD COLUMN "scopeKey" TEXT,
  ADD COLUMN "requestId" TEXT,
  ADD COLUMN "rowResults" JSONB,
  ADD COLUMN "confirmations" JSONB,
  ADD COLUMN "committedAt" TIMESTAMP(3);

ALTER TABLE "GradeImport"
  ADD COLUMN "fileHash" TEXT,
  ADD COLUMN "templateVersion" TEXT,
  ADD COLUMN "scopeKey" TEXT,
  ADD COLUMN "requestId" TEXT,
  ADD COLUMN "rowResults" JSONB,
  ADD COLUMN "confirmations" JSONB,
  ADD COLUMN "committedAt" TIMESTAMP(3);

ALTER TABLE "ParticipationImport"
  ADD COLUMN "fileHash" TEXT,
  ADD COLUMN "templateVersion" TEXT,
  ADD COLUMN "scopeKey" TEXT,
  ADD COLUMN "requestId" TEXT,
  ADD COLUMN "rowResults" JSONB,
  ADD COLUMN "confirmations" JSONB,
  ADD COLUMN "committedAt" TIMESTAMP(3);

CREATE TABLE "DuplicateIdentityException" (
  "id" TEXT NOT NULL,
  "classKey" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "studentNumberA" TEXT NOT NULL,
  "studentNumberB" TEXT NOT NULL,
  "studentIdA" TEXT,
  "studentIdB" TEXT,
  "batchId" TEXT,
  "actorId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DuplicateIdentityException_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DuplicateIdentityException_classKey_normalizedName_studentNumberA_studentNumberB_key"
  ON "DuplicateIdentityException"("classKey", "normalizedName", "studentNumberA", "studentNumberB");
CREATE INDEX "DuplicateIdentityException_classKey_normalizedName_idx"
  ON "DuplicateIdentityException"("classKey", "normalizedName");
CREATE INDEX "DuplicateIdentityException_actorId_createdAt_idx"
  ON "DuplicateIdentityException"("actorId", "createdAt");

CREATE INDEX "User_mergedIntoId_idx" ON "User"("mergedIntoId");
ALTER TABLE "User" ADD CONSTRAINT "User_mergedIntoId_fkey"
  FOREIGN KEY ("mergedIntoId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
