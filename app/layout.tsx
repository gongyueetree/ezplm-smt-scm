import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { AppShell } from "@/components/shell/app-shell";

export const metadata: Metadata = {
  title: {
    default: "ezPLM · AI 供应链协同",
    template: "%s · ezPLM AI 供应链协同",
  },
  description: "硬禾科技 ezPLM — AI 驱动供应链智能协同系统(乾创电子)",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
