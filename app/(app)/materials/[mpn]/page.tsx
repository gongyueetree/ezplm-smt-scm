import { Fragment } from "react";
import Link from "next/link";
import { BackLink } from "@/components/shell/back-link";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Card } from "@/components/ui/card";
import { MpnLink } from "@/components/ui/mpn-link";
import { getPartDetail } from "@/lib/server/repositories/part-detail";
import { getSession } from "@/lib/server/session";
import { CandidateFinder } from "./candidate-finder";

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
                <td>{d.part?.manufacturer ?? <span className="muted">未知</span>}</td>
              </tr>
              <tr>
                <th>描述</th>
                <td colSpan={3}>{d.part?.description ?? <span className="muted">未知</span>}</td>
              </tr>
              <tr>
                <th>封装</th>
                <td>{d.part?.footprint ?? <span className="muted">未知</span>}</td>
                <th>生命周期</th>
                <td>
                  <Badge
                    tone={
                      d.part?.lifecycle === "ACTIVE"
                        ? "green"
                        : d.part?.lifecycle === "NRND"
                          ? "amber"
                          : d.part?.lifecycle === "UNKNOWN" || !d.part
                            ? "gray"
                            : "red"
                    }
                  >
                    {d.part?.lifecycle ?? "UNKNOWN"}
                  </Badge>
                  {d.source === "ezplm" ? (
                    <span className="small muted"> · ezPLM 接口不提供生命周期</span>
                  ) : null}
                </td>
              </tr>
              <tr>
                <th>内部料号</th>
                <td>{d.part?.internalPn ?? <span className="muted">ezPLM 接口不提供</span>}</td>
                <th>RoHS / REACH</th>
                <td>
                  {d.part?.rohs === null || d.part?.rohs === undefined ? (
                    <span className="muted">ezPLM 接口不提供</span>
                  ) : (
                    `${d.part.rohs ? "合规" : "不合规"} / ${d.part.reach === null ? "未知" : d.part.reach ? "合规" : "不合规"}`
                  )}
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

      {/* ③ 文档与库文件 */}
      <Card title="③ 数据手册与库文件" sub={`${d.documents.length} 份`} flush>
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

      {/* ④ 替代料 */}
      <Card title="④ 替代料" sub={`${d.alternates.length} 条 · 每条标注来源`} flush>
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
                <th>等级 / 说明</th>
                <th>来源</th>
              </tr>
            </thead>
            <tbody>
              {d.alternates.length === 0 ? (
                <tr>
                  <td colSpan={4} className="muted small" style={{ textAlign: "center", padding: 20 }}>
                    暂无替代料记录
                  </td>
                </tr>
              ) : (
                d.alternates.map((a, i) => (
                  <tr key={`${a.mpn}-${i}`}>
                    <td>
                      <MpnLink mpn={a.mpn} />
                    </td>
                    <td className="small">{a.manufacturer ?? "-"}</td>
                    <td className="small">
                      {a.grade ? <Badge tone="green">{a.grade}</Badge> : null} {a.note ?? ""}
                    </td>
                    <td>
                      <Badge tone={a.source === "local" ? "blue" : "purple"}>
                        {a.source === "local" ? "本地维护" : "DigiKey"}
                      </Badge>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <CandidateFinder mpn={mpn} />
      </Card>

      {/* ⑤ 供应与库存 */}
      <Card
        title="⑤ 供应与库存"
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

      {/* ⑥ 参考设计(ezPLM 独有能力) */}
      {d.referenceDesigns.length > 0 ? (
        <Card title="⑥ 参考设计" sub={`${d.referenceDesigns.length} 个 · 来自 ezPLM`} flush>
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
