-- Activity scoring is always one fixed value for every participant.
-- Remove the discontinued per-student score and direct-student audience fields.
ALTER TABLE "Activity" DROP COLUMN "scoreMode";
ALTER TABLE "Activity" DROP COLUMN "audienceStudents";
ALTER TABLE "Participation" DROP COLUMN "score";
