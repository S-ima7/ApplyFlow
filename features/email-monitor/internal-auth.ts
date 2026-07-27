import {
  createHmac,
  timingSafeEqual
} from "node:crypto";

export const EMAIL_MONITOR_TIMESTAMP_HEADER = "x-applyflow-timestamp";
export const EMAIL_MONITOR_SIGNATURE_HEADER = "x-applyflow-signature";
const MAX_SIGNATURE_AGE_SECONDS = 5 * 60;

export function createEmailMonitorWorkerSignature(
  body: string,
  timestamp: number,
  secret = requireEmailMonitorWorkerSecret()
) {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
}

export function verifyEmailMonitorWorkerSignature(input: {
  body: string;
  timestampHeader: string | null;
  signatureHeader: string | null;
  now?: Date;
  secret?: string;
}) {
  const timestamp = Number(input.timestampHeader);
  if (
    !Number.isInteger(timestamp) ||
    !input.signatureHeader ||
    !/^[a-f0-9]{64}$/.test(input.signatureHeader)
  ) {
    return false;
  }

  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1_000);
  if (Math.abs(nowSeconds - timestamp) > MAX_SIGNATURE_AGE_SECONDS) {
    return false;
  }

  let expected: string;
  try {
    expected = createEmailMonitorWorkerSignature(
      input.body,
      timestamp,
      input.secret ?? requireEmailMonitorWorkerSecret()
    );
  } catch {
    return false;
  }

  return timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(input.signatureHeader, "hex")
  );
}

export async function dispatchEmailMonitorBackground(input: {
  origin: string;
  userId?: string;
  fetcher?: typeof fetch;
}) {
  const body = JSON.stringify(input.userId ? { userId: input.userId } : {});
  const timestamp = Math.floor(Date.now() / 1_000);
  const signature = createEmailMonitorWorkerSignature(body, timestamp);
  const url = new URL(
    "/.netlify/functions/email-monitor-worker-background",
    input.origin
  );
  const response = await (input.fetcher ?? fetch)(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [EMAIL_MONITOR_TIMESTAMP_HEADER]: String(timestamp),
      [EMAIL_MONITOR_SIGNATURE_HEADER]: signature
    },
    body
  });

  if (!response.ok) {
    throw new Error(`Email monitor background dispatch failed (${response.status})`);
  }
}

function requireEmailMonitorWorkerSecret() {
  const secret = process.env.EMAIL_MONITOR_WORKER_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("EMAIL_MONITOR_WORKER_SECRET must contain at least 32 characters");
  }
  return secret;
}
