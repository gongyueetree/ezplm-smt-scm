"use client";

import { useEffect, useRef, useState } from "react";

/**
 * STEP 3D 模型在线预览。
 *
 * 为什么是按钮触发:
 * - OCCT 的 WASM 内核约 7.6 MB,STEP 文件本身也常有 1–3 MB;
 *   随页面自动加载会让每次打开物料详情都付这个代价。
 * - 依赖全部**本站自发**(public/vendor/occt-import-js.wasm),不走任何 CDN。
 *
 * 失败一律显示真实原因并保留下载入口,不用"加载中"永久遮盖失败。
 */

type Phase = "idle" | "loading" | "ready" | "error";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function Model3D({ mpn, fileName }: { mpn: string; fileName: string | null }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string>("");
  const [meshCount, setMeshCount] = useState(0);
  const hostRef = useRef<HTMLDivElement>(null);
  const disposeRef = useRef<(() => void) | null>(null);

  useEffect(() => () => disposeRef.current?.(), []);

  async function load() {
    setPhase("loading");
    setMessage("正在加载 3D 内核与模型…");
    try {
      const [{ default: occtFactory }, THREE, { OrbitControls }] = await Promise.all([
        import("occt-import-js"),
        import("three"),
        import("three/examples/jsm/controls/OrbitControls.js"),
      ]);

      const occt = await occtFactory({
        locateFile: (file: string) => `${BASE_PATH}/vendor/${file}`,
      });

      const res = await fetch(
        `${BASE_PATH}/api/materials/${encodeURIComponent(mpn)}/library-file?kind=MODEL_3D`,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `拉取 STEP 文件失败(HTTP ${res.status})`);
      }
      const bytes = new Uint8Array(await res.arrayBuffer());

      const result = occt.ReadStepFile(bytes, null);
      if (!result.success || result.meshes.length === 0) {
        throw new Error("STEP 解析成功但没有可显示的网格");
      }

      const host = hostRef.current;
      if (!host) throw new Error("渲染容器不可用");
      host.innerHTML = "";

      const width = host.clientWidth || 480;
      const height = 380;
      const scene = new THREE.Scene();
      const group = new THREE.Group();

      for (const mesh of result.meshes) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
          "position",
          new THREE.Float32BufferAttribute(mesh.attributes.position.array, 3),
        );
        if (mesh.attributes.normal) {
          geometry.setAttribute(
            "normal",
            new THREE.Float32BufferAttribute(mesh.attributes.normal.array, 3),
          );
        } else {
          geometry.computeVertexNormals();
        }
        if (mesh.index) geometry.setIndex(mesh.index.array);
        const color = mesh.color
          ? new THREE.Color(mesh.color[0], mesh.color[1], mesh.color[2])
          : new THREE.Color(0x8a8f98);
        group.add(
          new THREE.Mesh(
            geometry,
            new THREE.MeshStandardMaterial({ color, metalness: 0.25, roughness: 0.6 }),
          ),
        );
      }

      // 居中并按包围盒定相机距离
      const box = new THREE.Box3().setFromObject(group);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3()).length() || 10;
      group.position.sub(center);
      scene.add(group);

      scene.add(new THREE.AmbientLight(0xffffff, 0.7));
      const dir = new THREE.DirectionalLight(0xffffff, 1.1);
      dir.position.set(1, 1.4, 1);
      scene.add(dir);

      const camera = new THREE.PerspectiveCamera(45, width / height, size / 500, size * 20);
      camera.position.set(size * 0.7, size * 0.6, size * 0.9);

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(width, height);
      host.appendChild(renderer.domElement);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;

      let raf = 0;
      const tick = () => {
        raf = requestAnimationFrame(tick);
        controls.update();
        renderer.render(scene, camera);
      };
      tick();

      const onResize = () => {
        const w = host.clientWidth || width;
        camera.aspect = w / height;
        camera.updateProjectionMatrix();
        renderer.setSize(w, height);
      };
      window.addEventListener("resize", onResize);

      disposeRef.current = () => {
        cancelAnimationFrame(raf);
        window.removeEventListener("resize", onResize);
        controls.dispose();
        renderer.dispose();
        host.innerHTML = "";
      };

      setMeshCount(result.meshes.length);
      setPhase("ready");
    } catch (e) {
      setPhase("error");
      setMessage(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        {phase === "idle" || phase === "error" ? (
          <button className="btn" onClick={load}>
            {phase === "error" ? "重试加载 3D 模型" : "加载 3D 模型"}
          </button>
        ) : null}
        <a
          className="btn sm"
          href={`${BASE_PATH}/api/materials/${encodeURIComponent(mpn)}/library-file?kind=MODEL_3D`}
          target="_blank"
          rel="noreferrer"
        >
          下载 STEP 源文件
        </a>
        <span className="small muted">
          {fileName ? `${fileName} · ` : ""}
          需下载约 7.6 MB 的 3D 内核(本站自发,不走 CDN)与 STEP 文件,故手动触发。
        </span>
      </div>

      {phase === "loading" ? (
        <p className="small muted" style={{ marginTop: 10 }}>
          {message}
        </p>
      ) : null}
      {phase === "error" ? (
        <p className="small" style={{ marginTop: 10, color: "var(--danger)" }}>
          3D 预览失败:{message}。可下载 STEP 源文件用 CAD 打开。
        </p>
      ) : null}
      {phase === "ready" ? (
        <p className="small muted" style={{ marginTop: 10 }}>
          已渲染 {meshCount} 个网格 · 左键旋转 / 滚轮缩放 / 右键平移。
        </p>
      ) : null}

      <div
        ref={hostRef}
        style={{
          marginTop: 10,
          borderRadius: 8,
          border: phase === "ready" ? "1px solid var(--gray-200)" : "none",
          background: phase === "ready" ? "var(--gray-50)" : "transparent",
          overflow: "hidden",
        }}
      />
    </div>
  );
}
