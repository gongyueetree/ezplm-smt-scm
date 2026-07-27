import { Badge } from "./badge";
import { Banner } from "./banner";
import { Card } from "./card";
import { PageHeader } from "./page-header";
import { findRoute } from "@/lib/routes";

/**
 * 模块占位页(诚实 UI):如实标注"待实现"与计划 PR,
 * 不渲染任何假数据、假完成态。
 */
export function ModulePlaceholder({ path }: { path: string }) {
  const route = findRoute(path);
  if (!route) {
    return <PageHeader path={path} />;
  }
  return (
    <div>
      <PageHeader path={path} />
      <Banner tone="soft">
        <span>
          状态:<b>待实现</b> — 本页面为 PR1 UI Shell 占位,功能计划在 <b>{route.plannedPr}</b>{" "}
          落地(依据 docs/SPEC.md 与 docs/INTEGRATION_PLAN.md §3)。当前不含任何真实或模拟业务数据。
        </span>
      </Banner>
      <Card title="模块规划" sub={route.plannedPr}>
        <p className="small muted" style={{ lineHeight: 1.8 }}>
          {route.desc}
        </p>
        <div className="divider" />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Badge tone="gray">待实现</Badge>
          {route.ai ? <Badge tone="purple">AI 增强 · 人工确认闭环</Badge> : <Badge tone="green">ezPLM 原生功能</Badge>}
        </div>
      </Card>
    </div>
  );
}
