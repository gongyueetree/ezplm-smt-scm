import type { ReactNode } from "react";

export type BadgeTone = "green" | "purple" | "amber" | "red" | "gray" | "blue";

export function Badge({ tone = "gray", children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
