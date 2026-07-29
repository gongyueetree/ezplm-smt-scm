"use client";

/**
 * 替代料候选清单的客户端状态。
 *
 * 语义:勾选 = "我人工看过,值得跟进",落库时连**当时的评分快照**一起存 ——
 * 评分算法以后改了,回看时也还能看到当初是凭什么勾的。
 * 勾选**不等于**替代关系成立,正式关系需另行确认。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { MarketSummaryView, ScoredResult } from "./result-card";

export interface AlternateSelectionView {
  id: string;
  alternateMpn: string;
  manufacturer: string | null;
  mode: string;
  technical: number;
  evidence: number;
  sourceTrust: number;
  confidence: number;
  reasons: string[];
  warnings: string[];
  market: MarketSummaryView | null;
  note: string | null;
  selectedAt: string;
}

function key(mpn: string): string {
  return mpn.trim().toUpperCase();
}

export function useAlternateSelections(
  subjectMpn: string | null,
  initial: AlternateSelectionView[] = [],
) {
  const [items, setItems] = useState<AlternateSelectionView[]>(initial);
  const [busyMpn, setBusyMpn] = useState<string | null>(null);
  // 乐观更新失败时要能整份回滚,故留一份与 items 同步的引用
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (mpn: string) => {
    const res = await fetch(`/api/materials/${encodeURIComponent(mpn)}/alternate-selections`);
    if (!res.ok) return;
    const body = await res.json().catch(() => null);
    setItems(body?.selections ?? []);
  }, []);

  // 工具页上被查型号会变,清单要跟着换;详情页 mpn 固定,初值即服务端渲染的结果
  const [loadedFor, setLoadedFor] = useState<string | null>(subjectMpn ? key(subjectMpn) : null);
  useEffect(() => {
    if (!subjectMpn) return;
    const k = key(subjectMpn);
    if (k === loadedFor) return;
    setLoadedFor(k);
    void reload(subjectMpn);
  }, [subjectMpn, loadedFor, reload]);

  const isSelected = useCallback(
    (mpn: string) => items.some((i) => key(i.alternateMpn) === key(mpn)),
    [items],
  );

  const toggle = useCallback(
    async (result: ScoredResult, mode: string, next: boolean) => {
      if (!subjectMpn) return;
      setBusyMpn(result.mpn);
      setError(null);

      // 先动 UI 再发请求:受控复选框若等接口回来才变,用户点下去那一下看着像没反应。
      // 失败时整份回滚 —— 不允许出现"看着勾上了其实没存"。
      const snapshot = itemsRef.current;
      const others = snapshot.filter((i) => key(i.alternateMpn) !== key(result.mpn));
      setItems(
        next
          ? [
              ...others,
              {
                id: `pending:${result.mpn}`,
                alternateMpn: result.mpn,
                manufacturer: result.manufacturer,
                mode,
                technical: result.technical,
                evidence: result.evidence,
                sourceTrust: result.sourceTrust,
                confidence: result.confidence,
                reasons: [],
                warnings: result.warnings,
                market: result.market,
                note: null,
                selectedAt: new Date().toISOString(),
              },
            ]
          : others,
      );

      const base = `/api/materials/${encodeURIComponent(subjectMpn)}/alternate-selections`;
      try {
        if (next) {
          const res = await fetch(base, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              alternateMpn: result.mpn,
              manufacturer: result.manufacturer,
              mode,
              technical: result.technical,
              evidence: result.evidence,
              sourceTrust: result.sourceTrust,
              confidence: result.confidence,
              reasons: [
                result.modeTag,
                ...result.rows.filter((r) => r.score !== null).map((r) => `${r.label}:${r.verdict}`),
              ],
              warnings: result.warnings,
              market: result.market,
            }),
          });
          const body = await res.json().catch(() => null);
          if (!res.ok) {
            setItems(snapshot);
            setError(body?.error ?? `保存失败(HTTP ${res.status})`);
            return;
          }
          setItems([...others, body.selection]);
        } else {
          const res = await fetch(`${base}?alternateMpn=${encodeURIComponent(result.mpn)}`, {
            method: "DELETE",
          });
          if (!res.ok) {
            setItems(snapshot);
            setError(`移除失败(HTTP ${res.status})`);
          }
        }
      } catch (e) {
        setItems(snapshot);
        setError(e instanceof Error ? e.message : "网络异常,未保存");
      } finally {
        setBusyMpn(null);
      }
    },
    [subjectMpn],
  );

  const remove = useCallback(
    async (alternateMpn: string) => {
      if (!subjectMpn) return;
      setBusyMpn(alternateMpn);
      const snapshot = itemsRef.current;
      setItems(snapshot.filter((i) => key(i.alternateMpn) !== key(alternateMpn)));
      try {
        const res = await fetch(
          `/api/materials/${encodeURIComponent(subjectMpn)}/alternate-selections?alternateMpn=${encodeURIComponent(alternateMpn)}`,
          { method: "DELETE" },
        );
        if (!res.ok) {
          setItems(snapshot);
          setError(`移除失败(HTTP ${res.status})`);
        }
      } catch (e) {
        setItems(snapshot);
        setError(e instanceof Error ? e.message : "网络异常,未移除");
      } finally {
        setBusyMpn(null);
      }
    },
    [subjectMpn],
  );

  return { items, isSelected, toggle, remove, busyMpn, error };
}
