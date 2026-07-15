import { describe, expect, it } from "vitest";
import { buildExtractionPrompt } from "@/features/email-import/extraction";
import { prepareEmailBodyForExtraction } from "@/features/email-import/preprocessing";

describe("prepareEmailBodyForExtraction", () => {
  it("separates the latest reschedule from quoted history", () => {
    const result = prepareEmailBodyForExtraction(`日程を7月15日 19時へ変更します。

On Mon, Jul 10, 2026 wrote:
> 当初は7月14日 18時でお願いします。`);

    expect(result.latestMessage).toContain("7月15日 19時");
    expect(result.latestMessage).not.toContain("7月14日");
    expect(result.quotedContext).toContain("7月14日 18時");
  });

  it("normalizes full-width text and line endings", () => {
    const result = prepareEmailBodyForExtraction("７月１５日\r\n１９：００");

    expect(result.latestMessage).toBe("7月15日\n19:00");
  });
});

describe("buildExtractionPrompt", () => {
  it("uses an injected reference time and labels quoted context", () => {
    const prompt = buildExtractionPrompt(
      {
        id: "message-1",
        subject: "面接日時変更",
        fromAddress: "recruit@example.com",
        bodyText: "明日19時です。\n\nOn yesterday wrote:\n> 明日18時です。"
      },
      "Asia/Tokyo",
      new Date("2026-07-14T00:00:00.000Z")
    );

    expect(prompt).toContain("Current reference datetime: 2026-07-14T00:00:00.000Z");
    expect(prompt).toContain("Latest message (authoritative");
    expect(prompt).toContain("Quoted or forwarded context");
  });
});
