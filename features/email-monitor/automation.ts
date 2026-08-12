import {
  ActivityAction,
  ApplicationStatus,
  DeadlineStatus,
  DeadlineType,
  EmailAutomationJobStatus,
  InterviewStatus,
  Prisma,
  ProposedSlotStatus,
  StageStatus
} from "@prisma/client";
import {
  isExactCompanyName,
  isExactMatchText
} from "@/features/browser-extension/application-matching";
import {
  decideEmailAutomation,
  type EmailAutomationApplicationCandidate,
  type EmailAutomationDecision,
  type EmailAutomationTargetContext
} from "@/features/email-monitor/policy";
import type { EmailMonitorExtraction } from "@/features/email-monitor/schema";
import type { EmailAiExtraction } from "@/features/email-import/schema";
import { prisma } from "@/lib/prisma";

const INACTIVE_INTERVIEW_STATUSES = [
  InterviewStatus.CANCELLED,
  InterviewStatus.COMPLETED,
  InterviewStatus.EXPIRED
];

export async function decideAndApplyEmailAutomation(input: {
  jobId: string;
  userId: string;
  userTimezone: string;
  extraction: EmailMonitorExtraction;
}) {
  return prisma.$transaction(async (tx) => {
    const [monitorConfig] = await tx.$queryRaw<
      Array<{ enabled: boolean; consentedAt: Date | null }>
    >`
      SELECT "enabled", "consentedAt"
      FROM "EmailMonitorConfig"
      WHERE "userId" = ${input.userId}
      FOR UPDATE
    `;
    const job = await tx.emailAutomationJob.findFirst({
      where: { id: input.jobId, userId: input.userId },
      select: { id: true, status: true }
    });

    if (!job) {
      throw new Error("Email automation job was not found");
    }
    if (job.status !== EmailAutomationJobStatus.PROCESSING) {
      return { action: "UNCHANGED" as const, status: job.status };
    }
    if (!monitorConfig?.enabled || !monitorConfig.consentedAt) {
      await tx.emailAutomationJob.update({
        where: { id: input.jobId },
        data: {
          status: EmailAutomationJobStatus.REVIEW_REQUIRED,
          errorCode: "MONITOR_DISABLED",
          errorMessage: null,
          leaseUntil: null,
          nextAttemptAt: null,
          processedAt: new Date()
        }
      });
      return {
        action: "REVIEW_REQUIRED" as const,
        reason: "MONITOR_DISABLED" as const
      };
    }

    const applications = await tx.application.findMany({
      where: { userId: input.userId, deletedAt: null },
      select: {
        id: true,
        position: true,
        company: { select: { name: true } }
      }
    });
    const candidates: EmailAutomationApplicationCandidate[] = applications.map(
      (application) => ({
        id: application.id,
        position: application.position,
        companyName: application.company.name
      })
    );

    const exactApplicationId = findExactApplicationId(input.extraction, candidates);
    const target = exactApplicationId
      ? await loadTargetContext(
          tx,
          input.userId,
          exactApplicationId,
          input.extraction
        )
      : null;
    const decision = decideEmailAutomation(input.extraction, candidates, target);

    if (decision.action === "IGNORE") {
      await finishWithoutMutation(
        tx,
        input.jobId,
        EmailAutomationJobStatus.IGNORED,
        decision.reason
      );
      return decision;
    }

    if (decision.action === "REVIEW_REQUIRED") {
      await tx.emailAutomationJob.update({
        where: { id: input.jobId },
        data: {
          status: EmailAutomationJobStatus.REVIEW_REQUIRED,
          matchedApplicationId: decision.applicationId,
          errorCode: decision.reason,
          errorMessage: null,
          leaseUntil: null,
          nextAttemptAt: null,
          processedAt: new Date()
        }
      });
      return decision;
    }

    await applySafeChange(tx, {
      ...input,
      decision,
      target: target!,
      tracking: { kind: "monitor", jobId: input.jobId }
    });
    return decision;
  });
}

