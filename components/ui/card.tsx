import type { ReactNode } from "react";

export function Card({
  title,
  sub,
  children,
  flush = false,
}: {
  title?: string;
  sub?: string;
  children: ReactNode;
  flush?: boolean;
}) {
  return (
    <section className="card">
      {title ? (
        <div className="card-head">
          <span className="card-title">{title}</span>
          {sub ? <span className="card-sub">{sub}</span> : null}
        </div>
      ) : null}
      <div className={`card-body${flush ? " flush" : ""}`}>{children}</div>
    </section>
  );
}
