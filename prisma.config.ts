import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * Prisma 7 配置:连接串从环境变量读取(schema 文件不再含 url)。
 * DATABASE_URL 仅存服务端环境变量(CLAUDE.md 硬性约束 5);本地开发见 .env(.env.example 模板)。
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.DATABASE_URL ?? "postgresql://postgres@localhost:5433/ezplm_scm_dev",
  },
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
});
