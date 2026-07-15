-- CreateEnum
CREATE TYPE "BrowserMessageEventType" AS ENUM ('CREATE_OR_UPDATE', 'RESCHEDULE', 'CANCEL');

-- CreateTable
CREATE TABLE "BrowserMessageImport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "interviewId" TEXT,
    "sourceSite" TEXT NOT NULL,
    "eventType" "BrowserMessageEventType" NOT NULL,
    "messageDigest" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrowserMessageImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BrowserMessageImport_userId_idempotencyKey_key" ON "BrowserMessageImport"("userId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "BrowserMessageImport_userId_applicationId_messageDigest_key" ON "BrowserMessageImport"("userId", "applicationId", "messageDigest");

-- CreateIndex
CREATE INDEX "BrowserMessageImport_applicationId_createdAt_idx" ON "BrowserMessageImport"("applicationId", "createdAt");

-- CreateIndex
CREATE INDEX "BrowserMessageImport_interviewId_idx" ON "BrowserMessageImport"("interviewId");

-- AddForeignKey
ALTER TABLE "BrowserMessageImport" ADD CONSTRAINT "BrowserMessageImport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrowserMessageImport" ADD CONSTRAINT "BrowserMessageImport_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrowserMessageImport" ADD CONSTRAINT "BrowserMessageImport_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE SET NULL ON UPDATE CASCADE;
