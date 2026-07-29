import { BackLink } from "@/components/shell/back-link";
import { Banner } from "@/components/ui/banner";
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
          评分拆成四维:<b>技术兼容</b>(按参数优先级加权的逐项比对)、
          <b>证据覆盖</b>(有多少参数真的拿到了数据)、
          <b>来源可信</b>(本地库/ezPLM 高于 AI 检索)、
          <b>结论可信</b>(取三者的短板,几何平均)。
          <b>未知参数不按 0 分计入</b>,而是扣「证据覆盖」—— 未知不等于不满足。
          Pin-to-Pin 模式下,引脚映射未经人工核对<b>永远不判「可直接替换」</b>。
          ⚠ 结果只是候选,<b>是否可替代必须由工程按参数、封装、合规逐项人工确认</b>,
          系统不会自动替换任何料。
        </span>
      </Banner>

      <AlternateFinder initialMpn={mpn ?? ""} />
    </div>
  );
}
