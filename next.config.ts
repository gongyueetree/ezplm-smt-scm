import type { NextConfig } from "next";

/**
 * basePath 可配置(融合钉子:将来可挂 ezPLM 域名子路径反代,如 /scm)。
 * 为空时部署在根路径;设置时必须以 / 开头,如 NEXT_PUBLIC_BASE_PATH=/scm。
 * 静态资源由 Next.js 基于 basePath 相对引用,不写死绝对 URL。
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  ...(basePath ? { basePath } : {}),
  // Docker 交付时设 BUILD_STANDALONE=1 产出 standalone 服务(一套代码两种交付)
  ...(process.env.BUILD_STANDALONE === "1" ? { output: "standalone" as const } : {}),
};

export default nextConfig;
