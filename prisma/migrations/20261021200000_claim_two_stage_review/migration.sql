-- CreateEnum: two-stage claim review statuses (draft-free submission, counselor scoring,
-- college final review, unified return, rescoring, abandon, controlled revocation).
CREATE TYPE "ClaimStatus" AS ENUM ('PENDING_COUNSELOR', 'PENDING_COLLEGE', 'RETURNED', 'RESCORING', 'APPROVED', 'ABANDONED', 'REVOKED', 'REJECTED');

-- AlterTable: direct period link, backfilled from the legacy project relation.
ALTER TABLE "PersonalClaim" ADD COLUMN "termId" TEXT;
UPDATE "PersonalClaim" c SET "termId" = p."termId" FROM "RecognitionProject" p WHERE c."projectId" = p."id";
ALTER TABLE "PersonalClaim" ALTER COLUMN "termId" SET NOT NULL;

-- AlterTable: submission title, backfilled from the legacy project name for history display.
ALTER TABLE "PersonalClaim" ADD COLUMN "title" TEXT;
UPDATE "PersonalClaim" c SET "title" = p."name" FROM "RecognitionProject" p WHERE c."projectId" = p."id";
ALTER TABLE "PersonalClaim" ALTER COLUMN "title" SET NOT NULL;

-- AlterTable: counselor scoring bound to the current claim revision.
ALTER TABLE "PersonalClaim" ADD COLUMN "scoreNodeId" TEXT;
ALTER TABLE "PersonalClaim" ADD COLUMN "score" DECIMAL(22,12);
ALTER TABLE "PersonalClaim" ADD COLUMN "scorerId" TEXT;
ALTER TABLE "PersonalClaim" ADD COLUMN "scoredAt" TIMESTAMP(3);

-- AlterColumn: switch the claim status machine; legacy in-flight rows are handed over
-- to the new flow, terminal history values keep their meaning.
ALTER TABLE "PersonalClaim" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "PersonalClaim" ALTER COLUMN "status" TYPE "ClaimStatus" USING (
  CASE "status"::text
    WHEN 'PENDING' THEN 'PENDING_COUNSELOR'
    WHEN 'NEEDS_CHANGES' THEN 'RETURNED'
    WHEN 'WITHDRAWN' THEN 'ABANDONED'
    ELSE "status"::text
  END::"ClaimStatus"
);
ALTER TABLE "PersonalClaim" ALTER COLUMN "status" SET DEFAULT 'PENDING_COUNSELOR';

-- AlterColumn: new claims are independent fact requests; project and fact key become legacy-only.
ALTER TABLE "PersonalClaim" ALTER COLUMN "projectId" DROP NOT NULL;
ALTER TABLE "PersonalClaim" ALTER COLUMN "factKey" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "PersonalClaim" ADD CONSTRAINT "PersonalClaim_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "PersonalClaim_termId_status_idx" ON "PersonalClaim"("termId", "status");
