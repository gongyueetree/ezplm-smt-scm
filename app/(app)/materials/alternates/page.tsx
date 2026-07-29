import { BackLink } from "@/components/shell/back-link";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import { AlternateFinder } from "./finder";

export const dynamic = "force-dynamic";

export default async function AlternatesPage({
  searchParams,
}: {
  searchParams: Promise<{ mpn?: string }>;
}) {
  const { mpn } = await searchParams;

  return (
    <div>
      <BackLink href="/materials" label="物料查询" />
      <div className="page-head">
        <div>
          <h1 className="page-title">替代料查询</h1>
          <p className="page-desc">
            对任意厂商型号跑一次替代分析:按型号系列、封装族与管脚数比对,
            检索本系统物料库、ezPLM 与 DigiKey
          </p>
        </div>
      </div>

      <Banner tone="ai">
        <span>
          候选排序优先级:<b>本系统物料库 &gt; 有现货 &gt; 在产 &gt; 性价比</b>,
          其中<b>型号相似度权重最高</b>。
          封装比对不比字符串,而是比<b>封装族 + 管脚数</b> ——
          <b>管脚数不同一律判为不可换</b>(SOT-23-5 与 SOT-23-6 只差一个字符,焊上去会短路)。
          ⚠ 结果只是候选,<b>是否可替代必须由工程按参数、封装、合规逐项人工确认</b>,
          系统不会自动替换任何料。
        </span>
      </Banner>

      <Card title="查询" sub="支持任意型号,不要求它已存在于本系统">
        <AlternateFinder initialMpn={mpn ?? ""} />
      </Card>
    </div>
  );
}
