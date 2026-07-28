"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 可缩放/拖动的 SVG 视口(原理图符号、PCB 封装等图纸类内容)。
 *
 * **为什么不用 CSS transform 缩放**:
 * 对含 SVG 的 DOM 块做 `transform: scale()` 会把该图层按原始分辨率先栅格化、
 * 再把位图放大 —— 放大后引脚名和线条都是糊的。
 * 因此这里把变换写进 SVG **自身**的 `<g data-zoom-layer>`:
 * 浏览器按新的变换重新光栅化矢量,放到 2000% 依然清晰。
 *
 * 坐标换算用 `svg.getScreenCTM().inverse()`,
 * 屏幕 → viewBox 用户单位由浏览器算,不需要自己处理 meet 留白与设备像素比。
 *
 * 触控:单指拖动、双指捏合都走 Pointer Events,不额外引库。
 */

const MIN_SCALE = 0.4;
const MAX_SCALE = 40;

interface Pose {
  k: number;
  /** 平移量,单位是 SVG viewBox 用户单位(不是 px) */
  tx: number;
  ty: number;
}

const IDENTITY: Pose = { k: 1, tx: 0, ty: 0 };

export function SvgViewport({
  html,
  label,
  height = 380,
}: {
  /** 服务端渲染好的 SVG 字符串,内部须含 <g data-zoom-layer> */
  html: string;
  label: string;
  height?: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [pose, setPose] = useState<Pose>(IDENTITY);
  const poseRef = useRef<Pose>(IDENTITY);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchDist = useRef<number | null>(null);
  const captured = useRef(false);
  const [dragging, setDragging] = useState(false);

  const apply = useCallback((next: Pose) => {
    poseRef.current = next;
    setPose(next);
  }, []);

  /**
   * 每次渲染后都把变换重新贴回 <g> 上。
   * 不能只在 pose 变化时贴:SVG 是 dangerouslySetInnerHTML 注入的,
   * React 任何一次重写 innerHTML 都会把我们手写的 transform 属性抹掉
   * (曾经的表现:点一次放大,属性直接变成 null,图纸纹丝不动)。
   */
  useEffect(() => {
    hostRef.current
      ?.querySelector<SVGGElement>("[data-zoom-layer]")
      ?.setAttribute("transform", `translate(${pose.tx} ${pose.ty}) scale(${pose.k})`);
  });

  /** 屏幕坐标 → viewBox 用户坐标(未经 zoom layer 变换的那一层) */
  const toUser = useCallback((clientX: number, clientY: number) => {
    const svg = hostRef.current?.querySelector("svg");
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    return pt.matrixTransform(ctm.inverse());
  }, []);

  /** 以屏幕上某点为锚点缩放:该点下的图形内容保持不动 */
  const zoomAt = useCallback(
    (factor: number, clientX: number, clientY: number) => {
      const r = toUser(clientX, clientY);
      if (!r) return;
      const p = poseRef.current;
      const k = Math.min(MAX_SCALE, Math.max(MIN_SCALE, p.k * factor));
      const ratio = k / p.k;
      apply({ k, tx: r.x - (r.x - p.tx) * ratio, ty: r.y - (r.y - p.ty) * ratio });
    },
    [apply, toUser],
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // wheel 必须原生监听 + passive:false,否则 preventDefault 无效,页面会跟着滚
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
    };
    host.addEventListener("wheel", onWheel, { passive: false });
    return () => host.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchDist.current = Math.hypot(a.x - b.x, a.y - b.y);
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const next = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, next);

    // 指针捕获只在**真的开始拖动之后**才设置。
    // 在 pointerdown 就捕获会让浏览器不再派发 click/dblclick,
    // 结果是"双击复位"整个失效(实测:原生 dblclick 事件根本不触发)。
    if (!captured.current) {
      captured.current = true;
      setDragging(true);
      e.currentTarget.setPointerCapture?.(e.pointerId);
    }

    if (pointers.current.size >= 2 && pinchDist.current !== null) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist.current > 0) {
        zoomAt(dist / pinchDist.current, (a.x + b.x) / 2, (a.y + b.y) / 2);
      }
      pinchDist.current = dist;
      return;
    }

    // 平移量换算到用户单位:直接比较两点的用户坐标,免得自己算缩放比
    const from = toUser(prev.x, prev.y);
    const to = toUser(next.x, next.y);
    if (!from || !to) return;
    const p = poseRef.current;
    apply({ ...p, tx: p.tx + (to.x - from.x), ty: p.ty + (to.y - from.y) });
  }

  function endPointer(e: React.PointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchDist.current = null;
    if (pointers.current.size === 0) {
      captured.current = false;
      setDragging(false);
    }
  }

  function zoomFromButton(factor: number) {
    const rect = hostRef.current?.getBoundingClientRect();
    if (!rect) return;
    zoomAt(factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

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
        onDoubleClick={() => apply(IDENTITY)}
        role="group"
        aria-label={`${label}(可缩放拖动)`}
      >
        <div className="svg-viewport-inner" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
        <button className="btn sm" type="button" onClick={() => zoomFromButton(1.3)} aria-label={`放大 ${label}`}>
          放大 +
        </button>
        <button
          className="btn sm"
          type="button"
          onClick={() => zoomFromButton(1 / 1.3)}
          aria-label={`缩小 ${label}`}
        >
          缩小 −
        </button>
        <button className="btn sm" type="button" onClick={() => apply(IDENTITY)} aria-label={`适应窗口 ${label}`}>
          适应窗口
        </button>
        <span className="small muted" data-testid="zoom-level">
          {Math.round(pose.k * 100)}% · 滚轮缩放 / 拖动平移 / 双击复位
        </span>
      </div>
    </div>
  );
}
