import { EMAIL_EXTRACTION_JSON_SCHEMA } from "@/features/email-import/extraction";
import {
  emailAiExtractionSchema,
  emailExtractionSchema
} from "@/features/email-import/schema";
import {
  browserMessageEventTypes,
  type BrowserMessageExtractionRequestInput
} from "@/features/browser-extension/contracts";
import {
  requestStructuredAi,
  type AiClientError,
  type AiUsage
} from "@/lib/ai/responses";
import { z } from "zod";

export const BROWSER_MESSAGE_EXTRACTION_PROMPT_VERSION = "2026-07-27.v2";

export const browserMessageExtractionSchema = emailExtractionSchema.extend({
  eventType: z.enum(browserMessageEventTypes)
});

const browserMessageAiExtractionSchema = emailAiExtractionSchema.extend({
  eventType: z.enum(browserMessageEventTypes)
});

export type BrowserMessageExtraction = z.infer<typeof browserMessageExtractionSchema>;

export type BrowserMessageExtractionResult =
  | {
      ok: true;
      data: BrowserMessageExtraction;
      metadata: {
        provider: "groq";
        model: string;
        promptVersion: string;
        usage: AiUsage;
      };
    }
  | { ok: false; message: string; error: AiClientError };

export const BROWSER_MESSAGE_EXTRACTION_JSON_SCHEMA = {
  ...EMAIL_EXTRACTION_JSON_SCHEMA,
  properties: {
    ...EMAIL_EXTRACTION_JSON_SCHEMA.properties,
    eventType: {
      type: "string",
      enum: browserMessageEventTypes,
      description:
        "CREATE_OR_UPDATE for a new/confirmed/proposed schedule, RESCHEDULE for a change, CANCEL for cancellation"
    }
  }
} as const;

export async function extractBrowserMessageWithAi(
  input: BrowserMessageExtractionRequestInput,
  timezone = "Asia/Tokyo",
  referenceNow = new Date()
): Promise<BrowserMessageExtractionResult> {
  const result = await requestStructuredAi({
    schemaName: "applyflow_browser_message_extraction",
    jsonSchema: BROWSER_MESSAGE_EXTRACTION_JSON_SCHEMA,
    outputSchema: browserMessageAiExtractionSchema,
    systemPrompt: buildBrowserMessageSystemPrompt(),
    userPrompt: buildBrowserMessagePrompt(input, timezone, referenceNow)
  });

  if (!result.ok) {
    return {
      ok: false,
      message: result.message,
      error: result.error
    };
  }

  return {
    ok: true,
    data: result.data,
    metadata: {
      ...result.metadata,
      promptVersion: BROWSER_MESSAGE_EXTRACTION_PROMPT_VERSION
    }
  };
}

/**
 * @deprecated Use extractBrowserMessageWithAi. This alias never calls the paid OpenAI API.
 */
export const extractBrowserMessageWithOpenAI = extractBrowserMessageWithAi;

export function buildBrowserMessagePrompt(
  input: BrowserMessageExtractionRequestInput,
  timezone: string,
  referenceNow: Date
) {
  return [
    `User timezone: ${timezone}`,
    `Current reference datetime: ${referenceNow.toISOString()}`,
    `Message captured datetime: ${input.capturedAt}`,
    `Source site: ${input.sourceSite}`,
    `Page title: ${input.pageTitle ?? ""}`,
    "",
    "User-selected company message:",
    input.selectedText
  ].join("\n");
}

function buildBrowserMessageSystemPrompt() {
  return [
    "Extract recruiting interview scheduling information from the user-selected Japanese or English company message.",
    "Return only fields matching the JSON schema and use null when unsupported.",
    "Set relevant to true only when the selected text contains recruiting interview scheduling information.",
    "Classify an explicit cancellation as CANCEL and an explicit date/time change as RESCHEDULE; otherwise use CREATE_OR_UPDATE.",
    "For CANCEL, return no confirmed or proposed slots. For RESCHEDULE, return only the new schedule.",
    "Distinguish proposed candidate times from one confirmed time and never duplicate the confirmed time in proposedSlots.",
    "If a start time is present but the end time is omitted, set the end time to 60 minutes after the start; the user will review it.",
    "Resolve relative dates from the captured datetime, using the user timezone when none is written.",
    "Normalize every datetime to ISO 8601 with an explicit numeric offset.",
    "Ignore navigation, signatures, footers, and unrelated text.",
    "For every field including relevant and eventType, provide calibrated confidence and a short supporting excerpt."
  ].join(" ");
}
