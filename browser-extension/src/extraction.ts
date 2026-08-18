(function initializeApplyFlowExtraction() {
  const adapterVersion = "1.1.0";
  const missingField = (): ApplyFlowExtractedField => ({
    confidence: "missing",
    source: "visible_dom"
  });

  type Adapter = {
    site: ApplyFlowSourceSite;
    matchesUrl(url: URL): boolean;
    companySelectors: string[];
    titleSelectors: string[];
    jobId(url: URL): string | undefined;
  };

  const adapters: Adapter[] = [
    {
      site: "GREEN",
      matchesUrl: (url) =>
        isHost(url, "green-japan.com") && /\/company\/\d+\/job\/\d+\/?$/i.test(url.pathname),
      companySelectors: [
        "[data-testid='company-name']",
        "[data-test='company-name']",
        ".job-company-name",
        ".company-name"
      ],
      titleSelectors: ["h1", "[data-testid='job-title']", ".job-title"],
      jobId: (url) => url.pathname.match(/\/job\/(\d+)/i)?.[1]
    },
    {
      site: "DODA",
      matchesUrl: (url) =>
        isHost(url, "doda.jp") &&
        (/JobSearchDetail/i.test(url.pathname) || /j_jid__[a-zA-Z0-9_-]+/i.test(url.pathname)),
      companySelectors: [
        "[data-testid='company-name']",
        "[data-test='company-name']",
        ".companyName",
        ".company-name"
      ],
      titleSelectors: ["h1", "[data-testid='job-title']", ".job-title"],
      jobId: (url) =>
        url.pathname.match(/j_jid__([a-zA-Z0-9_-]+)/i)?.[1] ??
        url.searchParams.get("jid") ??
        undefined
    },
    {
      site: "RECRUIT_AGENT",
      matchesUrl: (url) =>
        url.hostname.toLowerCase() === "www.r-agent.com" &&
        /^\/viewjob\/[^/]+\/?$/i.test(url.pathname),
      companySelectors: [
        "[data-testid='company-name']",
        "[data-test='company-name']",
        ".company-name"
      ],
      titleSelectors: ["h1", "[data-testid='job-title']", ".job-title"],
      jobId: (url) => url.pathname.match(/^\/viewjob\/([^/]+)\/?$/i)?.[1]
    }
  ];

  const api: ApplyFlowExtractionApi = {
    detectPage(document, url) {
      const adapter = adapters.find((candidate) => candidate.matchesUrl(url));

      if (!adapter) {
        return null;
      }

      const structuredJob = findJobPosting(document);
      const hasVisibleTitle = Boolean(readVisibleText(document, adapter.titleSelectors));
      return structuredJob || hasVisibleTitle ? adapter.site : null;
    },

    extract(document, url) {
      const adapter = adapters.find((candidate) => candidate.matchesUrl(url));

      if (!adapter || this.detectPage(document, url) !== adapter.site) {
        return null;
      }

      const job = findJobPosting(document);
      const companyName =
        fieldFromJson(readNestedString(job, ["hiringOrganization", "name"])) ??
        fieldFromVisible(document, adapter.companySelectors) ??
        missingField();
      const position =
        fieldFromJson(readString(job?.title)) ??
        fieldFromVisible(document, adapter.titleSelectors) ??
        fieldFromMeta(document, "meta[property='og:title']") ??
        missingField();
      const locationText =
        fieldFromJson(formatJobLocation(job?.jobLocation), "medium") ??
        fieldFromVisible(document, [
          "[data-testid='job-location']",
          "[data-test='job-location']",
          ".job-location",
          "[class~='location']"
        ]) ??
        missingField();
      const employmentTypeText =
        fieldFromJson(formatStringValue(job?.employmentType), "medium") ??
        fieldFromVisible(document, [
          "[data-testid='employment-type']",
          "[data-test='employment-type']",
          ".employment-type"
        ]) ??
        missingField();
      const compensationText =
        fieldFromJson(formatCompensation(job), "medium") ??
        fieldFromVisible(document, [
          "[data-testid='salary']",
          "[data-test='salary']",
          ".salary",
          ".compensation"
        ]) ??
        missingField();
      const warnings: string[] = [];

      if (!companyName.value) warnings.push("会社名を取得できませんでした");
      if (!position.value) warnings.push("ポジションを取得できませんでした");

      return {
        sourceSite: adapter.site,
        sourceUrl: this.normalizeUrl(readCanonicalUrl(document, url)),
        sourceJobId: adapter.jobId(url),
        companyName,
        position,
        locationText,
        employmentTypeText,
        compensationText,
        capturedAt: new Date().toISOString(),
        adapterVersion,
        warnings
      };
    },

    normalizeUrl(url) {
      const normalized = new URL(url.toString());
      normalized.hash = "";
      normalized.hostname = normalized.hostname.toLowerCase();

      for (const name of [...normalized.searchParams.keys()]) {
        const lowerName = name.toLowerCase();
        if (
          lowerName.startsWith("utm_") ||
          ["gclid", "fbclid", "yclid", "ref", "referrer"].includes(lowerName)
        ) {
          normalized.searchParams.delete(name);
        }
      }

      normalized.searchParams.sort();
      if (normalized.pathname !== "/") {
        normalized.pathname = normalized.pathname.replace(/\/+$/, "");
      }
      return normalized.toString();
    }
  };

  const target = globalThis as typeof globalThis & {
    ApplyFlowExtraction?: ApplyFlowExtractionApi;
  };
  target.ApplyFlowExtraction = api;

  function findJobPosting(document: Document): Record<string, unknown> | undefined {
    const scripts = document.querySelectorAll<HTMLScriptElement>("script[type='application/ld+json']");

    for (const script of scripts) {
      try {
        const parsed = JSON.parse(script.textContent ?? "") as unknown;
        const result = findTypedObject(parsed, "JobPosting");
        if (result) return result;
      } catch {
        // Ignore malformed third-party structured data and continue with visible DOM fallbacks.
      }
    }

    return undefined;
  }

  function findTypedObject(value: unknown, typeName: string): Record<string, unknown> | undefined {
    if (Array.isArray(value)) {
      for (const item of value) {
        const result = findTypedObject(item, typeName);
        if (result) return result;
      }
      return undefined;
    }

    if (!isRecord(value)) return undefined;
    const rawType = value["@type"];
    const types = Array.isArray(rawType) ? rawType : [rawType];
    if (types.some((type) => type === typeName)) return value;

    const graph = value["@graph"];
    return graph ? findTypedObject(graph, typeName) : undefined;
  }

  function fieldFromJson(
    value: string | undefined,
    confidence: ApplyFlowConfidence = "high"
  ): ApplyFlowExtractedField | undefined {
    const normalized = cleanText(value);
    return normalized ? { value: normalized, confidence, source: "json_ld" } : undefined;
  }

  function fieldFromVisible(
    document: Document,
    selectors: string[]
  ): ApplyFlowExtractedField | undefined {
    const value = readVisibleText(document, selectors);
    return value ? { value, confidence: "medium", source: "visible_dom" } : undefined;
  }

  function fieldFromMeta(
    document: Document,
    selector: string
  ): ApplyFlowExtractedField | undefined {
    const element = document.querySelector<HTMLMetaElement>(selector);
    const value = cleanText(element?.content);
    return value ? { value, confidence: "low", source: "meta" } : undefined;
  }

  function readVisibleText(document: Document, selectors: string[]) {
    for (const selector of selectors) {
      const elements = document.querySelectorAll<HTMLElement>(selector);
      for (const element of elements) {
        if (isVisible(element)) {
          const value = cleanText(element.innerText || element.textContent || "");
          if (value) return value;
        }
      }
    }
    return undefined;
  }

  function isVisible(element: HTMLElement) {
    if (element.hidden || element.closest("[hidden], [aria-hidden='true']")) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  }

  function readCanonicalUrl(document: Document, fallback: URL) {
    const value = document.querySelector<HTMLLinkElement>("link[rel='canonical']")?.href;
    if (!value) return fallback;

    try {
      const canonical = new URL(value, fallback);
      return canonical.hostname === fallback.hostname ? canonical : fallback;
    } catch {
      return fallback;
    }
  }

  function formatJobLocation(value: unknown) {
    const locations = Array.isArray(value) ? value : value ? [value] : [];
    const formatted = locations
      .map((location) => {
        if (!isRecord(location)) return undefined;
        const address = isRecord(location.address) ? location.address : location;
        return [address.addressCountry, address.addressRegion, address.addressLocality, address.streetAddress]
          .map(readString)
          .filter((part): part is string => Boolean(part))
          .join(" ");
      })
      .filter((part): part is string => Boolean(part));
    return formatted.length ? [...new Set(formatted)].join(" / ") : undefined;
  }

  function formatCompensation(job: Record<string, unknown> | undefined) {
    if (!job) return undefined;
    const baseSalary = isRecord(job.baseSalary) ? job.baseSalary : undefined;
    if (!baseSalary) return undefined;
    const currency = readString(baseSalary.currency) ?? "";
    const value = isRecord(baseSalary.value) ? baseSalary.value : baseSalary;
    const min = readString(value.minValue);
    const max = readString(value.maxValue);
    const exact = readString(value.value);
    const unit = readString(value.unitText) ?? "";
    const amount = min && max ? `${min}–${max}` : exact ?? min ?? max;
    return amount ? [currency, amount, unit].filter(Boolean).join(" ") : undefined;
  }

  function formatStringValue(value: unknown) {
    if (Array.isArray(value)) {
      const values = value.map(readString).filter((item): item is string => Boolean(item));
      return values.length ? values.join(" / ") : undefined;
    }
    return readString(value);
  }

  function readNestedString(value: Record<string, unknown> | undefined, path: string[]) {
    let current: unknown = value;
    for (const key of path) {
      if (!isRecord(current)) return undefined;
      current = current[key];
    }
    return readString(current);
  }

  function readString(value: unknown) {
    return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
  }

  function cleanText(value: string | undefined) {
    const cleaned = value?.replace(/\s+/g, " ").trim();
    return cleaned ? cleaned.slice(0, 500) : undefined;
  }

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  function isHost(url: URL, hostname: string) {
    return url.hostname === hostname || url.hostname.endsWith(`.${hostname}`);
  }
})();
