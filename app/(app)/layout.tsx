import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { getSession } from "@/lib/server/session";

/** 受保护区:无会话跳登录(middleware 已拦一层,此处兜底并取会话给 Shell) */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  return <AppShell session={session}>{children}</AppShell>;
}
