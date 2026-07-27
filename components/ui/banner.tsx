import type { ReactNode } from "react";

export type BannerTone = "info" | "warn" | "ai" | "soft";

export function Banner({ tone = "info", children }: { tone?: BannerTone; children: ReactNode }) {
  return <div className={`banner ${tone}`}>{children}</div>;
}
