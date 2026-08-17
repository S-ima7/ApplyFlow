import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";

describe("iPhone PWA contract", () => {
  it("publishes installable standalone metadata without disabling zoom", () => {
    const rootLayout = readFileSync(join(process.cwd(), "app", "layout.tsx"), "utf8");

    expect(manifest()).toMatchObject({
      id: "/",
      start_url: "/dashboard",
      scope: "/",
      display: "standalone",
      background_color: "#f7f8fb",
      theme_color: "#2563eb",
      icons: expect.arrayContaining([
        expect.objectContaining({ sizes: "512x512", purpose: "any" }),
        expect.objectContaining({ sizes: "512x512", purpose: "maskable" })
      ])
    });
    expect(rootLayout).toContain('capable: true');
    expect(rootLayout).toContain('"apple-mobile-web-app-capable": "yes"');
    expect(rootLayout).toContain('viewportFit: "cover"');
    expect(rootLayout).not.toContain("maximumScale");
    expect(rootLayout).not.toContain("userScalable");
  });

  it("keeps authenticated responses network-only in the service worker", () => {
    const serviceWorker = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");

    expect(serviceWorker).toContain("event.respondWith(fetch(event.request))");
    expect(serviceWorker).not.toMatch(/\bcaches\./);
  });

  it("mounts pull to refresh only for the iOS standalone experience", () => {
    const rootLayout = readFileSync(join(process.cwd(), "app", "layout.tsx"), "utf8");
    const pullToRefresh = readFileSync(
      join(process.cwd(), "components", "pwa-pull-to-refresh.tsx"),
      "utf8"
    );

    expect(rootLayout).toContain("<PwaPullToRefresh />");
    expect(pullToRefresh).toContain(".standalone");
    expect(pullToRefresh).toContain("window.scrollY > 0");
    expect(pullToRefresh).toContain("window.location.reload()");
  });

  it("keeps Safari form and tap sizes at iPhone landscape widths", () => {
    const input = readFileSync(join(process.cwd(), "components", "ui", "input.tsx"), "utf8");
    const select = readFileSync(join(process.cwd(), "components", "ui", "select.tsx"), "utf8");
    const textarea = readFileSync(
      join(process.cwd(), "components", "ui", "textarea.tsx"),
      "utf8"
    );
    const button = readFileSync(join(process.cwd(), "components", "ui", "button.tsx"), "utf8");
    const sidebar = readFileSync(
      join(process.cwd(), "components", "layout", "sidebar.tsx"),
      "utf8"
    );
    const globalStyles = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");

    for (const field of [input, select, textarea]) {
      expect(field).toContain("text-base");
      expect(field).not.toContain("md:text-sm");
    }
    expect(button).not.toMatch(/md:h-(8|9|10)/);
    expect(sidebar).toContain("flex min-h-11 items-center");
    expect(globalStyles).toMatch(/\.fc \.fc-button \{\s+min-height: 2\.75rem;/);
  });
});
