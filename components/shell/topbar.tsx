"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { SessionPayload } from "@/lib/auth/session";
import { SEARCH_SCOPES, primaryRole } from "@/lib/rbac";
import { breadcrumbFor } from "@/lib/routes";

/** 顶栏:面包屑由统一 route config 派生;搜索框按角色标注搜索范围(SPEC §3) */
export function Topbar({ session }: { session: SessionPayload }) {
  const pathname = usePathname();
  const crumbs = breadcrumbFor(pathname);
  const role = primaryRole(session.roles);
  const scopes = role ? SEARCH_SCOPES[role] : [];

  return (
    <header className="topbar">
      <nav className="topbar-breadcrumb" aria-label="面包屑">
        {crumbs.map((c, i) =>
          i === crumbs.length - 1 ? (
            <span className="current" key={c.path}>
              {c.label}
            </span>
          ) : (
            <span key={c.path} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <Link href={c.path}>{c.label}</Link>
              <span aria-hidden>/</span>
            </span>
          ),
        )}
      </nav>
      <div className="topbar-spacer" />
      <input
        className="topbar-search"
        type="search"
        placeholder={`搜索:${scopes.join(" / ")}(PR5+ 实现)`}
        disabled
        title="搜索随各功能 PR 落地;范围按角色限定"
      />
      <span className="badge purple">α 开发版 · PR2</span>
    </header>
  );
}
