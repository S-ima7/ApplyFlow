"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import timeGridPlugin from "@fullcalendar/timegrid";
import type { EventClickArg, EventContentArg } from "@fullcalendar/core";
import { ExternalLink, X } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { importGoogleCalendarEvent } from "@/features/calendar/actions";
import { watchResponsiveCalendarView } from "@/features/calendar/responsive-view";
import type {
  CalendarApplicationOption,
  CalendarEvent,
  CalendarEventKind
} from "@/features/calendar/queries";
import { cn } from "@/lib/utils";

type SelectedCalendarEvent = {
  id: string;
  title: string;
  start: Date | null;
  end: Date | null;
  allDay: boolean;
  extendedProps: CalendarEvent["extendedProps"];
};

type CalendarClientProps = {
  events: CalendarEvent[];
  applicationOptions: CalendarApplicationOption[];
};

export function CalendarClient({ events, applicationOptions }: CalendarClientProps) {
  const router = useRouter();
  const calendarRef = useRef<FullCalendar | null>(null);
  const [selected, setSelected] = useState<SelectedCalendarEvent | null>(null);
  const [applicationId, setApplicationId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const compactViewport = window.matchMedia("(max-width: 639px)");

    return watchResponsiveCalendarView(compactViewport, (view) => {
      calendarRef.current?.getApi().changeView(view);
    });
  }, []);

  useEffect(() => {
    if (!selected) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSelected(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selected]);

  function handleEventClick(arg: EventClickArg) {
    setMessage(null);
    setApplicationId(
      (arg.event.extendedProps.applicationId as string | undefined) ?? ""
    );
    setSelected({
      id: arg.event.id,
      title: arg.event.title,
      start: arg.event.start,
      end: arg.event.end,
      allDay: arg.event.allDay,
      extendedProps: arg.event.extendedProps as CalendarEvent["extendedProps"]
    });
  }

  function handleImport() {
    if (!selected?.extendedProps.calendarId || !selected.extendedProps.externalEventId) {
      setMessage("取り込みに必要なGoogle Calendar情報がありません");
      return;
    }

    startTransition(async () => {
      const result = await importGoogleCalendarEvent({
        calendarId: selected.extendedProps.calendarId as string,
        externalEventId: selected.extendedProps.externalEventId as string,
        applicationId: applicationId || null
      });

      if (!result.ok) {
        setMessage(result.message);
        return;
      }

      setMessage(result.message);
      router.refresh();
      window.setTimeout(() => setSelected(null), 500);
    });
  }

  return (
    <>
      <div className="calendar-shell">
          <FullCalendar
            ref={calendarRef}
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
            initialView="timeGridWeek"
            headerToolbar={{
              left: "prev,next today",
              center: "title",
              right: "dayGridMonth,timeGridWeek,timeGridDay"
            }}
            buttonText={{
              today: "今日",
              month: "月",
              week: "週",
              day: "日"
            }}
            locale="ja"
            height="auto"
            nowIndicator
            stickyHeaderDates
            events={events}
            eventClick={handleEventClick}
            eventContent={renderEventContent}
          />
      </div>

      {selected ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setSelected(null);
            }
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="calendar-event-title"
            className="max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-xl sm:max-w-lg sm:rounded-xl sm:pb-5"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold text-blue-700">
                  {getKindLabel(selected.extendedProps.kind)}
                </p>
                <h3 id="calendar-event-title" className="mt-1 text-xl font-bold text-slate-950">
                  {selected.title}
                </h3>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="予定の詳細を閉じる"
                onClick={() => setSelected(null)}
              >
                <X className="h-5 w-5" />
              </Button>
            </div>

            <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
              <EventMeta label="日時" value={formatSelectedEventDate(selected)} />
              <EventMeta
                label="関連情報"
                value={`${selected.extendedProps.companyName} / ${selected.extendedProps.position}`}
              />
              {selected.extendedProps.location ? (
                <EventMeta label="場所" value={selected.extendedProps.location} />
              ) : null}
              {selected.extendedProps.description ? (
                <EventMeta label="説明" value={selected.extendedProps.description} wide />
              ) : null}
            </dl>

            {selected.extendedProps.kind === "google_calendar" ? (
              <div className="mt-5 rounded-lg border border-blue-200 bg-blue-50 p-4">
                <p className="font-semibold text-blue-950">ApplyFlowへ取り込む</p>
                <p className="mt-1 text-sm text-blue-800">
                  取り込んだ予定はGoogle連携が一時的に使えない場合も確認できます。
                </p>
                <label className="mt-4 block text-sm font-medium text-slate-800">
                  応募先への紐付け（任意）
                  <Select
                    className="mt-2"
                    value={applicationId}
                    onChange={(event) => setApplicationId(event.target.value)}
                  >
                    <option value="">紐付けない</option>
                    {applicationOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </label>
                <Button
                  type="button"
                  className="mt-4 w-full"
                  disabled={isPending}
                  onClick={handleImport}
                >
                  {isPending ? "取り込み中…" : "この予定を取り込む"}
                </Button>
              </div>
            ) : null}

            {message ? (
              <p
                className={cn(
                  "mt-4 rounded-md px-3 py-2 text-sm",
                  message.includes("取り込みました")
                    ? "bg-green-50 text-green-800"
                    : "bg-red-50 text-red-700"
                )}
                role="status"
              >
                {message}
              </p>
            ) : null}

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              {selected.extendedProps.externalUrl ? (
                <a
                  href={selected.extendedProps.externalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={buttonVariants({ variant: "secondary" })}
                >
                  <ExternalLink className="h-4 w-4" />
                  Googleで開く
                </a>
              ) : null}
              {selected.extendedProps.meetingUrl ? (
                <a
                  href={selected.extendedProps.meetingUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={buttonVariants({ variant: "secondary" })}
                >
                  面談URLを開く
                </a>
              ) : null}
              {selected.extendedProps.applicationId ? (
                <button
                  type="button"
                  className={buttonVariants()}
                  onClick={() =>
                    router.push(`/applications/${selected.extendedProps.applicationId}`)
                  }
                >
                  応募詳細へ
                </button>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

function renderEventContent(arg: EventContentArg) {
  const kind = arg.event.extendedProps.kind as CalendarEventKind;

  return (
    <div className="overflow-hidden px-1 py-0.5">
      <div className="truncate text-[11px] font-semibold">{getKindLabel(kind)}</div>
      <div className="truncate text-xs">{arg.event.title}</div>
    </div>
  );
}

function getKindLabel(kind: CalendarEventKind) {
  switch (kind) {
    case "confirmed_interview":
      return "確定";
    case "proposed_slot":
      return "候補";
    case "google_calendar":
      return "Google";
    case "schedule_event":
      return "取込済み";
    default:
      return "期限";
  }
}

function formatSelectedEventDate(event: SelectedCalendarEvent) {
  if (!event.start) {
    return "日時未設定";
  }

  if (event.allDay) {
    return `${event.start.toLocaleDateString("ja-JP")}（終日）`;
  }

  const start = event.start.toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
  const end = event.end?.toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit"
  });

  return end ? `${start}〜${end}` : start;
}

function EventMeta({
  label,
  value,
  wide = false
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap break-words font-medium text-slate-900">
        {value}
      </dd>
    </div>
  );
}
