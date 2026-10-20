ALTER TABLE "Term" ADD COLUMN "cohortPublicationId" TEXT, ADD COLUMN "cohortPolicy" TEXT NOT NULL DEFAULT 'CURRENT';
ALTER TABLE "Activity"
  ADD COLUMN "publishedAt" TIMESTAMP(3),
  ADD COLUMN "publishRevision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "scoreMode" TEXT NOT NULL DEFAULT 'FIXED',
  ADD COLUMN "audienceColleges" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "audienceClasses" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "audienceStudents" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Participation"
  ADD COLUMN "registeredAt" TIMESTAMP(3),
  ADD COLUMN "registeredBy" TEXT,
  ADD COLUMN "registrationSnapshot" JSONB,
  ADD COLUMN "importBatchId" TEXT,
  ADD COLUMN "score" DECIMAL(22,12),
  ADD COLUMN "history" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "RecognitionSource" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'LEGACY', ADD COLUMN "importBatchId" TEXT;
ALTER TABLE "PersonalClaim" ADD COLUMN "activityId" TEXT;
CREATE TABLE "PublicationExtension" (
  "id" TEXT NOT NULL,
  "publicationId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "checkingEndsAt" TIMESTAMP(3) NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PublicationExtension_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PublicationExtension_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "ResultPublication"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "PublicationExtension_publicationId_checkingEndsAt_idx" ON "PublicationExtension"("publicationId", "checkingEndsAt");
CREATE INDEX "Activity_termId_publishedAt_idx" ON "Activity"("termId", "publishedAt");
CREATE INDEX "Participation_studentId_registeredAt_idx" ON "Participation"("studentId", "registeredAt");
CREATE INDEX "PersonalClaim_activityId_studentId_idx" ON "PersonalClaim"("activityId", "studentId");
