-- One import batch now targets exactly one role. Historical batches were
-- student batches, so the default keeps them interpretable.
ALTER TABLE "AccountImport" ADD COLUMN "targetRole" TEXT NOT NULL DEFAULT 'STUDENT';

-- Logins are compared case-insensitively in account creation and imports.
-- Enforce the same rule at the database boundary so concurrent writers cannot
-- create "ZhangSan" and "zhangsan" as separate accounts.
CREATE UNIQUE INDEX "User_login_lower_key" ON "User" (lower("login"));
