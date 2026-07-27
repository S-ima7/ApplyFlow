import { createHash } from "node:crypto";
import type { GmailFullMessage } from "@/lib/gmail";

export function buildEmailMessageDigest(message: GmailFullMessage) {
  return createHash("sha256")
    .update(message.id)
    .update("\0")
    .update(message.threadId ?? "")
    .update("\0")
    .update(message.subject ?? "")
    .update("\0")
    .update(message.fromAddress ?? "")
    .update("\0")
    .update(message.sentAt?.toISOString() ?? "")
    .update("\0")
    .update(message.bodyText)
    .digest("hex");
}
