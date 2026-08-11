"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui/card";

/**
 * D-3(客户 PR2 反馈 工程-3:「BOM 对比界面没有输入口」)。
 *
 * 原来页面上只有一张版本表格,每行一个「选为变更前 / 选为变更后」链接:
 * 要比对两个版本得**点两次、整页刷新两次**,而且中间状态只体现在 URL 上。
 * 客户找不到"输入口"是合理的 —— 页面上确实没有任何可输入的控件。
 *
 * 这里补一个一次选完的选择器。原表格保留作为快捷方式,不删 ——
 * 版本多时"在列表里按 BOM 找"仍然更快。
 */
export interface VersionOption {
  id: string;
  label: string;
}

export function VersionPicker({
  versions,
  from,
  to,
  truncatedNotice,
}: {
  versions: VersionOption[];
  from?: string;
  to?: string;
  /** 版本数触顶时的如实提示;没触顶为 null */
  truncatedNotice: string | null;
}) {
  const router = useRouter();
  const [fromId, setFromId] = useState(from ?? "");
  const [toId, setToId] = useState(to ?? "");

  const same = fromId !== "" && fromId === toId;
  const ready = fromId !== "" && toId !== "" && !same;

  return (
    <Card title="选择要比对的两个版本" sub="可跨 BOM;选定后点「开始比对」">
      {truncatedNotice ? (
        <div className="banner warn" role="alert" data-testid="version-truncated">
          {truncatedNotice}
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label className="fld" style={{ marginBottom: 0, flex: 1, minWidth: 240 }}>
          <span>变更前</span>
          <select value={fromId} onChange={(e) => setFromId(e.target.value)}>
            <option value="">请选择</option>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </label>

        <label className="fld" style={{ marginBottom: 0, flex: 1, minWidth: 240 }}>
          <span>变更后</span>
          <select value={toId} onChange={(e) => setToId(e.target.value)}>
            <option value="">请选择</option>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </label>

        <button
          className="btn primary"
          disabled={!ready}
          onClick={() => router.push(`/bom/compare?from=${fromId}&to=${toId}`)}
        >
          开始比对
        </button>

        {/* 已经选好一对时给个互换,比重新选两次快 */}
        {fromId && toId ? (
          <button
            className="btn"
            onClick={() => {
              setFromId(toId);
              setToId(fromId);
            }}
          >
            互换前后
          </button>
        ) : null}
      </div>

      {/* 选了同一个版本要当场说清,而不是让人点了「开始比对」再看到一张全「未变化」的表 */}
      {same ? (
        <div className="small" style={{ color: "var(--red)", marginTop: 8 }} role="alert">
          变更前后是同一个版本,比对结果必然全部「未变化」—— 请换一个。
        </div>
      ) : null}
    </Card>
  );
}
