-- CreateEnum
CREATE TYPE "InputChangeStatus" AS ENUM ('PENDING_COLLEGE', 'RETURNED', 'APPROVED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "DeductionChangeAction" AS ENUM ('CREATE', 'REVOKE');

-- CreateTable
CREATE TABLE "GradeChange" (
    "id" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "value" DECIMAL(22,12) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "InputChangeStatus" NOT NULL DEFAULT 'PENDING_COLLEGE',
    "requestId" TEXT NOT NULL,
    "baseInputId" TEXT,
    "baseRevision" INTEGER,
    "baseValue" DECIMAL(22,12),
    "submittedBy" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewerId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewReason" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "history" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GradeChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeductionChange" (
    "id" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "action" "DeductionChangeAction" NOT NULL,
    "amount" DECIMAL(22,12),
    "reason" TEXT NOT NULL,
    "status" "InputChangeStatus" NOT NULL DEFAULT 'PENDING_COLLEGE',
    "requestId" TEXT NOT NULL,
    "targetInputId" TEXT,
    "targetRevision" INTEGER,
    "submittedBy" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewerId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewReason" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "history" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeductionChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GradeChange_termId_status_submittedAt_idx" ON "GradeChange"("termId", "status", "submittedAt");

-- CreateIndex
CREATE INDEX "GradeChange_termId_studentId_nodeId_status_idx" ON "GradeChange"("termId", "studentId", "nodeId", "status");

-- CreateIndex
CREATE INDEX "GradeChange_submittedBy_status_idx" ON "GradeChange"("submittedBy", "status");

-- CreateIndex
CREATE UNIQUE INDEX "GradeChange_termId_submittedBy_requestId_key" ON "GradeChange"("termId", "submittedBy", "requestId");

-- CreateIndex
CREATE INDEX "DeductionChange_termId_status_submittedAt_idx" ON "DeductionChange"("termId", "status", "submittedAt");

-- CreateIndex
CREATE INDEX "DeductionChange_termId_studentId_projectId_status_idx" ON "DeductionChange"("termId", "studentId", "projectId", "status");

-- CreateIndex
CREATE INDEX "DeductionChange_submittedBy_status_idx" ON "DeductionChange"("submittedBy", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DeductionChange_termId_submittedBy_requestId_key" ON "DeductionChange"("termId", "submittedBy", "requestId");

-- AddForeignKey
ALTER TABLE "GradeChange" ADD CONSTRAINT "GradeChange_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeductionChange" ADD CONSTRAINT "DeductionChange_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE CASCADE ON UPDATE CASCADE;
