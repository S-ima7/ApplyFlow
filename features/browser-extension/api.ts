import { NextResponse } from "next/server";

const MAX_REQUEST_BYTES = 65_536;

export function browserExtensionJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type, Idempotency-Key");
  response.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Vary", "Origin");
  return response;
}

export function browserExtensionOptionsResponse() {
  const response = new NextResponse(null, { status: 204 });
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type, Idempotency-Key");
  response.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.headers.set("Access-Control-Max-Age", "600");
  return response;
}

export async function readBrowserExtensionJson(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");

  if (declaredLength > MAX_REQUEST_BYTES) {
    throw new BrowserExtensionRequestError(413, "送信データが大きすぎます");
  }

  const text = await request.text();

  if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BYTES) {
    throw new BrowserExtensionRequestError(413, "送信データが大きすぎます");
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new BrowserExtensionRequestError(400, "JSON形式が不正です");
  }
}

export class BrowserExtensionRequestError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}
