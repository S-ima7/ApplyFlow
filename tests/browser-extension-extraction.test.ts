// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import "../browser-extension/src/extraction";

const extraction = (
  globalThis as typeof globalThis & { ApplyFlowExtraction?: ApplyFlowExtractionApi }
).ApplyFlowExtraction;

describe("browser extension extraction adapters", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
  });

  it("extracts a Green JobPosting from public JSON-LD and normalizes tracking parameters", () => {
    document.head.innerHTML =
      '<link rel="canonical" href="https://www.green-japan.com/company/12/job/345?utm_source=mail" />';
    document.body.innerHTML = `
      <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "JobPosting",
          "title": "Frontend Engineer",
          "hiringOrganization": { "@type": "Organization", "name": "Example Works" },
          "employmentType": "正社員",
          "jobLocation": { "address": { "addressRegion": "東京都", "addressLocality": "千代田区" } },
          "baseSalary": { "currency": "JPY", "value": { "minValue": 5000000, "maxValue": 7000000, "unitText": "YEAR" } }
        }
      </script>`;

    const result = extraction?.extract(
      document,
      new URL("https://www.green-japan.com/company/12/job/345?utm_source=mail")
    );

    expect(result).toMatchObject({
      sourceSite: "GREEN",
      sourceJobId: "345",
      sourceUrl: "https://www.green-japan.com/company/12/job/345",
      companyName: { value: "Example Works", confidence: "high", source: "json_ld" },
      position: { value: "Frontend Engineer", confidence: "high", source: "json_ld" },
      employmentTypeText: { value: "正社員" },
      locationText: { value: "東京都 千代田区" },
      compensationText: { value: "JPY 5000000–7000000 YEAR" }
    });
  });

  it("uses visible DOM fallbacks on a doda job detail page", () => {
    document.body.innerHTML = `
      <p class="companyName">Sample Systems</p>
      <h1>Backend Engineer</h1>
      <p class="job-location">大阪府</p>
      <p class="employment-type">正社員</p>
      <p class="salary">年収600万円～</p>`;

    const result = extraction?.extract(
      document,
      new URL("https://doda.jp/DodaFront/View/JobSearchDetail/j_jid__3009990010/")
    );

    expect(result?.sourceSite).toBe("DODA");
    expect(result?.sourceJobId).toBe("3009990010");
    expect(result?.companyName).toMatchObject({
      value: "Sample Systems",
      confidence: "medium",
      source: "visible_dom"
    });
    expect(result?.position.value).toBe("Backend Engineer");
  });

  it("extracts a Recruit Agent public job and uses its URL slug as the job ID", () => {
    document.body.innerHTML = `
      <p class="company-name">サンプル株式会社</p>
      <h1>プロダクトエンジニア</h1>
      <p class="job-location">東京都 港区</p>
      <p class="employment-type">正社員</p>
      <p class="salary">想定年収600万円～800万円</p>`;

    const result = extraction?.extract(
      document,
      new URL("https://www.r-agent.com/viewjob/jkba8aa617cbdbc525/?utm_source=mail")
    );

    expect(result).toMatchObject({
      sourceSite: "RECRUIT_AGENT",
      sourceJobId: "jkba8aa617cbdbc525",
      sourceUrl: "https://www.r-agent.com/viewjob/jkba8aa617cbdbc525",
      companyName: { value: "サンプル株式会社", source: "visible_dom" },
      position: { value: "プロダクトエンジニア", source: "visible_dom" },
      locationText: { value: "東京都 港区", source: "visible_dom" },
      employmentTypeText: { value: "正社員", source: "visible_dom" },
      compensationText: { value: "想定年収600万円～800万円", source: "visible_dom" }
    });
  });

  it("does not activate on a Green listing page", () => {
    document.body.innerHTML = "<h1>求人一覧</h1>";
    expect(
      extraction?.detectPage(document, new URL("https://www.green-japan.com/search_key/01"))
    ).toBeNull();
  });

  it("recognizes the reported Green, doda, and Recruit Agent production URL formats", () => {
    document.body.innerHTML = "<h1>求人タイトル</h1>";

    expect(
      extraction?.detectPage(
        document,
        new URL("https://www.green-japan.com/company/11108/job/314924")
      )
    ).toBe("GREEN");
    expect(
      extraction?.detectPage(
        document,
        new URL(
          "https://doda.jp/DodaFront/View/JobSearchDetail/j_jid__3015284994/?recommendID=test&usrclk=test"
        )
      )
    ).toBe("DODA");
    expect(
      extraction?.detectPage(
        document,
        new URL("https://www.r-agent.com/viewjob/jkba8aa617cbdbc525/")
      )
    ).toBe("RECRUIT_AGENT");
  });

  it("does not treat Recruit Agent non-job pages as public job details", () => {
    document.body.innerHTML = "<h1>Personal Desktop</h1>";
    expect(
      extraction?.detectPage(document, new URL("https://pdt.r-agent.com/pdt/app/messages"))
    ).toBeNull();
    document.body.innerHTML = "<h1>非公開サブドメインの求人候補</h1>";
    expect(
      extraction?.detectPage(document, new URL("https://pdt.r-agent.com/viewjob/job-1/"))
    ).toBeNull();
  });
});
