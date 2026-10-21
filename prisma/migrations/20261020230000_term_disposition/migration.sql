-- CreateEnum
CREATE TYPE "TermDisposition" AS ENUM ('NORMAL', 'ARCHIVED', 'VOID', 'DELETED');

-- AlterTable
ALTER TABLE "Term" ADD COLUMN     "disposition" "TermDisposition" NOT NULL DEFAULT 'NORMAL',
ADD COLUMN     "dispositionAt" TIMESTAMP(3),
ADD COLUMN     "dispositionReason" TEXT;
