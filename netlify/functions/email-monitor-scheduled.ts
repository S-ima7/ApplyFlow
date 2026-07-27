import { dispatchEmailMonitorBackground } from "@/features/email-monitor/internal-auth";

export default async function handler(request: Request) {
  try {
    await dispatchEmailMonitorBackground({
      origin: new URL(request.url).origin
    });
    return new Response(null, { status: 202 });
  } catch {
    console.error("Email monitor background dispatch failed");
    return new Response(null, { status: 503 });
  }
}

export const config = {
  schedule: "*/15 * * * *"
};
