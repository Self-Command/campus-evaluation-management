-- CreateTable
CREATE TABLE "AccountImport" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "rows" JSONB NOT NULL,
    "snapshot" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PREVIEW',
    "result" JSONB,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountImport_actorId_createdAt_idx" ON "AccountImport"("actorId", "createdAt");
