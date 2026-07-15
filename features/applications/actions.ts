"use server";

import {
  ActivityAction,
  ApplicationStatus,
  DeadlineStatus,
  InterviewStatus,
  ProposedSlotStatus,
  StageStatus
} from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth-guard";
import { DEFAULT_TIMEZONE } from "@/lib/date";
import { prisma } from "@/lib/prisma";
import { normalizeSourceUrl } from "@/lib/source-url";
import { getConflictAlertsForTarget } from "@/features/conflict-detection/queries";
import type { ScheduleItem } from "@/features/conflict-detection/types";
import {
  applicationSchema,
  deadlineSchema,
  interviewSchema,
  proposedSlotSchema,
  stageSchema,
  type ApplicationInput,
  type DeadlineInput,
  type InterviewInput,
  type ProposedSlotInput,
  type StageInput
} from "./schema";

export type ActionResult<T = unknown> =
  | { ok: true; data?: T; message?: string }
  | {
      ok: false;
      message: string;
      fieldErrors?: Record<string, string[] | undefined>;
    };

function failFromZod(error: z.ZodError): ActionResult<never> {
  return {
    ok: false,
    message: "入力内容を確認してください",
    fieldErrors: error.flatten().fieldErrors
  };
}

function optionalDate(value?: string | null) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function createApplication(
  input: ApplicationInput
): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  const parsed = applicationSchema.safeParse(input);

  if (!parsed.success) {
    return failFromZod(parsed.error);
  }

  const data = parsed.data;

  const application = await prisma.$transaction(async (tx) => {
    const company = await tx.company.create({
      data: {
        userId: user.id,
        name: data.companyName
      }
    });

    const created = await tx.application.create({
      data: {
        userId: user.id,
        companyId: company.id,
        position: data.position,
        applicationType: data.applicationType,
        route: data.route,
        status: data.status,
        priority: data.priority,
        appliedAt: optionalDate(data.appliedAt),
        sourceUrl: data.sourceUrl ? normalizeSourceUrl(data.sourceUrl) : undefined,
        locationText: data.locationText,
        employmentTypeText: data.employmentTypeText,
        compensationText: data.compensationText,
        note: data.note
      }
    });

    await tx.activityLog.create({
      data: {
        userId: user.id,
        applicationId: created.id,
        action: ActivityAction.APPLICATION_CREATED,
        message: `${company.name} / ${created.position} を登録しました`
      }
    });

    return created;
  });

  revalidatePath("/applications");
  revalidatePath("/dashboard");

  return { ok: true, data: { id: application.id }, message: "応募先を作成しました" };
}

export async function updateApplication(
  applicationId: string,
  input: ApplicationInput
): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  const parsed = applicationSchema.safeParse(input);

  if (!parsed.success) {
    return failFromZod(parsed.error);
  }

  const data = parsed.data;

  const existing = await prisma.application.findFirst({
    where: {
      id: applicationId,
      userId: user.id,
      deletedAt: null
    },
    include: {
      company: true
    }
  });

  if (!existing) {
    return { ok: false, message: "応募先が見つかりません" };
  }

  await prisma.$transaction([
    prisma.company.update({
      where: {
        id: existing.companyId
      },
      data: {
        name: data.companyName
      }
    }),
    prisma.application.update({
      where: {
        id: applicationId
      },
      data: {
        position: data.position,
        applicationType: data.applicationType,
        route: data.route,
        status: data.status,
        priority: data.priority,
        appliedAt: optionalDate(data.appliedAt),
        sourceUrl: data.sourceUrl ? normalizeSourceUrl(data.sourceUrl) : undefined,
        locationText: data.locationText,
        employmentTypeText: data.employmentTypeText,
        compensationText: data.compensationText,
        note: data.note
      }
    }),
    prisma.activityLog.create({
      data: {
        userId: user.id,
        applicationId,
        action: ActivityAction.APPLICATION_UPDATED,
        message: "応募情報を更新しました"
      }
    })
  ]);

  revalidatePath("/applications");
  revalidatePath(`/applications/${applicationId}`);
  revalidatePath("/dashboard");

  return { ok: true, data: { id: applicationId }, message: "応募先を更新しました" };
}

export async function deleteApplication(applicationId: string) {
  const user = await requireUser();

  const existing = await prisma.application.findFirst({
    where: {
      id: applicationId,
      userId: user.id,
      deletedAt: null
    }
  });

  if (!existing) {
    redirect("/applications");
  }

  await prisma.application.update({
    where: {
      id: applicationId
    },
    data: {
      deletedAt: new Date(),
      sourceKey: null,
      captureIdempotencyKey: null
    }
  });

  revalidatePath("/applications");
  revalidatePath("/dashboard");
  redirect("/applications");
}

