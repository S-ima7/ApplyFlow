"use server";

import { InterviewStatus, ScheduleEventSource } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { buildScheduleEventImportData } from "@/features/calendar/import";
import {
  importGoogleCalendarEventSchema,
  type ImportGoogleCalendarEventInput
} from "@/features/calendar/schema";
import { requireUser } from "@/lib/auth-guard";
import {
  createGoogleCalendarInterviewEvent,
  getGoogleCalendarEventById
} from "@/lib/google-calendar";
import { prisma } from "@/lib/prisma";

export type CalendarImportActionResult =
  | {
      ok: true;
      scheduleEventId: string;
      message: string;
    }
  | {
      ok: false;
      message: string;
    };

export type CalendarExportActionResult =
  | {
      ok: true;
      status: "created" | "already_exists";
      message: string;
      eventUrl?: string;
    }
  | {
      ok: false;
      status: "not_eligible" | "missing_scope" | "reauth_required" | "error";
      message: string;
    };

export async function importGoogleCalendarEvent(
  input: ImportGoogleCalendarEventInput
): Promise<CalendarImportActionResult> {
  const user = await requireUser();
  const parsed = importGoogleCalendarEventSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      message: "取り込む予定の情報が不正です"
    };
  }

  const applicationId = parsed.data.applicationId ?? null;

  if (applicationId) {
    const application = await prisma.application.findFirst({
      where: {
        id: applicationId,
        userId: user.id,
        deletedAt: null
      },
      select: {
        id: true
      }
    });

    if (!application) {
      return {
        ok: false,
        message: "紐付け先の応募情報が見つかりません"
      };
    }
  }

  const googleCalendar = await getGoogleCalendarEventById(
    user.id,
    parsed.data.calendarId,
    parsed.data.externalEventId
  );

  if (googleCalendar.status !== "connected" || !googleCalendar.event) {
    return {
      ok: false,
      message: googleCalendar.message ?? "Google Calendar予定を取得できませんでした"
    };
  }

  const data = buildScheduleEventImportData(
    user.id,
    googleCalendar.event,
    applicationId,
    user.timezone ?? "Asia/Tokyo"
  );

  try {
    const scheduleEvent = await prisma.scheduleEvent.upsert({
      where: {
        userId_source_externalCalendarId_externalEventId: {
          userId: user.id,
          source: ScheduleEventSource.GOOGLE_CALENDAR,
          externalCalendarId: googleCalendar.event.calendarId,
          externalEventId: googleCalendar.event.externalEventId
        }
      },
      create: data,
      update: {
        ...data,
        userId: undefined,
        source: undefined
      }
    });

    revalidatePath("/calendar");
    revalidatePath("/dashboard");

    return {
      ok: true,
      scheduleEventId: scheduleEvent.id,
      message: "Google Calendar予定をApplyFlowに取り込みました"
    };
  } catch {
    return {
      ok: false,
      message: "予定の保存に失敗しました"
    };
  }
}

export async function registerConfirmedInterviewInGoogleCalendar(
  interviewId: string
): Promise<CalendarExportActionResult> {
  const user = await requireUser();
  const interview = await prisma.interview.findFirst({
    where: {
      id: interviewId,
      userId: user.id,
      deletedAt: null,
      selectionStage: {
        deletedAt: null,
        application: {
          deletedAt: null
        }
      }
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
    return {
      ok: false,
      status: "not_eligible",
      message: "面談が見つかりません"
    };
  }

  const startAt = interview.confirmedStartAt;
  const endAt = interview.confirmedEndAt;

  if (
    interview.status !== InterviewStatus.CONFIRMED ||
    !startAt ||
    !endAt ||
    Number.isNaN(startAt.getTime()) ||
    Number.isNaN(endAt.getTime()) ||
    startAt >= endAt
  ) {
    return {
      ok: false,
      status: "not_eligible",
      message: "日時が正しい確定面談だけをGoogle Calendarへ登録できます"
    };
  }

  const application = interview.selectionStage.application;
  const result = await createGoogleCalendarInterviewEvent(user.id, {
    interviewId: interview.id,
    companyName: application.company.name,
    position: application.position,
    title: interview.title ?? interview.selectionStage.name,
    location: interview.location,
    meetingUrl: interview.meetingUrl,
    note: interview.note,
    startAt,
    endAt
  });

  if (result.status === "created" || result.status === "already_exists") {
    revalidatePath(`/applications/${application.id}`);
    revalidatePath("/calendar");
    revalidatePath("/dashboard");

    return {
      ok: true,
      status: result.status,
      message: result.message,
      eventUrl: result.eventUrl
    };
  }

  return {
    ok: false,
    status: result.status,
    message: result.message
  };
}
