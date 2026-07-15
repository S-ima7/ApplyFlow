import { describe, expect, it } from "vitest";
import {
  isPossibleCompanyVariant,
  resolveBrowserMessageApplicationMatch
} from "@/features/browser-extension/application-matching";

const applications = [
  {
    id: "application_1",
    companyId: "company_1",
    companyName: "株式会社分析屋",
    position: "データエンジニア",
    sourceSite: "GREEN"
  }
];

describe("browser message application matching", () => {
  it("automatically merges an exact company and position", () => {
    const result = resolveBrowserMessageApplicationMatch(
      applications,
      { companyName: "株式会社分析屋", position: "データエンジニア" },
      "GREEN"
    );
    expect(result.resolution).toBe("EXACT_APPLICATION");
    expect(result.recommendedApplicationId).toBe("application_1");
  });

  it("requires confirmation for a legal-form position variant", () => {
    expect(isPossibleCompanyVariant("株式会社分析屋", "分析屋株式会社")).toBe(true);
    const result = resolveBrowserMessageApplicationMatch(
      applications,
      { companyName: "分析屋株式会社", position: "データエンジニア" },
      "GREEN"
    );
    expect(result.resolution).toBe("CONFIRM_APPLICATION");
    expect(result.recommendedApplicationId).toBeNull();
    expect(result.possibleApplicationIds).toContain("application_1");
  });

  it("reuses an exact company while creating a different position", () => {
    const result = resolveBrowserMessageApplicationMatch(
      applications,
      { companyName: "株式会社分析屋", position: "フロントエンドエンジニア" },
      "GREEN"
    );
    expect(result.resolution).toBe("CREATE_WITH_EXISTING_COMPANY");
    expect(result.exactCompanyId).toBe("company_1");
  });

  it("creates a new company when there is no safe match", () => {
    const result = resolveBrowserMessageApplicationMatch(
      applications,
      { companyName: "別会社株式会社", position: "データエンジニア" },
      "GREEN"
    );
    expect(result.resolution).toBe("CREATE_NEW");
    expect(result.companySuggestions).toHaveLength(0);
  });
});
