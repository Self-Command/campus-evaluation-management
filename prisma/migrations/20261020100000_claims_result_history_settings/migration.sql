-- CreateEnum
CREATE TYPE "AppealStatus" AS ENUM ('OPEN', 'PROCESSING', 'RESOLVED', 'REJECTED', 'WITHDRAWN');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ReviewStatus" ADD VALUE 'NEEDS_CHANGES';
ALTER TYPE "ReviewStatus" ADD VALUE 'WITHDRAWN';
ALTER TYPE "ReviewStatus" ADD VALUE 'REVOKED';

-- AlterTable
ALTER TABLE "Term" ADD COLUMN     "publicationSequence" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "publishedResultSetId" TEXT;

-- AlterTable
ALTER TABLE "RecognitionSource" ADD COLUMN     "history" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "RecognitionProject" (
    "id" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "points" DECIMAL(22,12) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecognitionProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonalClaim" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "factKey" TEXT NOT NULL,
    "occurredOn" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "reviewReason" TEXT,
    "reviewerId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 0,
    "history" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonalClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimEvidence" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,

    CONSTRAINT "ClaimEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResultPublication" (
    "id" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "actorId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "scheme" JSONB NOT NULL,
    "termRevision" INTEGER NOT NULL,
    "inputRevision" INTEGER NOT NULL,
    "studentCount" INTEGER NOT NULL,
    "checkingEndsAt" TIMESTAMP(3) NOT NULL,
    "requireConfirmation" BOOLEAN NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResultPublication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublishedResult" (
    "id" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "login" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "college" TEXT NOT NULL,
    "major" TEXT NOT NULL,
    "className" TEXT NOT NULL,
    "total" DECIMAL(30,2) NOT NULL,
    "resultHash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "PublishedResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResultConfirmation" (
    "id" TEXT NOT NULL,
    "resultId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "resultHash" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResultConfirmation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResultAppeal" (
    "id" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "resultHash" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "AppealStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "resolvedPublicationId" TEXT,
    "reviewerId" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResultAppeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppealEvidence" (
    "id" TEXT NOT NULL,
    "appealId" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,

    CONSTRAINT "AppealEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementSnapshot" (
    "id" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "sha256" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettlementSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TermReopen" (
    "id" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "publicationId" TEXT,
    "snapshotId" TEXT,
    "actorId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "previousPhase" "TermPhase" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TermReopen_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteSettings" (
    "id" TEXT NOT NULL DEFAULT 'site',
    "content" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandAsset" (
    "id" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "bytes" BYTEA NOT NULL,
    "sha256" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrandAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecognitionProject_termId_enabled_idx" ON "RecognitionProject"("termId", "enabled");

-- CreateIndex
CREATE INDEX "PersonalClaim_studentId_status_idx" ON "PersonalClaim"("studentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PersonalClaim_projectId_studentId_factKey_key" ON "PersonalClaim"("projectId", "studentId", "factKey");

-- CreateIndex
CREATE UNIQUE INDEX "ClaimEvidence_claimId_evidenceId_key" ON "ClaimEvidence"("claimId", "evidenceId");

-- CreateIndex
CREATE UNIQUE INDEX "ResultPublication_termId_sequence_key" ON "ResultPublication"("termId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "ResultPublication_termId_requestId_key" ON "ResultPublication"("termId", "requestId");

-- CreateIndex
CREATE INDEX "PublishedResult_publicationId_college_major_className_idx" ON "PublishedResult"("publicationId", "college", "major", "className");

-- CreateIndex
CREATE UNIQUE INDEX "PublishedResult_publicationId_studentId_key" ON "PublishedResult"("publicationId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "ResultConfirmation_resultId_key" ON "ResultConfirmation"("resultId");

-- CreateIndex
CREATE INDEX "ResultAppeal_termId_studentId_status_idx" ON "ResultAppeal"("termId", "studentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AppealEvidence_appealId_evidenceId_key" ON "AppealEvidence"("appealId", "evidenceId");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementSnapshot_publicationId_key" ON "SettlementSnapshot"("publicationId");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementSnapshot_termId_requestId_key" ON "SettlementSnapshot"("termId", "requestId");

-- AddForeignKey
ALTER TABLE "RecognitionProject" ADD CONSTRAINT "RecognitionProject_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalClaim" ADD CONSTRAINT "PersonalClaim_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "RecognitionProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimEvidence" ADD CONSTRAINT "ClaimEvidence_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "PersonalClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimEvidence" ADD CONSTRAINT "ClaimEvidence_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "Evidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultPublication" ADD CONSTRAINT "ResultPublication_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishedResult" ADD CONSTRAINT "PublishedResult_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "ResultPublication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultConfirmation" ADD CONSTRAINT "ResultConfirmation_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "PublishedResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultAppeal" ADD CONSTRAINT "ResultAppeal_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "ResultPublication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppealEvidence" ADD CONSTRAINT "AppealEvidence_appealId_fkey" FOREIGN KEY ("appealId") REFERENCES "ResultAppeal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppealEvidence" ADD CONSTRAINT "AppealEvidence_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "Evidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementSnapshot" ADD CONSTRAINT "SettlementSnapshot_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TermReopen" ADD CONSTRAINT "TermReopen_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
