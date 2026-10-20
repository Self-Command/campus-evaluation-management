-- CreateEnum
CREATE TYPE "TermPhase" AS ENUM ('CONFIGURATION', 'ACTIVE', 'CHECKING', 'LOCKED');

-- CreateTable
CREATE TABLE "Term" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phase" "TermPhase" NOT NULL DEFAULT 'CONFIGURATION',
    "scheme" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "inputRevision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Term_pkey" PRIMARY KEY ("id")
);
