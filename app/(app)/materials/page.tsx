import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import { ModulePlaceholder } from "@/components/ui/module-placeholder";
import { ezplmProviderMode } from "@/lib/providers/ezplm";

/**
 * 物料查询占位页 + ezPLM Provider 状态(PR3)。
 * 诚实 UI:明示当前数据源是 Mock 还是 Http,集成状态只用 待联调/示例配置 表述。
 */
export default function MaterialsPage() {
  const mode = ezplmProviderMode();
  return (
    <div>
      <ModulePlaceholder path="/materials" />
      <Card title="ezPLM 数据源状态" sub="PR3 · Provider 层">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          {mode === "mock" ? (
            <>
              <Badge tone="amber">Mock 数据源 · 示例配置</Badge>
              <Badge tone="gray">ezPLM API:待联调</Badge>
            </>
          ) : (
            <Badge tone="blue">Http 数据源已配置 · 待联调验证</Badge>
          )}
        </div>
        <Banner tone="soft">
          <span>
            Provider 层(接口/Mock/Http/熔断重试/合同测试)已随 PR3 交付;当前运行于
            <b>{mode === "mock" ? " Mock 模式(样例数据)" : " Http 模式"}</b>。
            与 ezPLM 真实 API 的联调依赖其接口文档与测试 Key(整合方案 §7.3),联调完成前本页不声称任何真实数据能力。
          </span>
        </Banner>
      </Card>
    </div>
  );
}
