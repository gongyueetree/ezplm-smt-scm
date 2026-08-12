"use client";

/**
 * E5:对账「怎么用」引导 + 示例(客户 Q11 原话:
 * 「没找到入口:此项功能不知如何实现,**需要举例**」)。
 *
 * 客户没说功能错 —— 说的是不知道怎么用。所以这里**不动对账引擎**,
 * 只补三样:五步引导、可下载的样例文件、一键加载的示例数据。
 *
 * 示例数据一律打「示例」标记,并且明说不计入正式结论 ——
 * 演示用的数字混进真实对账里,比没有示例更糟。
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

const STEPS: { title: string; desc: string }[] = [
  { title: "上传对账单", desc: "把客户/供应商给的对账单整理成几列(单据号、日期、数量、单价、金额、币种)后上传。列名中英文都认。" },
  { title: "系统匹配", desc: "按单据号 / 日期 / 金额与我方记录自动配对,配对依据会记下来,便于人工回查。" },
  { title: "查看差异", desc: "分七类:一致 / 数量差异 / 单价差异 / 金额差异 / 币种不一致 / 仅对方有 / 仅我方有。" },
  { title: "人工确认", desc: "逐条确认或写处理意见 —— 系统不替你判断谁对谁错。" },
  { title: "导出结果", desc: "把差异清单导出发给对方。" },
];

export function ReconHowTo({ kind }: { kind: "AR" | "AP" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadExample() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch(`/api/reconciliation/example?kind=${kind}`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? `加载示例失败(HTTP ${res.status})`);
        return;
      }
      setNote(body.note ?? "已加载示例");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="recon-how-to">
      <ol className="small" style={{ lineHeight: 1.9, paddingLeft: 20, margin: "4px 0" }}>
        {STEPS.map((s, i) => (
          <li key={s.title}>
            <b>
              步骤 {i + 1}:{s.title}
            </b>{" "}
            —— {s.desc}
          </li>
        ))}
      </ol>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
        <a className="btn" href={`/api/reconciliation/example?kind=${kind}`} data-testid="recon-example-download">
          下载{kind === "AR" ? "应收" : "应付"}对账单样例
        </a>
        <button className="btn" disabled={busy} onClick={() => void loadExample()} data-testid="recon-example-load">
          {busy ? "加载中…" : "加载示例数据"}
        </button>
      </div>

      <p className="small muted" style={{ marginTop: 6 }}>
        示例数据会在台账上标注<b>「示例」</b>,<b>不计入正式对账结论</b>,可随时删除。
        <br />
        当前对账基准来自<b>系统已有记录 / 导入数据</b>;
        <b>ERP AR/AP 尚未接入</b> —— 接入后可自动同步,在此之前不要把它当成 ERP 的账。
      </p>

      {error ? (
        <div className="banner warn" role="alert" data-testid="recon-example-error">
          {error}
        </div>
      ) : null}
      {note ? (
        <div className="banner soft" data-testid="recon-example-note">
          {note.replace(/\*\*/g, "")}
        </div>
      ) : null}
    </div>
  );
}