export async function decideAndApplyEmailImportAutomation(input: {
  emailImportId: string;
  extractionResultId: string;
  userId: string;
  userTimezone: string;
  extraction: EmailAiExtraction;
}) {
  if (input.extraction.eventType !== "CREATE_OR_UPDATE") {
    return {
      action: "REVIEW_REQUIRED" as const,
      reason: "NO_ACTIONABLE_CHANGE" as const
    };
  }

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT "id"
      FROM "EmailImport"
      WHERE "id" = ${input.emailImportId} AND "userId" = ${input.userId}
      FOR UPDATE
    `;
    const processed = await tx.aiExtractionResult.findFirst({
      where: {
        emailImportId: input.emailImportId,
        id: { not: input.extractionResultId },
        confirmedAt: { not: null },
        createdApplicationId: { not: null }
      },
      select: { createdApplicationId: true }
    });
    if (processed?.createdApplicationId) {
      return {
        action: "UNCHANGED" as const,
        applicationId: processed.createdApplicationId
      };
    }

    const applications = await tx.application.findMany({
      where: { userId: input.userId, deletedAt: null },
      select: {
        id: true,
        position: true,
        company: { select: { name: true } }
      }
    });
    const candidates = applications.map((application) => ({
      id: application.id,
      position: application.position,
      companyName: application.company.name
    }));
    const extraction = input.extraction;
    const exactApplicationId = findExactApplicationId(extraction, candidates);
    const target = exactApplicationId
      ? await loadTargetContext(
          tx,
          input.userId,
          exactApplicationId,
          extraction
        )
      : null;
    const decision = decideEmailAutomation(extraction, candidates, target);
    if (decision.action !== "AUTO_APPLY") return decision;

    await applySafeChange(tx, {
      userId: input.userId,
      userTimezone: input.userTimezone,
      extraction,
      decision,
      target: target!,
      tracking: {
        kind: "email-import",
        extractionResultId: input.extractionResultId
      }
    });
    return decision;
  });
}

async function loadTargetContext(
  tx: Prisma.TransactionClient,
  userId: string,
  applicationId: string,
  extraction: EmailMonitorExtraction
): Promise<EmailAutomationTargetContext> {
  const stages = extraction.stageType
    ? await tx.selectionStage.findMany({
        where: {
          userId,
          applicationId,
          type: extraction.stageType,
          deletedAt: null,
          status: { not: StageStatus.CANCELLED }
        },
        include: {
          interviews: {
            where: {
              deletedAt: null,
              status: { notIn: INACTIVE_INTERVIEW_STATUSES }
            },
            include: {
              proposedSlots: {
                where: {
                  deletedAt: null,
                  status: {
                    in: [ProposedSlotStatus.PENDING, ProposedSlotStatus.CONFIRMED]
                  }
                }
              }
            }
          }
        }
      })
    : [];
  const activeInterviews = stages.flatMap((stage) => stage.interviews);
  const activeInterview = activeInterviews.length === 1 ? activeInterviews[0] : null;
  const lastChange = activeInterview
    ? await tx.emailAutomationChange.findFirst({
        where: { userId, interviewId: activeInterview.id },
        orderBy: { createdAt: "desc" },
        select: { afterJson: true }
      })
    : null;

  const deadlineTypes = extractedDeadlineTypes(extraction);
  const deadlineConflict =
    deadlineTypes.length > 0 &&
    (await tx.deadline.count({
      where: {
        userId,
        applicationId,
        type: { in: deadlineTypes },
        status: DeadlineStatus.OPEN,
        deletedAt: null
      }
    })) > 0;

  return {
    matchingStageCount: stages.length,
    activeInterviewCount: activeInterviews.length,
    activeInterviewId: activeInterview?.id ?? null,
    hasManualDataConflict: activeInterview
      ? hasManualDataConflict(
          stages[0],
          activeInterview,
          lastChange?.afterJson,
          extraction
        )
      : hasStageManualDataConflict(stages[0], undefined, extraction),
    hasDeadlineConflict: deadlineConflict
  };
}

function hasManualDataConflict(
  stage: {
    name: string | null;
    status: StageStatus;
    scheduledAt: Date | null;
  },
  interview: {
    confirmedStartAt: Date | null;
    confirmedEndAt: Date | null;
    meetingUrl: string | null;
    interviewerName: string | null;
    proposedSlots: Array<{ source: string | null }>;
  },
  previousAfterJson: Prisma.JsonValue | undefined,
  extraction: EmailMonitorExtraction
) {
  if (hasStageManualDataConflict(stage, previousAfterJson, extraction)) {
    return true;
  }

  const wantsScheduleChange =
    Boolean(extraction.confirmedSlot.startAt) ||
    extraction.proposedSlots.length > 0;
  if (
    wantsScheduleChange &&
    interview.proposedSlots.some(
      (slot) => !isAutomatedEmailSlotSource(slot.source)
    )
  ) {
    return true;
  }

  const previous = readAutomationSnapshot(previousAfterJson);
  const confirmedConflict =
    Boolean(
      wantsScheduleChange &&
        (interview.confirmedStartAt || interview.confirmedEndAt)
    ) &&
    (previous?.confirmedStartAt !== interview.confirmedStartAt?.toISOString() ||
      previous?.confirmedEndAt !== interview.confirmedEndAt?.toISOString());
  const meetingUrlConflict =
    Boolean(
      extraction.meetingUrl &&
        interview.meetingUrl &&
        extraction.meetingUrl !== interview.meetingUrl
    ) && previous?.meetingUrl !== interview.meetingUrl;
  const interviewerConflict =
    Boolean(
      extraction.interviewerName &&
        interview.interviewerName &&
        extraction.interviewerName !== interview.interviewerName
    ) && previous?.interviewerName !== interview.interviewerName;

  return (
    confirmedConflict ||
    meetingUrlConflict ||
    interviewerConflict
  );
}

function hasStageManualDataConflict(
  stage:
    | {
        name: string | null;
        status: StageStatus;
        scheduledAt: Date | null;
      }
    | undefined,
  previousAfterJson: Prisma.JsonValue | undefined,
  extraction: EmailMonitorExtraction
) {
  if (!stage) return false;
  const immutableStatuses = new Set<StageStatus>([
    StageStatus.COMPLETED,
    StageStatus.SKIPPED
  ]);
  if (immutableStatuses.has(stage.status)) {
    return true;
  }

  const previous = readAutomationSnapshot(previousAfterJson);
  const stageNameConflict =
    Boolean(
      extraction.stageName &&
        stage.name &&
        extraction.stageName !== stage.name
    ) && previous?.stageName !== stage.name;
  const wantsScheduleChange =
    Boolean(extraction.confirmedSlot.startAt) ||
    extraction.proposedSlots.length > 0;
  const scheduledAtConflict =
    wantsScheduleChange &&
    Boolean(stage.scheduledAt) &&
    previous?.stageScheduledAt !== stage.scheduledAt?.toISOString();
  return stageNameConflict || scheduledAtConflict;
}

async function applySafeChange(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    userTimezone: string;
    extraction: EmailMonitorExtraction;
    decision: Extract<EmailAutomationDecision, { action: "AUTO_APPLY" }>;
    target: EmailAutomationTargetContext;
    tracking:
      | { kind: "monitor"; jobId: string }
      | { kind: "email-import"; extractionResultId: string };
  }
) {
  const { extraction, decision } = input;
  const hasSchedule =
    Boolean(extraction.confirmedSlot.startAt) || extraction.proposedSlots.length > 0;
  const application = await tx.application.findFirstOrThrow({
    where: {
      id: decision.applicationId,
      userId: input.userId,
      deletedAt: null
    }
  });

  let stage = extraction.stageType
    ? await tx.selectionStage.findFirst({
        where: {
          userId: input.userId,
          applicationId: application.id,
          type: extraction.stageType,
          deletedAt: null,
          status: { not: StageStatus.CANCELLED }
        }
      })
    : null;
  let stageCreated = false;

  if (hasSchedule && !stage) {
    const lastStage = await tx.selectionStage.findFirst({
      where: { applicationId: application.id, deletedAt: null },
      orderBy: { order: "desc" },
      select: { order: true }
    });
    stage = await tx.selectionStage.create({
      data: {
        userId: input.userId,
        applicationId: application.id,
        type: extraction.stageType!,
        name: extraction.stageName,
        status: StageStatus.IN_PROGRESS,
        order: (lastStage?.order ?? 0) + 1
      }
    });
    stageCreated = true;
  }

  let interview = input.target.activeInterviewId
    ? await tx.interview.findFirstOrThrow({
        where: {
          id: input.target.activeInterviewId,
          userId: input.userId,
          deletedAt: null
        }
      })
    : null;
  let interviewCreated = false;

  if (hasSchedule && stage && !interview) {
    interview = await tx.interview.create({
      data: {
        userId: input.userId,
        selectionStageId: stage.id,
        status: InterviewStatus.DRAFT,
        title: extraction.stageName
      }
    });
    interviewCreated = true;
  }

  const beforeJson = toSnapshot({
    applicationStatus: application.status,
    stageName: stage?.name ?? null,
    stageStatus: stage?.status ?? null,
    stageScheduledAt: stage?.scheduledAt ?? null,
    interview,
    deadlines: []
  });
  const confirmedStartAt = extraction.confirmedSlot.startAt
    ? new Date(extraction.confirmedSlot.startAt)
    : null;
  const confirmedEndAt = extraction.confirmedSlot.endAt
    ? new Date(extraction.confirmedSlot.endAt)
    : null;

  if (interview && stage) {
    await tx.proposedSlot.updateMany({
      where: {
        interviewId: interview.id,
        OR: [
          { source: { startsWith: "email_monitor:" } },
          { source: { startsWith: "email_import:" } }
        ],
        deletedAt: null,
        status: { in: [ProposedSlotStatus.PENDING, ProposedSlotStatus.CONFIRMED] }
      },
      data: { status: ProposedSlotStatus.CANCELLED }
    });

    const interviewStatus = confirmedStartAt
      ? InterviewStatus.CONFIRMED
      : InterviewStatus.WAITING_REPLY;
    const stageStatus = confirmedStartAt
      ? StageStatus.SCHEDULED
      : StageStatus.WAITING_REPLY;
    interview = await tx.interview.update({
      where: { id: interview.id },
      data: {
        status: interviewStatus,
        title: extraction.stageName ?? undefined,
        meetingUrl: extraction.meetingUrl ?? undefined,
        interviewerName: extraction.interviewerName ?? undefined,
        confirmedStartAt,
        confirmedEndAt
      }
    });
    stage = await tx.selectionStage.update({
      where: { id: stage.id },
      data: {
        status: stageStatus,
        name: extraction.stageName ?? undefined,
        scheduledAt: confirmedStartAt
      }
    });

    const slots = [
      ...(confirmedStartAt && confirmedEndAt
        ? [
            {
              startAt: confirmedStartAt,
              endAt: confirmedEndAt,
              timezone:
                extraction.confirmedSlot.timezone ?? input.userTimezone,
              status: ProposedSlotStatus.CONFIRMED
            }
          ]
        : []),
      ...extraction.proposedSlots.map((slot) => ({
        startAt: new Date(slot.startAt),
        endAt: new Date(slot.endAt),
        timezone: slot.timezone ?? input.userTimezone,
        status: ProposedSlotStatus.PENDING
      }))
    ];
    if (slots.length > 0) {
      await tx.proposedSlot.createMany({
        data: slots.map((slot) => ({
          userId: input.userId,
          interviewId: interview!.id,
          ...slot,
          source:
            input.tracking.kind === "monitor"
              ? `email_monitor:${input.tracking.jobId}`
              : `email_import:${input.tracking.extractionResultId}`
        }))
      });
    }
  }

  const createdDeadlineIds: string[] = [];
  for (const deadline of extractedDeadlines(extraction)) {
    const created = await tx.deadline.create({
      data: {
        userId: input.userId,
        applicationId: application.id,
        type: deadline.type,
        title: deadline.title,
        dueAt: deadline.dueAt
      }
    });
    createdDeadlineIds.push(created.id);
  }

  const advancesApplication =
    hasSchedule &&
    canAdvanceApplication(application.status) &&
    application.status !== ApplicationStatus.INTERVIEWING;
  if (advancesApplication) {
    await tx.application.update({
      where: { id: application.id },
      data: { status: ApplicationStatus.INTERVIEWING }
    });
  }

  const afterJson = toSnapshot({
    applicationStatus: advancesApplication
      ? ApplicationStatus.INTERVIEWING
      : application.status,
    stageName: stage?.name ?? null,
    stageStatus: stage?.status ?? null,
    stageScheduledAt: stage?.scheduledAt ?? null,
    interview,
    deadlines: createdDeadlineIds
  });
  if (input.tracking.kind === "monitor") {
    await tx.emailAutomationChange.create({
      data: {
        jobId: input.tracking.jobId,
        userId: input.userId,
        applicationId: application.id,
        interviewId: interview?.id,
        beforeJson,
        afterJson
      }
    });
  }

  const logs = [
    ...(stageCreated
      ? [
          {
            userId: input.userId,
            applicationId: application.id,
            action: ActivityAction.STAGE_CREATED,
            message:
              input.tracking.kind === "monitor"
                ? "メール監視から選考フェーズを追加しました"
                : "Gmail抽出から選考フェーズを追加しました"
          }
        ]
      : []),
    ...(hasSchedule
      ? [
          {
            userId: input.userId,
            applicationId: application.id,
            action: interviewCreated
              ? ActivityAction.INTERVIEW_CREATED
              : ActivityAction.INTERVIEW_STATUS_CHANGED,
            message: interviewCreated
              ? input.tracking.kind === "monitor"
                ? "メール監視から面接予定を追加しました"
                : "Gmail抽出から面接予定を追加しました"
              : input.tracking.kind === "monitor"
                ? "メール監視から面接予定を更新しました"
                : "Gmail抽出から面接予定を更新しました"
          }
        ]
      : []),
    ...(createdDeadlineIds.length > 0
      ? [
          {
            userId: input.userId,
            applicationId: application.id,
            action: ActivityAction.DEADLINE_CREATED,
            message: `${input.tracking.kind === "monitor" ? "メール監視" : "Gmail抽出"}から期限を${createdDeadlineIds.length}件追加しました`
          }
        ]
      : [])
  ];
  if (logs.length > 0) {
    await tx.activityLog.createMany({ data: logs });
  }

  if (input.tracking.kind === "monitor") {
    await tx.emailAutomationJob.update({
      where: { id: input.tracking.jobId },
      data: {
        status: EmailAutomationJobStatus.AUTO_APPLIED,
        matchedApplicationId: application.id,
        errorCode: null,
        errorMessage: null,
        leaseUntil: null,
        nextAttemptAt: null,
        processedAt: new Date()
      }
    });
  } else {
    await tx.aiExtractionResult.update({
      where: { id: input.tracking.extractionResultId },
      data: {
        reviewedJson: extraction as Prisma.InputJsonValue,
        confirmedAt: new Date(),
        createdApplicationId: application.id
      }
    });
  }
}

function isAutomatedEmailSlotSource(source: string | null) {
  return Boolean(
    source?.startsWith("email_monitor:") ||
      source?.startsWith("email_import:")
  );
}

function findExactApplicationId(
  extraction: EmailMonitorExtraction,
  applications: EmailAutomationApplicationCandidate[]
) {
  if (!extraction.companyName || !extraction.position) return null;
  const exact = applications.filter(
    (application) =>
      isExactCompanyName(application.companyName, extraction.companyName!) &&
      isExactMatchText(application.position, extraction.position!)
  );
  return exact.length === 1 ? exact[0].id : null;
}

function extractedDeadlineTypes(extraction: EmailMonitorExtraction) {
  return [
    ...(extraction.replyDeadline ? [DeadlineType.REPLY_DEADLINE] : []),
    ...(extraction.offerAcceptanceDeadline
      ? [DeadlineType.OFFER_ACCEPTANCE]
      : [])
  ];
}

function extractedDeadlines(extraction: EmailMonitorExtraction) {
  return [
    ...(extraction.replyDeadline
      ? [
          {
            type: DeadlineType.REPLY_DEADLINE,
            title: "返信期限",
            dueAt: new Date(extraction.replyDeadline)
          }
        ]
      : []),
    ...(extraction.offerAcceptanceDeadline
      ? [
          {
            type: DeadlineType.OFFER_ACCEPTANCE,
            title: "承諾期限",
            dueAt: new Date(extraction.offerAcceptanceDeadline)
          }
        ]
      : [])
  ];
}

function readAutomationSnapshot(value: Prisma.JsonValue | undefined) {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  const snapshot = value as Record<string, Prisma.JsonValue>;
  return {
    stageName: typeof snapshot.stageName === "string" ? snapshot.stageName : null,
    stageScheduledAt:
      typeof snapshot.stageScheduledAt === "string"
        ? snapshot.stageScheduledAt
        : null,
    confirmedStartAt:
      typeof snapshot.confirmedStartAt === "string"
        ? snapshot.confirmedStartAt
        : null,
    confirmedEndAt:
      typeof snapshot.confirmedEndAt === "string" ? snapshot.confirmedEndAt : null,
    meetingUrl:
      typeof snapshot.meetingUrl === "string" ? snapshot.meetingUrl : null,
    interviewerName:
      typeof snapshot.interviewerName === "string"
        ? snapshot.interviewerName
        : null
  };
}

function toSnapshot(input: {
  applicationStatus: ApplicationStatus;
  stageName: string | null;
  stageStatus: StageStatus | null;
  stageScheduledAt: Date | null;
  interview: {
    id: string;
    status: InterviewStatus;
    confirmedStartAt: Date | null;
    confirmedEndAt: Date | null;
    meetingUrl: string | null;
    interviewerName: string | null;
  } | null;
  deadlines: string[];
}): Prisma.InputJsonValue {
  return {
    applicationStatus: input.applicationStatus,
    stageName: input.stageName,
    stageStatus: input.stageStatus,
    stageScheduledAt: input.stageScheduledAt?.toISOString() ?? null,
    interviewId: input.interview?.id ?? null,
    interviewStatus: input.interview?.status ?? null,
    confirmedStartAt: input.interview?.confirmedStartAt?.toISOString() ?? null,
    confirmedEndAt: input.interview?.confirmedEndAt?.toISOString() ?? null,
    meetingUrl: input.interview?.meetingUrl ?? null,
    interviewerName: input.interview?.interviewerName ?? null,
    deadlineIds: input.deadlines
  };
}

async function finishWithoutMutation(
  tx: Prisma.TransactionClient,
  jobId: string,
  status: EmailAutomationJobStatus,
  reason: string
) {
  await tx.emailAutomationJob.update({
    where: { id: jobId },
    data: {
      status,
      errorCode: reason,
      errorMessage: null,
      leaseUntil: null,
      nextAttemptAt: null,
      processedAt: new Date()
    }
  });
}

function canAdvanceApplication(status: ApplicationStatus) {
  const advanceable = new Set<ApplicationStatus>([
    ApplicationStatus.DRAFT,
    ApplicationStatus.APPLIED,
    ApplicationStatus.DOCUMENT_SCREENING,
    ApplicationStatus.INTERVIEWING
  ]);
  return advanceable.has(status);
}
