import { z } from "zod";

export const importGoogleCalendarEventSchema = z.object({
  calendarId: z.string().trim().min(1).max(255),
  externalEventId: z.string().trim().min(1).max(1024),
  applicationId: z.string().trim().min(1).nullable().optional()
});

export type ImportGoogleCalendarEventInput = z.infer<
  typeof importGoogleCalendarEventSchema
>;
