-- CreateTable
CREATE TABLE "DeductionInput" (
    "id" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "amount" DECIMAL(22,12) NOT NULL,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeductionInput_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeductionInput_termId_studentId_projectId_key" ON "DeductionInput"("termId", "studentId", "projectId");

-- AddForeignKey
ALTER TABLE "DeductionInput" ADD CONSTRAINT "DeductionInput_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeductionInput" ADD CONSTRAINT "DeductionInput_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
