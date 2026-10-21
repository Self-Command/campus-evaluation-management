-- Third batch: activities belong to a host college, official roster sealing,
-- shared versioned activity evidence and student-home two-stage participation review.
CREATE TYPE "RecognitionStatus" AS ENUM ('PENDING_COUNSELOR', 'PENDING_COLLEGE', 'RETURNED', 'APPROVED', 'SUPERSEDED', 'WITHDRAWN', 'REVOKED', 'REJECTED');

-- A host college is assigned explicitly. Legacy publisher activities without a
-- configured owner college stay unassigned until an administrator hands them over.
ALTER TABLE "Activity" ADD COLUMN "collegeId" TEXT;
UPDATE "Activity" a SET "collegeId" = u."collegeId"
FROM "User" u
WHERE a."ownerId" = u."id" AND u."collegeId" IS NOT NULL;
ALTER TABLE "Activity" ADD COLUMN "rosterCommittedAt" TIMESTAMP(3);
ALTER TABLE "Activity" ADD COLUMN "rosterRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Activity" ADD COLUMN "rosterImportId" TEXT;
ALTER TABLE "Activity" ADD COLUMN "sharedEvidenceVersion" INTEGER NOT NULL DEFAULT 0;

UPDATE "Activity" a SET
  "rosterCommittedAt" = i."firstCommittedAt",
  "rosterRevision" = i."committedCount",
  "rosterImportId" = i."lastImportId"
FROM (
  SELECT "activityId", MIN("createdAt") AS "firstCommittedAt", COUNT(*)::INTEGER AS "committedCount",
    (ARRAY_AGG("id" ORDER BY "createdAt" DESC))[1] AS "lastImportId"
  FROM "ParticipationImport"
  WHERE "status" = 'COMMITTED'
  GROUP BY "activityId"
) i
WHERE a."id" = i."activityId";

ALTER TABLE "Activity" ADD CONSTRAINT "Activity_collegeId_fkey" FOREIGN KEY ("collegeId") REFERENCES "College"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Activity_termId_collegeId_idx" ON "Activity"("termId", "collegeId");

CREATE TABLE "ActivityEvidence" (
  "id" TEXT NOT NULL,
  "activityId" TEXT NOT NULL,
  "evidenceId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "uploadedBy" TEXT NOT NULL,
  "note" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ActivityEvidence_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "ActivityEvidence" ADD CONSTRAINT "ActivityEvidence_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ActivityEvidence" ADD CONSTRAINT "ActivityEvidence_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "Evidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "ActivityEvidence_activityId_version_key" ON "ActivityEvidence"("activityId", "version");
CREATE INDEX "ActivityEvidence_activityId_active_idx" ON "ActivityEvidence"("activityId", "active");

ALTER TABLE "Participation" ADD COLUMN "removedAt" TIMESTAMP(3);
ALTER TABLE "Participation" ADD COLUMN "removedBy" TEXT;
ALTER TABLE "Participation" ADD COLUMN "removalReason" TEXT;
ALTER TABLE "Participation" ADD CONSTRAINT "Participation_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Participation_activityId_removedAt_idx" ON "Participation"("activityId", "removedAt");

ALTER TABLE "RecognitionSource" ADD COLUMN "counselorId" TEXT;
ALTER TABLE "RecognitionSource" ADD COLUMN "counseledAt" TIMESTAMP(3);
ALTER TABLE "RecognitionSource" ADD COLUMN "collegeReviewerId" TEXT;
ALTER TABLE "RecognitionSource" ADD COLUMN "collegeReviewedAt" TIMESTAMP(3);
ALTER TABLE "RecognitionSource" ADD COLUMN "returnedByRole" TEXT;
ALTER TABLE "RecognitionSource" ADD COLUMN "activityEvidenceId" TEXT;
ALTER TABLE "RecognitionSource" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "RecognitionSource" ALTER COLUMN "status" TYPE "RecognitionStatus" USING (
  CASE "status"::text
    WHEN 'PENDING' THEN 'PENDING_COUNSELOR'
    WHEN 'NEEDS_CHANGES' THEN 'RETURNED'
    ELSE "status"::text
  END::"RecognitionStatus"
);
ALTER TABLE "RecognitionSource" ALTER COLUMN "status" SET DEFAULT 'PENDING_COUNSELOR';
ALTER TABLE "RecognitionSource" ADD CONSTRAINT "RecognitionSource_activityEvidenceId_fkey" FOREIGN KEY ("activityEvidenceId") REFERENCES "ActivityEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "RecognitionSource_status_createdAt_idx" ON "RecognitionSource"("status", "createdAt");

ALTER TABLE "ParticipationImport" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'INITIAL';
ALTER TABLE "ParticipationImport" ADD COLUMN "reason" TEXT;
ALTER TABLE "ParticipationImport" ADD COLUMN "diff" JSONB;
ALTER TABLE "ParticipationImport" ADD COLUMN "baselineRevision" INTEGER;
CREATE INDEX "ParticipationImport_activityId_createdAt_idx" ON "ParticipationImport"("activityId", "createdAt");
