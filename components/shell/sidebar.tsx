"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_SECTIONS, type AppRoute } from "@/lib/routes";
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
      {route.ai ? <span className="ai-dot" title="AI 增强 · 人工确认闭环" /> : null}
    </Link>
  );
}

/**
 * 左侧菜单:完全由 lib/routes.ts 的统一 route config 生成(SPEC §2)。
 * 角色联动的菜单过滤在 PR2(Auth/RBAC)实现;当前为全量静态展示。
 */
export function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-logo">
          <div className="brand-mark">硬</div>
          <div>
            <div className="brand-name">硬禾科技 ezPLM</div>
            <div className="brand-sub">AI 供应链协同</div>
          </div>
        </div>
      </div>
      <nav className="nav">
        {NAV_SECTIONS.map((section) => (
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
        <div className="user-avatar">王</div>
        <div>
          <div className="user-name">王 工 / 乾创电子</div>
          <div className="user-role">示例用户 · 登录与角色切换随 PR2 实现</div>
        </div>
      </div>
    </aside>
  );
}
