import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "乾创电子 · AI 供应链协同",
    template: "%s · 乾创电子 AI 供应链协同",
  },
  description: "乾创电子 — AI 驱动供应链智能协同系统",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