export async function createSelectionStage(
  applicationId: string,
  input: StageInput
): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  const parsed = stageSchema.safeParse(input);

  if (!parsed.success) {
    return failFromZod(parsed.error);
  }

  const application = await prisma.application.findFirst({
    where: {
      id: applicationId,
      userId: user.id,
      deletedAt: null
    }
  });

  if (!application) {
    return { ok: false, message: "応募先が見つかりません" };
  }

  const lastStage = await prisma.selectionStage.findFirst({
    where: {
      applicationId,
      deletedAt: null
    },
    orderBy: {
      order: "desc"
    }
  });

  const stage = await prisma.$transaction(async (tx) => {
    const created = await tx.selectionStage.create({
      data: {
        userId: user.id,
        applicationId,
        type: parsed.data.type,
        name: parsed.data.name,
        status: parsed.data.status,
        order: (lastStage?.order ?? 0) + 1,
        scheduledAt: optionalDate(parsed.data.scheduledAt),
        completedAt: optionalDate(parsed.data.completedAt),
        note: parsed.data.note
      }
    });

    await tx.activityLog.create({
      data: {
        userId: user.id,
        applicationId,
        action: ActivityAction.STAGE_CREATED,
        message: "選考フェーズを追加しました"
      }
    });

    return created;
  });

  revalidatePath(`/applications/${applicationId}`);
  revalidatePath("/dashboard");

  return { ok: true, data: { id: stage.id }, message: "選考フェーズを追加しました" };
}

export async function createInterview(
  selectionStageId: string,
  input: InterviewInput
): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  const parsed = interviewSchema.safeParse(input);

  if (!parsed.success) {
    return failFromZod(parsed.error);
  }

  const stage = await prisma.selectionStage.findFirst({
    where: {
      id: selectionStageId,
      userId: user.id,
      deletedAt: null
    }
  });

  if (!stage) {
    return { ok: false, message: "選考フェーズが見つかりません" };
  }

  const interview = await prisma.$transaction(async (tx) => {
    const created = await tx.interview.create({
      data: {
        userId: user.id,
        selectionStageId,
        status: parsed.data.status,
        title: parsed.data.title,
        meetingUrl: parsed.data.meetingUrl,
        location: parsed.data.location,
        interviewerName: parsed.data.interviewerName,
        interviewerEmail: parsed.data.interviewerEmail,
        note: parsed.data.note
      }
    });

    await tx.activityLog.create({
      data: {
        userId: user.id,
        applicationId: stage.applicationId,
        action: ActivityAction.INTERVIEW_CREATED,
        message: "面談を追加しました"
      }
    });

    return created;
  });

  revalidatePath(`/applications/${stage.applicationId}`);

  return { ok: true, data: { id: interview.id }, message: "面談を追加しました" };
}

export async function createProposedSlot(
  interviewId: string,
  input: ProposedSlotInput
): Promise<ActionResult<{ id: string; conflictCount: number }>> {
  const user = await requireUser();
  const parsed = proposedSlotSchema.safeParse(input);

  if (!parsed.success) {
    return failFromZod(parsed.error);
  }

  const interview = await prisma.interview.findFirst({
    where: {
      id: interviewId,
      userId: user.id,
      deletedAt: null
    },
    include: {
      selectionStage: {
        include: {
          application: {
            include: {
              company: true
            }
          }
        }
      }
    }
  });

  if (!interview) {
    return { ok: false, message: "面談が見つかりません" };
  }

  const startAt = new Date(parsed.data.startAt);
  const endAt = new Date(parsed.data.endAt);

  const created = await prisma.$transaction(async (tx) => {
    const slot = await tx.proposedSlot.create({
      data: {
        userId: user.id,
        interviewId,
        startAt,
        endAt,
        timezone: parsed.data.timezone ?? DEFAULT_TIMEZONE,
        status: ProposedSlotStatus.PENDING,
        source: "manual",
        note: parsed.data.note
      }
    });

    await tx.interview.update({
      where: {
        id: interviewId
      },
      data: {
        status: InterviewStatus.WAITING_REPLY
      }
    });

    await tx.selectionStage.update({
      where: {
        id: interview.selectionStageId
      },
      data: {
        status: StageStatus.WAITING_REPLY
      }
    });

    await tx.application.update({
      where: {
        id: interview.selectionStage.applicationId
      },
      data: {
        status: ApplicationStatus.INTERVIEWING
      }
    });

    await tx.activityLog.create({
      data: {
        userId: user.id,
        applicationId: interview.selectionStage.applicationId,
        action: ActivityAction.PROPOSED_SLOT_CREATED,
        message: "候補日時を追加しました",
        metadata: {
          proposedSlotId: slot.id,
          startAt: startAt.toISOString(),
          endAt: endAt.toISOString()
        }
      }
    });

    return slot;
  });

  const target: ScheduleItem = {
    id: `slot:${created.id}`,
    eventGroupId: `interview:${interviewId}`,
    kind: "proposed_slot",
    status: "pending",
    startAt,
    endAt,
    title: interview.title ?? interview.selectionStage.name ?? "候補日時",
    companyName: interview.selectionStage.application.company.name,
    position: interview.selectionStage.application.position,
    applicationId: interview.selectionStage.applicationId
  };
  const conflicts = await getConflictAlertsForTarget(user.id, target);

  revalidatePath(`/applications/${interview.selectionStage.applicationId}`);
  revalidatePath("/calendar");
  revalidatePath("/waiting");
  revalidatePath("/dashboard");

  return {
    ok: true,
    data: {
      id: created.id,
      conflictCount: conflicts.length
    },
    message:
      conflicts.length > 0
        ? `候補日時を追加しました。${conflicts.length}件の衝突があります`
        : "候補日時を追加しました"
  };
}

