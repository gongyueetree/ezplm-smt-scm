import { Fragment, Suspense } from "react";
import Link from "next/link";
import { BackLink } from "@/components/shell/back-link";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import { MpnLink } from "@/components/ui/mpn-link";
import { FIELD_LABELS, type EnrichableField } from "@/lib/domain/field-merge";
import { getPartDetail } from "@/lib/server/repositories/part-detail";
import { getSession } from "@/lib/server/session";
import { CandidateFinder } from "./candidate-finder";
import { LibraryPreview, LibraryPreviewFallback } from "./library-preview";
import { LiveOffers } from "./live-offers";
import { Model3D } from "./model-3d";

export const dynamic = "force-dynamic";

const DOC_LABEL: Record<string, { text: string; tone: "green" | "blue" | "purple" | "gray" }> = {
  DATASHEET: { text: "数据手册", tone: "blue" },
  SYMBOL: { text: "原理图符号库", tone: "green" },
  FOOTPRINT: { text: "PCB 封装库", tone: "green" },
  MODEL_3D: { text: "3D 模型", tone: "purple" },
  APP_NOTE: { text: "应用笔记", tone: "gray" },
  CERTIFICATE: { text: "证书/通告", tone: "gray" },
  OTHER: { text: "其它", tone: "gray" },
};

const SOURCE_LABEL: Record<string, { text: string; tone: "green" | "amber" | "gray" }> = {
  ezplm: { text: "ezPLM 实时接口", tone: "green" },
  "local-cache": { text: "本地缓存(ezPLM 未返回该料)", tone: "amber" },
  mock: { text: "示例数据(未配置 ezPLM 凭据)", tone: "amber" },
};

