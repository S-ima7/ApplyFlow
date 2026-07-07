"use client";

import { useRouter } from "next/navigation";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import timeGridPlugin from "@fullcalendar/timegrid";
import type { EventClickArg, EventContentArg } from "@fullcalendar/core";
import type { CalendarEvent } from "@/features/calendar/queries";

export function CalendarClient({ events }: { events: CalendarEvent[] }) {
  const router = useRouter();

  function handleEventClick(arg: EventClickArg) {
    const applicationId = arg.event.extendedProps.applicationId as string | undefined;

    if (applicationId) {
      router.push(`/applications/${applicationId}`);
    }
  }

  return (
    <FullCalendar
      plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
      initialView="timeGridWeek"
      headerToolbar={{
        left: "prev,next today",
        center: "title",
        right: "dayGridMonth,timeGridWeek,timeGridDay"
      }}
      locale="ja"
      height="auto"
      nowIndicator
      events={events}
      eventClick={handleEventClick}
      eventContent={renderEventContent}
    />
  );
}

function renderEventContent(arg: EventContentArg) {
  const kind = arg.event.extendedProps.kind as string;
  const label =
    kind === "confirmed_interview" ? "確定" : kind === "proposed_slot" ? "候補" : "期限";

  return (
    <div className="overflow-hidden px-1 py-0.5">
      <div className="truncate text-[11px] font-semibold">{label}</div>
      <div className="truncate text-xs">{arg.event.title}</div>
    </div>
  );
}
