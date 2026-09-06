import type { ReactNode } from "react";
import type { SessionPayload } from "@/lib/auth/session";
import { loadPermissions } from "@/lib/server/permissions";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

/**
 * F1:导航按**权限**真正变化 —— AppShell 是服务端组件,
 * 在这里查一次有效权限传给客户端 Sidebar;
 * 页面与 API 的服务端 RBAC 不变,菜单只是可见性,不是安全边界。
 */
export async function AppShell({ session, children }: { session: SessionPayload; children: ReactNode }) {
  const permissions = [...(await loadPermissions(session))];
  return (
    <div className="app">
      <Sidebar session={session} permissions={permissions} />
      <div className="main">
        <Topbar session={session} />
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
