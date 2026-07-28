import type { NextConfig } from "next";

/**
 * basePath 可配置(融合钉子:将来可挂 ezPLM 域名子路径反代,如 /scm)。
 * 为空时部署在根路径;设置时必须以 / 开头,如 NEXT_PUBLIC_BASE_PATH=/scm。
 * 静态资源由 Next.js 基于 basePath 相对引用,不写死绝对 URL。
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // pdfjs-dist 的 legacy build 依赖运行时路径解析,被 Next 打包后会取不到
  // 标准字体/CMap 而整个失效(表现:所有 PDF 都被误判成"没有文本层")。
  serverExternalPackages: ["pdfjs-dist"],
  ...(basePath ? { basePath } : {}),
  // Docker 交付时设 BUILD_STANDALONE=1 产出 standalone 服务(一套代码两种交付)
  ...(process.env.BUILD_STANDALONE === "1" ? { output: "standalone" as const } : {}),
};

export default nextConfig;
