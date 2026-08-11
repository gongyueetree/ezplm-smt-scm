import type { ReactNode } from "react";

export function Card({
  title,
  sub,
  children,
  flush = false,
  actions,
}: {
  title?: string;
  sub?: string;
  children: ReactNode;
  flush?: boolean;
  /** 卡片右上角的操作区(导出/新建之类)。可选,不传时渲染与从前完全一致 */
  actions?: ReactNode;
}) {
  return (
    <section className="card">
      {title ? (
        <div className="card-head">
          <span className="card-title">{title}</span>
          {sub ? <span className="card-sub">{sub}</span> : null}
          {actions ? <span style={{ marginLeft: "auto" }}>{actions}</span> : null}
        </div>
      ) : null}
      <div className={`card-body${flush ? " flush" : ""}`}>{children}</div>
    </section>
  );
}
