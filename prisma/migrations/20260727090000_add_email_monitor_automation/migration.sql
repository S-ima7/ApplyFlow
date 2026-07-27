-- CreateEnum
CREATE TYPE "EmailAutomationJobStatus" AS ENUM (
    'PENDING',
    'PROCESSING',
    'AUTO_APPLIED',
    'REVIEW_REQUIRED',
    'IGNORED',
    'RETRY_WAIT',
    'FAILED'
);

-- CreateTable
CREATE TABLE "EmailMonitorConfig" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "gmailQuery" TEXT NOT NULL,
    "consentedAt" TIMESTAMP(3),
    "cursorAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scanUpperBoundAt" TIMESTAMP(3),
    "scanPageToken" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailMonitorConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailAutomationJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emailImportId" TEXT NOT NULL,
    "gmailMessageId" TEXT NOT NULL,
    "messageDigest" TEXT NOT NULL,
    "status" "EmailAutomationJobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseUntil" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "aiInputTokens" INTEGER NOT NULL DEFAULT 0,
    "aiOutputTokens" INTEGER NOT NULL DEFAULT 0,
    "aiTotalTokens" INTEGER NOT NULL DEFAULT 0,
    "extractionResultId" TEXT,
    "matchedApplicationId" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailAutomationJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailAutomationChange" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "interviewId" TEXT,
    "beforeJson" JSONB NOT NULL,
    "afterJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailAutomationChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailMonitorConfig_userId_key" ON "EmailMonitorConfig"("userId");

-- CreateIndex
CREATE INDEX "EmailMonitorConfig_enabled_cursorAt_idx" ON "EmailMonitorConfig"("enabled", "cursorAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailAutomationJob_emailImportId_key" ON "EmailAutomationJob"("emailImportId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailAutomationJob_extractionResultId_key" ON "EmailAutomationJob"("extractionResultId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailAutomationJob_userId_gmailMessageId_messageDigest_key" ON "EmailAutomationJob"("userId", "gmailMessageId", "messageDigest");

-- CreateIndex
CREATE INDEX "EmailAutomationJob_status_nextAttemptAt_leaseUntil_idx" ON "EmailAutomationJob"("status", "nextAttemptAt", "leaseUntil");

-- CreateIndex
CREATE INDEX "EmailAutomationJob_userId_createdAt_idx" ON "EmailAutomationJob"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "EmailAutomationJob_matchedApplicationId_idx" ON "EmailAutomationJob"("matchedApplicationId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailAutomationChange_jobId_key" ON "EmailAutomationChange"("jobId");

-- CreateIndex
CREATE INDEX "EmailAutomationChange_userId_createdAt_idx" ON "EmailAutomationChange"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "EmailAutomationChange_applicationId_createdAt_idx" ON "EmailAutomationChange"("applicationId", "createdAt");

-- CreateIndex
CREATE INDEX "EmailAutomationChange_interviewId_createdAt_idx" ON "EmailAutomationChange"("interviewId", "createdAt");

-- AddForeignKey
ALTER TABLE "EmailMonitorConfig" ADD CONSTRAINT "EmailMonitorConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailAutomationJob" ADD CONSTRAINT "EmailAutomationJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailAutomationJob" ADD CONSTRAINT "EmailAutomationJob_emailImportId_fkey" FOREIGN KEY ("emailImportId") REFERENCES "EmailImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailAutomationJob" ADD CONSTRAINT "EmailAutomationJob_extractionResultId_fkey" FOREIGN KEY ("extractionResultId") REFERENCES "AiExtractionResult"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailAutomationJob" ADD CONSTRAINT "EmailAutomationJob_matchedApplicationId_fkey" FOREIGN KEY ("matchedApplicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailAutomationChange" ADD CONSTRAINT "EmailAutomationChange_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "EmailAutomationJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailAutomationChange" ADD CONSTRAINT "EmailAutomationChange_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailAutomationChange" ADD CONSTRAINT "EmailAutomationChange_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailAutomationChange" ADD CONSTRAINT "EmailAutomationChange_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE SET NULL ON UPDATE CASCADE;
