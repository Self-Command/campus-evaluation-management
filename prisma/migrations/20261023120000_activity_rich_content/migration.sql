-- 活动介绍改为富文本、删除参加要求、新增活动附件
ALTER TABLE "Activity" DROP COLUMN "requirements";

CREATE TABLE "ActivityAttachment" (
    "id" TEXT NOT NULL,
    "activityId" TEXT,
    "uploaderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'FILE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityAttachment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ActivityAttachment_storageKey_key" ON "ActivityAttachment"("storageKey");
CREATE INDEX "ActivityAttachment_activityId_idx" ON "ActivityAttachment"("activityId");
CREATE INDEX "ActivityAttachment_uploaderId_createdAt_idx" ON "ActivityAttachment"("uploaderId", "createdAt");

ALTER TABLE "ActivityAttachment" ADD CONSTRAINT "ActivityAttachment_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
