import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "ApplyFlow",
    short_name: "ApplyFlow",
    description: "応募、面談、返信待ち、期限を一元管理する選考管理CRM",
    lang: "ja",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#f7f8fb",
    theme_color: "#2563eb",
    icons: [
      {
        src: "/icon",
        sizes: "512x512",
        type: "image/png",
        purpose: "any"
      },
      {
        src: "/icon",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable"
      }
    ]
  };
}