/** 参考设计说明是整段富文本,列表里截断显示,完整内容放 title */
function clamp(text: string | null | undefined, max: number): string {
  if (!text) return "-";
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max)}…` : one;
}

/** 字段来源标签:客户/自家给的,与外部反查来的,可信度完全不同,必须分开显示 */
const FIELD_SOURCE_LABEL: Record<string, { text: string; tone: "green" | "blue" | "purple" | "gray" }> = {
  LOCAL: { text: "本地库", tone: "green" },
  EZPLM: { text: "ezPLM", tone: "blue" },
  DIGIKEY: { text: "DigiKey 反查", tone: "purple" },
  MOUSER: { text: "Mouser 反查", tone: "purple" },
};

function fmtSize(b: number | null): string {
  if (b === null) return "-";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

export default async function PartDetailPage({ params }: { params: Promise<{ mpn: string }> }) {
  const { mpn: raw } = await params;
  const mpn = decodeURIComponent(raw);
  const session = (await getSession())!;
  const d = await getPartDetail(session.tenantId, mpn);

  const model3d = d.documents.find((x) => x.kind === "MODEL_3D") ?? null;

  /** 渲染一个字段:值 + 来源徽标;缺失时如实写「各数据源均无」 */
  const Field = ({ name }: { name: EnrichableField }) => {
    const f = d.fields[name];
    if (f.source === null) {
      return <span className="muted">各数据源均无</span>;
    }
    const label = FIELD_SOURCE_LABEL[f.source] ?? { text: f.source, tone: "gray" as const };
    const text =
      typeof f.value === "boolean" ? (f.value ? "合规" : "不合规") : String(f.value ?? "");
    return (
      <>
        {text}{" "}
        <Badge tone={label.tone}>{label.text}</Badge>
      </>
    );
  };
  void FIELD_LABELS;

  const groups = new Map<string, typeof d.parameters>();
  for (const p of d.parameters) {
    const g = p.group ?? "基本参数";
    groups.set(g, [...(groups.get(g) ?? []), p]);
  }

  return (
    <div>
      <BackLink href="/materials" label="物料查询" />
      <div className="page-head">
        <div>
          <h1 className="page-title mono">{mpn}</h1>
          <p className="page-desc">
            {d.part?.manufacturer ?? "制造商未知"} · {d.part?.description ?? "无描述"}
          </p>
        </div>
        <div className="page-actions">
          <Badge tone={SOURCE_LABEL[d.source].tone}>{SOURCE_LABEL[d.source].text}</Badge>
        </div>
      </div>

      {d.configWarnings.length > 0 ? (
        <Banner tone="warn">
          <span>
            <b>ezPLM 配置提示</b>:{d.configWarnings.join(";")}
          </span>
        </Banner>
      ) : null}

      {d.degraded.length > 0 ? (
        <Banner tone="warn">
          <span>
            <b>外部数据源降级</b>(已展示可用部分,未隐藏失败):
            {d.degraded.map((x, i) => (
              <span key={i}>
                {" "}
                {x.provider}/{x.kind} — {x.message}
              </span>
            ))}
          </span>
        </Banner>
      ) : null}

      {!d.part ? (
        <Banner tone="warn">
          <span>
            未在 ezPLM 与本地缓存中找到 <b className="mono">{mpn}</b>。
            ezPLM API 仅返回<b>白名单供应商</b>的系统库物料,该料可能不在白名单内。
          </span>
        </Banner>
      ) : null}

      <Banner tone="soft">
        <span>
          物料主数据、规格参数与库文件的<b>唯一真源是 ezPLM</b>,本系统只读不改写;
          数据获取时间 {d.fetchedAt ? d.fetchedAt.slice(0, 19).replace("T", " ") : "未知"}
          (为<b>抓取时间</b>,非 ezPLM 侧的数据更新时间)。
          ezPLM 查询接口有<b>日调用配额</b>,详情已按 24 小时缓存。
          ezPLM 未收录或字段缺失时,<b>由 DigiKey / Mouser 反查补齐</b>,
          每个字段都标注了来源 —— 只补空,<b>不覆盖已有值</b>。
        </span>
      </Banner>

      {/* ① 基本信息 */}
      <Card title="① 基本信息" flush>
        <div className="tbl-scroll">
          <table className="tbl">
            <tbody>
              <tr>
                <th style={{ width: 160 }}>厂商型号 MPN</th>
                <td className="mono">{d.part?.mpn ?? mpn}</td>
                <th style={{ width: 160 }}>制造商</th>
                <td>
                  <Field name="manufacturer" />
                </td>
              </tr>
              <tr>
                <th>描述</th>
                <td colSpan={3}>
                  <Field name="description" />
                </td>
              </tr>
              <tr>
                <th>封装</th>
                <td>
                  <Field name="footprint" />
                </td>
                <th>生命周期</th>
                <td>
                  <Badge
                    tone={
                      d.fields.lifecycle.value === "ACTIVE"
                        ? "green"
                        : d.fields.lifecycle.value === "NRND"
                          ? "amber"
                          : d.fields.lifecycle.source === null
                            ? "gray"
                            : "red"
                    }
                  >
                    {(d.fields.lifecycle.value as string) ?? "UNKNOWN"}
                  </Badge>{" "}
                  {d.fields.lifecycle.source ? (
                    <Badge
                      tone={FIELD_SOURCE_LABEL[d.fields.lifecycle.source]?.tone ?? "gray"}
                    >
                      {FIELD_SOURCE_LABEL[d.fields.lifecycle.source]?.text ??
                        d.fields.lifecycle.source}
                    </Badge>
                  ) : (
                    <span className="small muted">各数据源均无(ezPLM 接口不提供)</span>
                  )}
                </td>
              </tr>
              <tr>
                <th>内部料号</th>
                <td>{d.part?.internalPn ?? <span className="muted">ezPLM 接口不提供</span>}</td>
                <th>RoHS / REACH</th>
                <td>
                  <Field name="rohs" /> / <Field name="reach" />
                </td>
              </tr>
              <tr>
                <th>本地库存</th>
                <td>
                  {d.inventory ? (
                    <>
                      {d.inventory.qtyOnHand}
                      {d.inventory.qtySlowMoving ? (
                        <span className="muted"> (呆滞 {d.inventory.qtySlowMoving})</span>
                      ) : null}
                    </>
                  ) : (
                    <span className="muted">无缓存</span>
                  )}
                </td>
                <th>用量影响面</th>
                <td className="small">
                  BOM 引用 {d.usage.bomLines} 行 · OPO 在途 {d.usage.openOpoQty}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      {/* ② 规格参数 */}
      <Card title="② 规格参数" sub={`${d.parameters.length} 项`} flush>
        {d.parameters.length === 0 ? (
          <p className="small muted" style={{ padding: 16 }}>
            ezPLM 未返回该物料的参数。
          </p>
        ) : (
          <div className="tbl-scroll">
            <table className="tbl">
              <tbody>
                {[...groups.entries()].map(([group, items]) => (
                  <Fragment key={group}>
                    <tr>
                      <th colSpan={4}>{group}</th>
                    </tr>
                    {items.map((p, i) => (
                      <tr key={`${group}-${i}`}>
                        <td style={{ width: 200 }}>{p.name}</td>
                        <td colSpan={3}>
                          {p.value}
                          {p.unit ? ` ${p.unit}` : ""}
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ③ 在线预览:原理图符号 / PCB 封装 / 3D 模型 */}
      <Card
        title="③ 原理图符号与 PCB 封装(在线预览)"
        sub="由 ezPLM 库文件解析绘制"
        flush
      >
        {d.documents.some((x) => x.kind === "SYMBOL" || x.kind === "FOOTPRINT") ? (
          <Suspense fallback={<LibraryPreviewFallback />}>
            <LibraryPreview documents={d.documents} />
          </Suspense>
        ) : (
          <p className="small muted" style={{ padding: 16 }}>
            ezPLM 未提供该物料的符号/封装库文件。
          </p>
        )}
      </Card>

      {/* ④ 3D 模型 */}
      <Card title="④ 3D 模型(STEP 在线预览)" sub="本站自发的 OCCT 内核解析,不走 CDN" flush>
        {model3d ? (
          <Model3D mpn={mpn} fileName={model3d.name} />
        ) : (
          <p className="small muted" style={{ padding: 16 }}>
            ezPLM 未提供该物料的 3D 模型文件。
          </p>
        )}
      </Card>

      {/* ⑤ 价格与库存 */}
      <Card
        title="⑤ 分销商价格与库存(DigiKey / Mouser)"
        sub="经 15 分钟缓存;显示数据更新时间,非实时行情"
        flush
      >
        <LiveOffers mpn={mpn} manufacturer={d.part?.manufacturer ?? null} />
      </Card>

      {/* ⑥ 文档与库文件 */}
      <Card title="⑥ 数据手册与库文件" sub={`${d.documents.length} 份`} flush>
        {d.documents.length === 0 ? (
          <p className="small muted" style={{ padding: 16 }}>
            ezPLM 未返回该物料的文档。
          </p>
        ) : (
          <div className="tbl-scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th>类型</th>
                  <th>文件名</th>
                  <th className="num">大小</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {d.documents.map((doc) => (
                  <tr key={doc.id}>
                    <td>
                      <Badge tone={DOC_LABEL[doc.kind]?.tone ?? "gray"}>
                        {DOC_LABEL[doc.kind]?.text ?? doc.kind}
                      </Badge>
                    </td>
                    <td className="small">{doc.name}</td>
                    <td className="num small">{fmtSize(doc.sizeBytes)}</td>
                    <td>
                      {doc.url ? (
                        <a className="btn sm" href={doc.url} target="_blank" rel="noreferrer">
                          打开 / 下载
                        </a>
                      ) : (
                        <span className="small muted">无链接</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ⑦ 替代料 */}
      <Card title="⑦ 替代料" sub={`${d.alternates.length} 条 · 每条标注来源`} flush>
        <div style={{ padding: "10px 16px 0" }}>
          <p className="small muted">
            ⚠ ezPLM API Key 查询接口<b>不提供替代料能力</b>,此处为
            <b>本地维护的替代关系</b> 与 <b>DigiKey Substitutions</b> 的聚合结果;
            替代关系是否成立<b>必须人工确认</b>后方可用于报价与采购。
          </p>
        </div>
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>替代型号</th>
                <th>制造商</th>
                <th>判断依据</th>
                <th>来源</th>
              </tr>
            </thead>
            <tbody>
              {d.alternates.length === 0 ? (
                <tr>
                  <td colSpan={4} className="muted small" style={{ textAlign: "center", padding: 20 }}>
                    暂无替代料候选
                  </td>
                </tr>
              ) : (
                d.alternates.map((a, i) => (
                  <tr key={`${a.candidate.mpn}-${i}`}>
                    <td>
                      <MpnLink mpn={a.candidate.mpn} />
                      {a.readyToOrder ? (
                        <div>
                          <Badge tone="green">可直接下单</Badge>
                        </div>
                      ) : null}
                    </td>
                    <td className="small">{a.candidate.manufacturer ?? "-"}</td>
                    <td className="small muted">{a.reasons.join(" · ")}</td>
                    <td>
                      <Badge tone={a.candidate.origin === "LOCAL" ? "green" : "purple"}>
                        {a.candidate.origin === "LOCAL"
                          ? "本系统物料库"
                          : a.candidate.origin === "EZPLM"
                            ? "ezPLM"
                            : a.candidate.origin}
                      </Badge>
                      <div className="small muted">评分 {(a.score * 100).toFixed(0)}</div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <CandidateFinder mpn={mpn} />
      </Card>

      {/* ⑧ 供应与库存 */}
      <Card
        title="⑧ 供应与库存"
        sub="本系统内数据(库存快照 / OPO 采购行),非 ERP 实时"
        flush
      >
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>采购单</th>
                <th>供应商</th>
                <th className="num">订购量</th>
                <th className="num">未交</th>
                <th className="num">单价</th>
                <th>承诺交期</th>
              </tr>
            </thead>
            <tbody>
              {d.purchaseHistory.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted small" style={{ textAlign: "center", padding: 20 }}>
                    暂无采购记录
                  </td>
                </tr>
              ) : (
                d.purchaseHistory.map((h) => (
                  <tr key={`${h.poNo}-${h.lineNo}`}>
                    <td className="mono small">
                      {h.poNo}-{h.lineNo}
                    </td>
                    <td className="small">{h.supplier}</td>
                    <td className="num small">{h.qtyOrdered}</td>
                    <td className="num small">{h.qtyOpen}</td>
                    <td className="num small">
                      {h.unitPrice ? `${h.unitPrice} ${h.currency ?? ""}` : "-"}
                    </td>
                    <td className="small">{h.promiseDate ?? "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ⑨ 参考设计(ezPLM 独有能力) */}
      {d.referenceDesigns.length > 0 ? (
        <Card title="⑨ 参考设计" sub={`${d.referenceDesigns.length} 个 · 来自 ezPLM`} flush>
          <div className="tbl-scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th>名称</th>
                  <th>说明</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {d.referenceDesigns.map((r, i) => (
                  <tr key={i}>
                    <td>{r.name}</td>
                    <td className="small muted" title={r.description ?? undefined}>
                      {clamp(r.description, 120)}
                    </td>
                    <td>
                      {r.link ? (
                        <a className="btn sm" href={r.link} target="_blank" rel="noreferrer">
                          打开
                        </a>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <Card title="相关操作">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link className="btn" href={`/materials?q=${encodeURIComponent(mpn)}`}>
            在物料列表中查看
          </Link>
          <Link className="btn" href={`/shortage`}>
            缺料分析
          </Link>
        </div>
      </Card>
    </div>
  );
}
