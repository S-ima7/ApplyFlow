-- CreateEnum
CREATE TYPE "ScheduleEventSource" AS ENUM ('GOOGLE_CALENDAR', 'MANUAL');

-- AlterTable
ALTER TABLE "AiExtractionResult"
ADD COLUMN "modelName" TEXT,
ADD COLUMN "promptVersion" TEXT,
ADD COLUMN "reviewedJson" JSONB;

-- CreateTable
CREATE TABLE "ScheduleEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "applicationId" TEXT,
    "source" "ScheduleEventSource" NOT NULL,
    "externalCalendarId" TEXT,
    "externalEventId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "meetingUrl" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "startDate" TEXT,
    "endDate" TEXT,
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Tokyo',
    "externalUrl" TEXT,
    "sourceUpdatedAt" TIMESTAMP(3),
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ScheduleEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleEvent_userId_source_externalCalendarId_externalEventId_key"
ON "ScheduleEvent"("userId", "source", "externalCalendarId", "externalEventId");

-- CreateIndex
CREATE INDEX "ScheduleEvent_userId_startAt_idx" ON "ScheduleEvent"("userId", "startAt");

-- CreateIndex
CREATE INDEX "ScheduleEvent_applicationId_idx" ON "ScheduleEvent"("applicationId");

-- CreateIndex
CREATE INDEX "ScheduleEvent_deletedAt_idx" ON "ScheduleEvent"("deletedAt");

-- AddForeignKey
ALTER TABLE "ScheduleEvent" ADD CONSTRAINT "ScheduleEvent_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleEvent" ADD CONSTRAINT "ScheduleEvent_applicationId_fkey"
FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;
