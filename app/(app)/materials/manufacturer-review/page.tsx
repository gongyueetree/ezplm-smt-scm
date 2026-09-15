import { BackLink } from "@/components/shell/back-link";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import { getSession } from "@/lib/server/session";
import { notFound } from "next/navigation";
import { ReviewPanel } from "./review-panel";

export const dynamic = "force-dynamic";

/**
 * R4-3(§19):Manufacturer Resolution Review。
 * 乾创 ERP 的原始 MFG 写法(YAGEO(国巨)/TI/#N …)→ 标准制造商建议 →
 * 人工 Approve/Reject/选择;批准后生成**租户级**别名(不污染其它租户)。
 */
export default async function ManufacturerReviewPage() {
  const session = (await getSession())!;
  if (!session.roles.some((r) => r === "ENGINEERING" || r === "MANAGEMENT")) notFound();
  return (
    <div>
      <BackLink href="/materials" label="物料主数据" />
      <div className="page-head">
        <div>
          <h1 className="page-title">制造商解析评审</h1>
          <p className="page-desc">
            原始 MFG 写法 → 标准制造商(ezPLM 为真源)· 批准生成租户别名 · 自动系统只提建议
          </p>
        </div>
      </div>
      <Banner tone="soft">
        解析顺序:租户别名 → 全局别名 → 标准名精确 → <b>MPN 证据(高置信候选,须人工批准)</b> →
        相似候选;冲突(MPN 证据与原始厂商不符)一律人工裁决,系统不静默「修正」。
        批量批准只作用于**确定性来源**;MPN/相似候选永远逐条。
      </Banner>
      <Card title="待评审原始厂商" flush>
        <ReviewPanel />
      </Card>
    </div>
  );
}
