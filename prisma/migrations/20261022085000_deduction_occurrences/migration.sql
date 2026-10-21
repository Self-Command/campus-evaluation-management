-- Deduction events: a project may carry several independent events. The previous
-- model silently kept one row per project, so different incidents overwrote each
-- other. Existing rows become the first event (occurrence 0).
ALTER TABLE "DeductionInput" ADD COLUMN "occurrence" INTEGER NOT NULL DEFAULT 0;

DROP INDEX "DeductionInput_termId_studentId_projectId_key";

CREATE INDEX "DeductionInput_termId_studentId_projectId_idx" ON "DeductionInput"("termId", "studentId", "projectId");

CREATE UNIQUE INDEX "DeductionInput_termId_studentId_projectId_occurrence_key" ON "DeductionInput"("termId", "studentId", "projectId", "occurrence");
