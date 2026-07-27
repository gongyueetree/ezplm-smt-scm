import type { ReactNode } from "react";
import { BackLink } from "@/components/shell/back-link";
import { backTarget, findRoute } from "@/lib/routes";

/**
 * 统一页头:标题/描述来自 route config;
 * 非根路径自动渲染"返回上一层"按钮(SPEC §2),
 * 目标为最近的已配置上层路由,避免指向未配置路径。
 */
export function PageHeader({ path, actions }: { path: string; actions?: ReactNode }) {
  const route = findRoute(path);
  const back = backTarget(path);

  return (
    <div>
      {back ? <BackLink href={back.path} label={back.label} /> : null}
      <div className="page-head">
        <div>
          <h1 className="page-title">{route?.label ?? path}</h1>
          {route?.desc ? <p className="page-desc">{route.desc}</p> : null}
        </div>
        {actions ? <div className="page-actions">{actions}</div> : null}
      </div>
    </div>
  );
}
