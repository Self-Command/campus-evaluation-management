-- Publishing now implies a confirmed score. Repair only the abnormal existing
-- rows that are published but not confirmed; drafts are left untouched.
UPDATE "Activity" SET "confirmed" = true WHERE "publishedAt" IS NOT NULL AND "confirmed" = false;
