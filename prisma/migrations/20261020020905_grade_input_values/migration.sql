-- CreateTable
CREATE TABLE "GradeInput" (
    "id" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "value" DECIMAL(22,12) NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GradeInput_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GradeInput_termId_studentId_nodeId_key" ON "GradeInput"("termId", "studentId", "nodeId");

-- AddForeignKey
ALTER TABLE "GradeInput" ADD CONSTRAINT "GradeInput_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradeInput" ADD CONSTRAINT "GradeInput_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
