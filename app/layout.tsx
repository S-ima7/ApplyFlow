import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ApplyFlow",
  description: "Selection process CRM for job search and career change workflows"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
