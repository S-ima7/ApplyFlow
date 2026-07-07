export type ScheduleItemKind =
  | "proposed_slot"
  | "confirmed_interview"
  | "google_calendar_event";
export type ScheduleItemStatus = "pending" | "confirmed";
export type ConflictSeverity = "low" | "medium" | "high";

export type ScheduleItem = {
  id: string;
  eventGroupId?: string;
  kind: ScheduleItemKind;
  status: ScheduleItemStatus;
  startAt: Date;
  endAt: Date;
  title: string;
  companyName: string;
  position: string;
  applicationId?: string;
};

export type ConflictAlert = {
  id: string;
  severity: ConflictSeverity;
  startsAt: Date;
  endsAt: Date;
  itemA: ScheduleItem;
  itemB: ScheduleItem;
};
