import {
  EMAIL_MONITOR_SIGNATURE_HEADER,
  EMAIL_MONITOR_TIMESTAMP_HEADER,
  verifyEmailMonitorWorkerSignature
} from "@/features/email-monitor/internal-auth";
import { runEmailMonitorBatch } from "@/features/email-monitor/worker";
import { runManualEmailImportJob } from "@/features/email-import/manual-worker";

export default async function handler(request: Request) {
  if (request.method !== "POST") {
    return new Response(null, { status: 405 });
  }

  const body = await request.text();
  if (
    !verifyEmailMonitorWorkerSignature({
      body,
      timestampHeader: request.headers.get(EMAIL_MONITOR_TIMESTAMP_HEADER),
      signatureHeader: request.headers.get(EMAIL_MONITOR_SIGNATURE_HEADER)
    })
  ) {
    return new Response(null, { status: 401 });
  }

  const parsed = parseWorkerRequest(body);
  if (!parsed.ok) {
    return new Response(null, { status: 400 });
  }

  try {
    if (parsed.manualJobId && parsed.userId) {
      await runManualEmailImportJob({
        jobId: parsed.manualJobId,
        userId: parsed.userId
      });
    } else {
      await runEmailMonitorBatch({ userId: parsed.userId });
    }
    return new Response(null, { status: 202 });
  } catch {
    console.error("Email monitor background worker failed");
    return new Response(null, { status: 500 });
  }
}

export function parseWorkerRequest(body: string):
  | { ok: true; userId?: string; manualJobId?: string }
  | { ok: false } {
  try {
    const value = JSON.parse(body) as unknown;
    if (!value || Array.isArray(value) || typeof value !== "object") {
      return { ok: false };
    }
    const keys = Object.keys(value);
    if (keys.some((key) => key !== "userId" && key !== "manualJobId")) {
      return { ok: false };
    }
    const userId = (value as { userId?: unknown }).userId;
    const manualJobId = (value as { manualJobId?: unknown }).manualJobId;
    if (
      userId !== undefined &&
      (typeof userId !== "string" ||
        !userId.trim() ||
        userId.length > 100)
    ) {
      return { ok: false };
    }
    if (
      manualJobId !== undefined &&
      (typeof manualJobId !== "string" ||
        !manualJobId.trim() ||
        manualJobId.length > 100 ||
        typeof userId !== "string")
    ) {
      return { ok: false };
    }
    return {
      ok: true,
      ...(typeof userId === "string" ? { userId } : {}),
      ...(typeof manualJobId === "string" ? { manualJobId } : {})
    };
  } catch {
    return { ok: false };
  }
}
