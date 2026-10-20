-- CreateTable
CREATE TABLE "ParticipationImport" (
    "id" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "rows" JSONB NOT NULL,
    "evidenceIds" JSONB NOT NULL,
    "note" TEXT NOT NULL,
    "snapshot" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PREVIEW',
    "result" JSONB,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParticipationImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ParticipationImport_termId_actorId_idx" ON "ParticipationImport"("termId", "actorId");
