const trackingParameterNames = new Set([
  "gclid",
  "fbclid",
  "yclid",
  "ref",
  "referrer"
]);

export function normalizeSourceUrl(value: string) {
  const url = new URL(value);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Unsupported URL protocol");
  }

  url.hash = "";
  url.hostname = url.hostname.toLowerCase();

  for (const name of [...url.searchParams.keys()]) {
    if (name.toLowerCase().startsWith("utm_") || trackingParameterNames.has(name.toLowerCase())) {
      url.searchParams.delete(name);
    }
  }

  url.searchParams.sort();

  if (url.pathname !== "/") {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }

  return url.toString();
}
