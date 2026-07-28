/**
 * 把 occt-import-js 的 WASM 复制到 public/vendor/。
 *
 * 为什么不直接从 node_modules 引:浏览器要能按 URL 取到 .wasm,
 * 而 CSP/离线部署都禁止走 CDN —— 必须由本站自己发。
 * 7.6MB 不进版本库,由 predev/prebuild 每次生成(Docker 构建同样会跑到)。
 */
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const src = path.join(path.dirname(require.resolve("occt-import-js")), "occt-import-js.wasm");
const destDir = path.join(process.cwd(), "public", "vendor");
const dest = path.join(destDir, "occt-import-js.wasm");

if (!existsSync(src)) {
  console.error(`[copy-occt] 未找到 ${src},3D 预览将不可用`);
  process.exit(1);
}
mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
console.log(`[copy-occt] ${path.relative(process.cwd(), dest)} 已就绪`);
