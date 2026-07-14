export type PreparedEmailBody = {
  latestMessage: string;
  quotedContext: string;
};

const QUOTED_SECTION_MARKERS = [
  /^On .+wrote:$/i,
  /^-{2,}\s*Original Message\s*-{2,}$/i,
  /^-{2,}\s*Forwarded message\s*-{2,}$/i,
  /^_{5,}$/,
  /^差出人:\s*.+$/,
  /^送信済み:\s*.+$/,
  /^From:\s*.+$/i
];

export function prepareEmailBodyForExtraction(
  value: string,
  latestLimit = 12000,
  contextLimit = 5000
): PreparedEmailBody {
  const normalized = value
    .normalize("NFKC")
    .replace(/\u200B|\uFEFF/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();

  if (!normalized) {
    return {
      latestMessage: "",
      quotedContext: ""
    };
  }

  const latestLines: string[] = [];
  const quotedLines: string[] = [];
  let inQuotedSection = false;

  for (const line of normalized.split("\n")) {
    if (QUOTED_SECTION_MARKERS.some((marker) => marker.test(line.trim()))) {
      inQuotedSection = true;
      quotedLines.push(line);
      continue;
    }

    if (line.trimStart().startsWith(">")) {
      quotedLines.push(line.replace(/^\s*>\s?/, ""));
      continue;
    }

    if (inQuotedSection) {
      quotedLines.push(line);
    } else {
      latestLines.push(line);
    }
  }

  const latestMessage = compactLines(latestLines.join("\n"));
  const quotedContext = compactLines(quotedLines.join("\n"));

  return {
    latestMessage: limitText(latestMessage || normalized, latestLimit),
    quotedContext: limitText(quotedContext, contextLimit)
  };
}

function compactLines(value: string) {
  return value.replace(/\n{3,}/g, "\n\n").trim();
}

function limitText(value: string, limit: number) {
  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, limit)}\n[truncated]`;
}
