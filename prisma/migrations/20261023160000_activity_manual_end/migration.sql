-- Manual completion keeps the planned schedule intact while removing the
-- activity from the student feed immediately.
ALTER TABLE "Activity" ADD COLUMN "endedAt" TIMESTAMP(3);
