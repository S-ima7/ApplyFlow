import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decideAndApplyEmailAutomation } from "@/features/email-monitor/automation";
import { saveEmailMonitorConfig } from "@/features/email-monitor/config";
import { reserveAiNeuronBudget } from "@/features/email-monitor/token-budget";
import { prisma } from "@/lib/prisma";

const runDatabaseIntegration = process.env.RUN_DATABASE_INTEGRATION === "1";
const usageDate = "2099-01-01";
let userId = "";
const jobIds: string[] = [];
let disabledJobId = "";

describe.runIf(runDatabaseIntegration)(
  "email monitor database integration",
  () => {
    beforeAll(async () => {
      await prisma.aiDailyUsage.deleteMany({
        where: { provider: "cloudflare-workers-ai", usageDate }
      });
      const user = await prisma.user.create({
        data: {
          email: `email-monitor-integration-${Date.now()}@example.invalid`
        }
      });
      userId = user.id;
      await prisma.emailMonitorConfig.create({
        data: {
          userId,
          enabled: true,
          gmailQuery: "面接",
          consentedAt: new Date("2099-01-01T00:00:00.000Z")
        }
      });

      for (let index = 0; index < 4; index += 1) {
        const emailImport = await prisma.emailImport.create({
          data: {
            userId,
            gmailMessageId: `integration-message-${index}`
          }
        });
        const job = await prisma.emailAutomationJob.create({
          data: {
            userId,
            emailImportId: emailImport.id,
            gmailMessageId: `integration-message-${index}`,
            messageDigest: `${index}`.repeat(64)
          }
        });
        if (index === 3) {
          disabledJobId = job.id;
        } else {
          jobIds.push(job.id);
        }
      }
      await prisma.aiDailyUsage.create({
        data: {
          provider: "cloudflare-workers-ai",
          usageDate,
          usedNeurons: 7_000
        }
      });
    });

    afterAll(async () => {
      if (userId) {
        await prisma.user.deleteMany({ where: { id: userId } });
      }
      await prisma.aiDailyUsage.deleteMany({
        where: { provider: "cloudflare-workers-ai", usageDate }
      });
      await prisma.$disconnect();
    });

    it("serializes concurrent reservations against the shared daily cap", async () => {
      const now = new Date("2099-01-01T00:00:00.000Z");
      await prisma.emailAutomationJob.updateMany({
        where: { id: { in: jobIds } },
        data: { status: "PROCESSING" }
      });
      const results = await Promise.all(
        jobIds.map((jobId) => reserveAiNeuronBudget(jobId, now))
      );
      const usage = await prisma.aiDailyUsage.findUniqueOrThrow({
        where: {
          provider_usageDate: {
            provider: "cloudflare-workers-ai",
            usageDate
          }
        }
      });

      expect(results.filter(Boolean)).toHaveLength(2);
      expect(usage.usedNeurons).toBe(7_000);
      expect(usage.reservedNeurons).toBe(3_000);
    });

    it("rechecks monitoring consent inside the apply transaction", async () => {
      await saveEmailMonitorConfig(
        userId,
        {
          enabled: false,
          query: "面接",
          consentToAiProcessing: false
        },
        new Date("2099-01-01T00:30:00.000Z")
      );
      await prisma.emailAutomationJob.update({
        where: { id: disabledJobId },
        data: { status: "PROCESSING" }
      });

      const result = await decideAndApplyEmailAutomation({
        jobId: disabledJobId,
        userId,
        userTimezone: "Asia/Tokyo",
        extraction: {
          relevant: true,
          eventType: "CREATE_OR_UPDATE",
          companyName: "ApplyFlow",
          position: "Engineer",
          stageType: "FIRST_INTERVIEW",
          stageName: "一次面接",
          proposedSlots: [],
          confirmedSlot: {
            startAt: "2099-01-02T10:00:00+09:00",
            endAt: "2099-01-02T11:00:00+09:00",
            timezone: "Asia/Tokyo"
          },
          replyDeadline: null,
          offerAcceptanceDeadline: null,
          meetingUrl: null,
          interviewerName: null,
          confidence: 0.99,
          fieldConfidence: {
            relevant: 0.99,
            eventType: 0.99,
            companyName: 0.99,
            position: 0.99,
            stageType: 0.99,
            stageName: 0.99,
            proposedSlots: 0.99,
            confirmedSlot: 0.99,
            replyDeadline: 0.99,
            offerAcceptanceDeadline: 0.99,
            meetingUrl: 0.99,
            interviewerName: 0.99
          }
        }
      });
      const job = await prisma.emailAutomationJob.findUniqueOrThrow({
        where: { id: disabledJobId }
      });

      expect(result).toEqual({
        action: "REVIEW_REQUIRED",
        reason: "MONITOR_DISABLED"
      });
      expect(job.status).toBe("REVIEW_REQUIRED");
      expect(job.errorCode).toBe("MONITOR_DISABLED");
    });

    it("resets an in-progress scan and reviews old-query jobs", async () => {
      await prisma.emailAutomationJob.updateMany({
        where: { id: { in: jobIds } },
        data: {
          status: "PENDING",
          errorCode: null,
          processedAt: null
        }
      });
      await prisma.emailMonitorConfig.update({
        where: { userId },
        data: {
          scanUpperBoundAt: new Date("2098-12-31T23:59:00.000Z"),
          scanPageToken: "old-query-page"
        }
      });
      const changedAt = new Date("2099-01-01T01:00:00.000Z");

      const config = await saveEmailMonitorConfig(
        userId,
        {
          enabled: true,
          query: "内定",
          consentToAiProcessing: true
        },
        changedAt
      );
      const [jobs, usage] = await Promise.all([
        prisma.emailAutomationJob.findMany({
          where: { id: { in: jobIds } },
          select: { status: true, errorCode: true }
        }),
        prisma.aiDailyUsage.findUniqueOrThrow({
          where: {
            provider_usageDate: {
              provider: "cloudflare-workers-ai",
              usageDate
            }
          }
        })
      ]);

      expect(config.cursorAt).toEqual(changedAt);
      expect(config.monitoringSince).toEqual(changedAt);
      expect(config.scanUpperBoundAt).toBeNull();
      expect(config.scanPageToken).toBeNull();
      expect(jobs).toHaveLength(3);
      expect(jobs.every((job) => job.status === "REVIEW_REQUIRED")).toBe(true);
      expect(
        jobs.every((job) => job.errorCode === "MONITOR_QUERY_CHANGED")
      ).toBe(true);
      expect(usage.usedNeurons).toBe(10_000);
      expect(usage.reservedNeurons).toBe(0);
    });
  }
);
