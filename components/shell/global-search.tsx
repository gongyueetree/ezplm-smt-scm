"use client";

/**
 * F1:全局搜索(顶栏)。范围由服务端按角色决定 —— 这里只显示与跳转。
 * 防抖 250ms;Escape/失焦收起;结果分组渲染,截断如实标注。
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";

interface Group {
  type: string;
  label: string;
  hits: { title: string; subtitle: string | null; href: string }[];
  truncated: boolean;
  note?: string;
}

export function GlobalSearch({ placeholder }: { placeholder: string }) {
  const [q, setQ] = useState("");
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (q.trim().length < 2) {
      setGroups(null);
      return;
    }
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`);
        if (!res.ok) return;
        const body = (await res.json()) as { groups: Group[] };
        setGroups(body.groups);
        setOpen(true);
      } finally {
        setBusy(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  return (
    <div ref={boxRef} style={{ position: "relative" }} data-testid="global-search">
      <input
        className="topbar-search"
        type="search"
        placeholder={placeholder}
        value={q}
        aria-label="全局搜索"
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => groups && setOpen(true)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
      />
      {open && groups ? (
        <div className="search-pop" data-testid="search-results">
          {busy ? <div className="small muted" style={{ padding: 8 }}>搜索中…</div> : null}
          {groups.length === 0 ? (
            <div className="small muted" style={{ padding: 8 }}>
              没有匹配「{q.trim()}」的结果(范围仅限当前角色可见数据)
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.type} style={{ padding: "6px 0" }}>
                <div className="small muted" style={{ padding: "0 8px" }} data-testid={`search-group-${g.type}`}>
                  {g.label}
                  {g.truncated ? " · 仅显示前几条,请细化关键词" : ""}
                </div>
                {g.note ? (
                  <div className="small muted" style={{ padding: "2px 8px" }}>
                    {g.note}
                  </div>
                ) : null}
                {g.hits.map((h, i) => (
                  <Link
                    key={`${g.type}-${i}`}
                    href={h.href}
                    className="search-hit"
                    onClick={() => setOpen(false)}
                  >
                    <span>{h.title}</span>
                    {h.subtitle ? <span className="muted small"> · {h.subtitle}</span> : null}
                  </Link>
                ))}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
