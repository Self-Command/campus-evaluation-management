-- CreateTable
CREATE TABLE "LoginCaptcha" (
    "id" TEXT NOT NULL,
    "answerHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginCaptcha_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginFailureState" (
    "key" TEXT NOT NULL,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "policyKey" TEXT NOT NULL,
    "lockedUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoginFailureState_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "LoginCaptcha_expiresAt_idx" ON "LoginCaptcha"("expiresAt");
