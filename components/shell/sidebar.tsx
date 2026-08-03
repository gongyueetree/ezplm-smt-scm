"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { SessionPayload } from "@/lib/auth/session";
import { ROLE_LABELS, filterSectionsForRoles, primaryRole } from "@/lib/rbac";
import type { AppRoute } from "@/lib/routes";
import { NavIcon } from "./nav-icon";

function NavItem({ route, child = false }: { route: AppRoute; child?: boolean }) {
  const pathname = usePathname();
  const active = pathname === route.path;
  return (
    <Link
      href={route.path}
      className={`nav-item${child ? " child" : ""}${active ? " active" : ""}`}
      aria-current={active ? "page" : undefined}
    >
      {route.icon ? <NavIcon name={route.icon} /> : null}
      <span>{route.label}</span>
      {route.implemented === false ? (
        <span className="nav-pending" title={`待实现 · 计划 ${route.plannedPr}`}>
          待实现
        </span>
      ) : null}
      {route.ai ? <span className="ai-dot" title="AI 增强 · 人工确认闭环" /> : null}
    </Link>
  );
}

/**
 * 左侧菜单:由统一 route config 生成(SPEC §2),按会话角色过滤(SPEC §3)。
 */
export function Sidebar({ session }: { session: SessionPayload }) {
  const router = useRouter();
  const sections = filterSectionsForRoles(session.roles);
  const role = primaryRole(session.roles);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-logo">
          <div className="brand-mark">乾</div>
          <div>
            <div className="brand-name">乾创电子</div>
            <div className="brand-sub">AI 供应链协同</div>
          </div>
        </div>
      </div>
      <nav className="nav">
        {sections.map((section) => (
          <div className="nav-section" key={section.title}>
            <div className="nav-section-title">{section.title}</div>
            {section.routes.map((route) => (
              <div key={route.path}>
                <NavItem route={route} />
                {route.children?.map((c) => (
                  <NavItem key={c.path} route={c} child />
                ))}
              </div>
            ))}
          </div>
        ))}
      </nav>
      <div className="user-card">
        <div className="user-avatar">{session.name.slice(0, 1)}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="user-name">{session.name}</div>
          <div className="user-role">{role ? ROLE_LABELS[role] : "无角色"}</div>
        </div>
        <button className="btn ghost sm" onClick={logout} title="退出登录">
          退出
        </button>
      </div>
    </aside>
  );
}
