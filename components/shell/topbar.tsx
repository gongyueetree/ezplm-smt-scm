"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { breadcrumbFor } from "@/lib/routes";

/** 顶栏:面包屑由统一 route config 派生 */
export function Topbar() {
  const pathname = usePathname();
  const crumbs = breadcrumbFor(pathname);

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
      <span className="badge purple">α 开发版 · PR1 UI Shell</span>
    </header>
  );
}
