"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 可缩放/拖动的 SVG 视口(原理图符号、PCB 封装等图纸类内容)。
 *
 * 设计取舍:
 * - 缩放用 CSS transform 而不是改 viewBox —— 服务端渲染出来的 SVG 保持不变,
 *   视口只负责"怎么看",两件事不耦合;
 * - 滚轮缩放**以光标为锚点**(手册式看图的基本预期),不是围绕左上角;
 * - wheel 必须用原生监听 + passive:false,否则 preventDefault 无效,页面会跟着滚。
 *
 * 触控:单指拖动、双指捏合都走 Pointer Events,不额外引库。
 */

const MIN_SCALE = 0.4;
const MAX_SCALE = 24;

interface Pose {
  k: number;
  tx: number;
  ty: number;
}

const IDENTITY: Pose = { k: 1, tx: 0, ty: 0 };

function clampScale(k: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, k));
}

export function SvgViewport({
  html,
  label,
  height = 380,
}: {
  /** 服务端渲染好的 SVG 字符串 */
  html: string;
  label: string;
  height?: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [pose, setPose] = useState<Pose>(IDENTITY);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; cx: number; cy: number } | null>(null);

  /** 以视口内某点为锚点缩放:该点下的图形内容保持不动 */
  const zoomAt = useCallback((factor: number, cx: number, cy: number) => {
    setPose((p) => {
      const k = clampScale(p.k * factor);
      const ratio = k / p.k;
      return { k, tx: cx - (cx - p.tx) * ratio, ty: cy - (cy - p.ty) * ratio };
    });
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = host.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top);
    };
    host.addEventListener("wheel", onWheel, { passive: false });
    return () => host.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        cx: (a.x + b.x) / 2,
        cy: (a.y + b.y) / 2,
      };
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const next = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, next);

    if (pointers.current.size >= 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.current.dist > 0) {
        const host = hostRef.current;
        const rect = host?.getBoundingClientRect();
        const cx = (a.x + b.x) / 2 - (rect?.left ?? 0);
        const cy = (a.y + b.y) / 2 - (rect?.top ?? 0);
        zoomAt(dist / pinch.current.dist, cx, cy);
      }
      pinch.current = { dist, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      return;
    }

    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    setPose((p) => ({ ...p, tx: p.tx + dx, ty: p.ty + dy }));
  }

  function endPointer(e: React.PointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  }

  function zoomFromButton(factor: number) {
    const host = hostRef.current;
    const rect = host?.getBoundingClientRect();
    zoomAt(factor, (rect?.width ?? 0) / 2, (rect?.height ?? 0) / 2);
  }

  const dragging = pointers.current.size > 0;

  return (
    <div>
      <div
        ref={hostRef}
        className="svg-viewport"
        style={{ height, cursor: dragging ? "grabbing" : "grab" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onPointerLeave={endPointer}
        onDoubleClick={() => setPose(IDENTITY)}
        role="group"
        aria-label={`${label}(可缩放拖动)`}
      >
        <div
          className="svg-viewport-inner"
          style={{ transform: `translate(${pose.tx}px, ${pose.ty}px) scale(${pose.k})` }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
      <div
        style={{
          display: "flex",
          gap: 6,
          alignItems: "center",
          marginTop: 6,
          flexWrap: "wrap",
        }}
      >
        <button className="btn sm" type="button" onClick={() => zoomFromButton(1.3)} aria-label={`放大 ${label}`}>
          放大 +
        </button>
        <button className="btn sm" type="button" onClick={() => zoomFromButton(1 / 1.3)} aria-label={`缩小 ${label}`}>
          缩小 −
        </button>
        <button className="btn sm" type="button" onClick={() => setPose(IDENTITY)} aria-label={`适应窗口 ${label}`}>
          适应窗口
        </button>
        <span className="small muted">
          {Math.round(pose.k * 100)}% · 滚轮缩放 / 拖动平移 / 双击复位
        </span>
      </div>
    </div>
  );
}
