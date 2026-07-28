import type { ReactNode } from "react";
import type { SessionPayload } from "@/lib/auth/session";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

export function AppShell({ session, children }: { session: SessionPayload; children: ReactNode }) {
  return (
    <div className="app">
      <Sidebar session={session} />
      <div className="main">
        <Topbar session={session} />
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
