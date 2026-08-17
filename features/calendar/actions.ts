"use server";

import { randomUUID } from "node:crypto";
import { InterviewStatus, Prisma, ScheduleEventSource } from "@prisma/client";
import { revalidatePath } from "next/cache";
import {
  buildScheduleEventImportData,
  getGoogleCalendarImportKey,
  isApplyFlowInterviewCalendarEvent
} from "@/features/calendar/import";
import {
  importGoogleCalendarEventSchema,
  type ImportGoogleCalendarEventInput
} from "@/features/calendar/schema";
import { requireUser } from "@/lib/auth-guard";
import {
  createGoogleCalendarInterviewEvent,
  getDefaultGoogleCalendarRange,
  getGoogleCalendarEventById,
  getGoogleCalendarEvents,
  getGoogleCalendarInterviewEventId
} from "@/lib/google-calendar";
import { prisma } from "@/lib/prisma";

const GOOGLE_CALENDAR_IMPORT_BATCH_SIZE = 500;

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

export type CalendarBulkImportActionResult =
  | {
      ok: true;
      importedCount: number;
      updatedCount: number;
      message: string;
    }
  | {
      ok: false;
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

export async function importAllGoogleCalendarEvents(): Promise<CalendarBulkImportActionResult> {
  const user = await requireUser();
  let importedCount = 0;
  let updatedCount = 0;

  try {
    const [googleCalendar, interviews] = await Promise.all([
      getGoogleCalendarEvents(
        user.id,
        getDefaultGoogleCalendarRange(
          new Date(),
          user.timezone ?? "Asia/Tokyo"
        )
      ),
      prisma.interview.findMany({
        where: { userId: user.id },
        select: { id: true }
      })
    ]);

    if (googleCalendar.status !== "connected") {
      return {
        ok: false,
        message:
          googleCalendar.message ?? "Google Calendar予定を取得できませんでした"
      };
    }

    const exportedInterviewKeys = new Set(
      interviews.map((interview) =>
        getGoogleCalendarInterviewEventId(user.id, interview.id)
      )
    );
    const events = googleCalendar.events.filter(
      (event) => !isApplyFlowInterviewCalendarEvent(event, exportedInterviewKeys)
    );

    if (events.length === 0) {
      return {
        ok: true,
        importedCount: 0,
        updatedCount: 0,
        message: "取り込むGoogle Calendar予定はありません"
      };
    }

    const existingEvents = await prisma.scheduleEvent.findMany({
      where: {
        userId: user.id,
        source: ScheduleEventSource.GOOGLE_CALENDAR
      },
      select: {
        externalCalendarId: true,
        externalEventId: true
      }
    });
    const existingKeys = new Set(
      existingEvents.flatMap((event) =>
        event.externalCalendarId && event.externalEventId
          ? [
              getGoogleCalendarImportKey(
                event.externalCalendarId,
                event.externalEventId
              )
            ]
          : []
      )
    );
    importedCount = events.filter(
      (event) =>
        !existingKeys.has(
          getGoogleCalendarImportKey(event.calendarId, event.externalEventId)
        )
    ).length;
    updatedCount = events.length - importedCount;

    const rows = events.map((event) =>
      buildScheduleEventImportData(
        user.id,
        event,
        null,
        user.timezone ?? "Asia/Tokyo"
      )
    );
    const queries = [];

    for (let index = 0; index < rows.length; index += GOOGLE_CALENDAR_IMPORT_BATCH_SIZE) {
      const batch = rows.slice(index, index + GOOGLE_CALENDAR_IMPORT_BATCH_SIZE);
      const values = batch.map((data) => Prisma.sql`(
        ${randomUUID()},
        ${data.userId},
        ${data.applicationId},
        ${data.source}::"ScheduleEventSource",
        ${data.externalCalendarId},
        ${data.externalEventId},
        ${data.title},
        ${data.description},
        ${data.location},
        ${data.meetingUrl},
        ${data.startAt},
        ${data.endAt},
        ${data.startDate},
        ${data.endDate},
        ${data.allDay},
        ${data.timezone},
        ${data.externalUrl},
        ${data.sourceUpdatedAt},
        ${data.importedAt},
        ${data.importedAt},
        ${data.importedAt},
        ${data.deletedAt}
      )`);

      queries.push(prisma.$executeRaw(Prisma.sql`
        INSERT INTO "ScheduleEvent" (
          "id", "userId", "applicationId", "source",
          "externalCalendarId", "externalEventId", "title", "description",
          "location", "meetingUrl", "startAt", "endAt", "startDate",
          "endDate", "allDay", "timezone", "externalUrl", "sourceUpdatedAt",
          "importedAt", "createdAt", "updatedAt", "deletedAt"
        )
        VALUES ${Prisma.join(values)}
        ON CONFLICT ("userId", "source", "externalCalendarId", "externalEventId")
        DO UPDATE SET
          "title" = EXCLUDED."title",
          "description" = EXCLUDED."description",
          "location" = EXCLUDED."location",
          "meetingUrl" = EXCLUDED."meetingUrl",
          "startAt" = EXCLUDED."startAt",
          "endAt" = EXCLUDED."endAt",
          "startDate" = EXCLUDED."startDate",
          "endDate" = EXCLUDED."endDate",
          "allDay" = EXCLUDED."allDay",
          "timezone" = EXCLUDED."timezone",
          "externalUrl" = EXCLUDED."externalUrl",
          "sourceUpdatedAt" = EXCLUDED."sourceUpdatedAt",
          "importedAt" = EXCLUDED."importedAt",
          "updatedAt" = EXCLUDED."updatedAt",
          "deletedAt" = NULL
      `));
    }

    await prisma.$transaction(queries);
  } catch {
    return {
      ok: false,
      message: "Google Calendar予定の一括取り込みに失敗しました"
    };
  }

  for (const path of ["/calendar", "/dashboard"]) {
    try {
      revalidatePath(path);
    } catch {
      // DBへの保存は完了しているため、キャッシュ更新だけの失敗を保存失敗とは扱わない。
    }
  }

  return {
    ok: true,
    importedCount,
    updatedCount,
    message: `Google Calendar予定を${importedCount}件取り込み、${updatedCount}件更新しました`
  };
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