export async function confirmProposedSlot(
  proposedSlotId: string
): Promise<ActionResult<{ applicationId: string }>> {
  const user = await requireUser();

  const slot = await prisma.proposedSlot.findFirst({
    where: {
      id: proposedSlotId,
      userId: user.id,
      deletedAt: null
    },
    include: {
      interview: {
        include: {
          selectionStage: true
        }
      }
    }
  });

  if (!slot) {
    return { ok: false, message: "候補日時が見つかりません" };
  }

  if (slot.status !== ProposedSlotStatus.PENDING) {
    return { ok: false, message: "提示中の候補日時のみ確定できます" };
  }

  await prisma.$transaction(async (tx) => {
    await tx.proposedSlot.updateMany({
      where: {
        interviewId: slot.interviewId,
        id: {
          not: slot.id
        },
        status: ProposedSlotStatus.PENDING,
        deletedAt: null
      },
      data: {
        status: ProposedSlotStatus.REJECTED
      }
    });

    await tx.proposedSlot.update({
      where: {
        id: slot.id
      },
      data: {
        status: ProposedSlotStatus.CONFIRMED
      }
    });

    await tx.interview.update({
      where: {
        id: slot.interviewId
      },
      data: {
        status: InterviewStatus.CONFIRMED,
        confirmedStartAt: slot.startAt,
        confirmedEndAt: slot.endAt
      }
    });

    await tx.selectionStage.update({
      where: {
        id: slot.interview.selectionStageId
      },
      data: {
        status: StageStatus.SCHEDULED,
        scheduledAt: slot.startAt
      }
    });

    await tx.application.update({
      where: {
        id: slot.interview.selectionStage.applicationId
      },
      data: {
        status: ApplicationStatus.INTERVIEWING
      }
    });

    await tx.activityLog.create({
      data: {
        userId: user.id,
        applicationId: slot.interview.selectionStage.applicationId,
        action: ActivityAction.PROPOSED_SLOT_CONFIRMED,
        message: "候補日時を確定しました",
        metadata: {
          proposedSlotId: slot.id,
          interviewId: slot.interviewId,
          startAt: slot.startAt.toISOString(),
          endAt: slot.endAt.toISOString()
        }
      }
    });
  });

  revalidatePath(`/applications/${slot.interview.selectionStage.applicationId}`);
  revalidatePath("/calendar");
  revalidatePath("/waiting");
  revalidatePath("/dashboard");

  return {
    ok: true,
    data: {
      applicationId: slot.interview.selectionStage.applicationId
    },
    message: "候補日時を確定しました"
  };
}

export async function createDeadline(
  applicationId: string,
  input: DeadlineInput
): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  const parsed = deadlineSchema.safeParse(input);

  if (!parsed.success) {
    return failFromZod(parsed.error);
  }

  const application = await prisma.application.findFirst({
    where: {
      id: applicationId,
      userId: user.id,
      deletedAt: null
    }
  });

  if (!application) {
    return { ok: false, message: "応募先が見つかりません" };
  }

  const dueAt = new Date(parsed.data.dueAt);

  const deadline = await prisma.$transaction(async (tx) => {
    const created = await tx.deadline.create({
      data: {
        userId: user.id,
        applicationId,
        type: parsed.data.type,
        status: DeadlineStatus.OPEN,
        title: parsed.data.title,
        dueAt,
        note: parsed.data.note
      }
    });

    await tx.activityLog.create({
      data: {
        userId: user.id,
        applicationId,
        action: ActivityAction.DEADLINE_CREATED,
        message: "期限を追加しました"
      }
    });

    return created;
  });

  revalidatePath(`/applications/${applicationId}`);
  revalidatePath("/deadlines");
  revalidatePath("/dashboard");

  return { ok: true, data: { id: deadline.id }, message: "期限を追加しました" };
}

export async function completeDeadline(deadlineId: string) {
  const user = await requireUser();

  const deadline = await prisma.deadline.findFirst({
    where: {
      id: deadlineId,
      userId: user.id,
      deletedAt: null
    }
  });

  if (!deadline) {
    return { ok: false, message: "期限が見つかりません" } satisfies ActionResult;
  }

  await prisma.$transaction([
    prisma.deadline.update({
      where: {
        id: deadlineId
      },
      data: {
        status: DeadlineStatus.DONE,
        completedAt: new Date()
      }
    }),
    prisma.activityLog.create({
      data: {
        userId: user.id,
        applicationId: deadline.applicationId,
        action: ActivityAction.DEADLINE_COMPLETED,
        message: "期限を完了にしました"
      }
    })
  ]);

  revalidatePath(`/applications/${deadline.applicationId}`);
  revalidatePath("/deadlines");
  revalidatePath("/dashboard");

  return { ok: true, message: "期限を完了にしました" } satisfies ActionResult;
}
