-- CreateTable
CREATE TABLE "GradeImport" (
    "id" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "rows" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "snapshot" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PREVIEW',
    "result" JSONB,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GradeImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GradeImport_termId_actorId_idx" ON "GradeImport"("termId", "actorId");
