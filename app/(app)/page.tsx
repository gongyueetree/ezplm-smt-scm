import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import {
  ROLE_LABELS,
  SEARCH_SCOPES,
  WORKBENCH_KPIS,
  WORKBENCH_TITLES,
  primaryRole,
} from "@/lib/rbac";
import { getSession } from "@/lib/server/session";
import { getManagementSnapshot } from "@/lib/server/repositories/management";
import { ManagementBoard } from "./management-board";

/**
 * 角色化工作台骨架(SPEC §3 / §16)。
 * 诚实 UI:KPI 数据源随对应 PR 落地,当前值一律 "—" 占位,不渲染假数字。
 */
export default async function WorkbenchPage() {
  const session = (await getSession())!; // (app) layout 已保证非空
  const role = primaryRole(session.roles);

  if (!role) {
    return <Banner tone="warn">当前账号未分配角色,请联系管理员在系统设置中分配。</Banner>;
  }

  // 管理工作台:KPI 由明细派生,已接入真实数据(SPEC §16)
  if (role === "MANAGEMENT") {
    const snapshot = await getManagementSnapshot(session.tenantId, new Date().toISOString());
    return (
      <div>
        <div className="page-head">
          <div>
            <h1 className="page-title">{WORKBENCH_TITLES[role]}</h1>
            <p className="page-desc">
              {session.name} · {ROLE_LABELS[role]} · 搜索范围:{SEARCH_SCOPES[role].join(" / ")}
            </p>
          </div>
        </div>
        <ManagementBoard snapshot={snapshot} />
      </div>
    );
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">{WORKBENCH_TITLES[role]}</h1>
          <p className="page-desc">
            {session.name} · {ROLE_LABELS[role]} · 搜索范围:{SEARCH_SCOPES[role].join(" / ")}
          </p>
        </div>
      </div>
      <div className="kpi-grid">
        {WORKBENCH_KPIS[role].map((kpi) => (
          <div className={`kpi${kpi.ai ? " ai" : ""}`} key={kpi.label}>
            <div className="kpi-label">{kpi.label}</div>
            <div className="kpi-value muted">—</div>
            <div className="kpi-foot">数据随 {kpi.sourcePr} 落地</div>
          </div>
        ))}
      </div>
      <Card title="工作台状态" sub="PR2 骨架">
        <p className="small muted" style={{ lineHeight: 1.8 }}>
          本工作台为 PR2 角色骨架:菜单、搜索范围与 KPI 卡片已按角色联动;KPI
          数值、风险色标与点击下钻随对应功能 PR(PR5–PR8)接入真实数据,当前不显示任何模拟数字。
        </p>
        <div className="divider" />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Badge tone="green">RBAC 已生效</Badge>
          <Badge tone="gray">KPI 待数据</Badge>
        </div>
      </Card>
    </div>
  );
}
