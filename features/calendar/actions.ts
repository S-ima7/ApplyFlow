"use server";

import { ScheduleEventSource } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { buildScheduleEventImportData } from "@/features/calendar/import";
import {
  importGoogleCalendarEventSchema,
  type ImportGoogleCalendarEventInput
} from "@/features/calendar/schema";
import { requireUser } from "@/lib/auth-guard";
import { getGoogleCalendarEventById } from "@/lib/google-calendar";
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
