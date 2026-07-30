import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Prisma 客户端必须**懒构造**。
 *
 * 踩过的坑(2026-07-29,Railway 首次构建):客户端在模块顶层构造,
 * Next 构建期 collect page data 会 import 每一个路由模块,于是
 * "构建环境没有 DATABASE_URL" 直接炸掉整个 build:
 *   Failed to collect page data for /api/auth/logout
 * 构建期本就不该连库(容器启动时才跑迁移),缺连接串必须延迟到真正用库时才报错。
 */
const g = globalThis as unknown as { prisma?: unknown };

describe("prisma:懒构造", () => {
  let saved: string | undefined;
  let savedNodeEnv: string | undefined;

  beforeEach(() => {
    saved = process.env.DATABASE_URL;
    savedNodeEnv = process.env.NODE_ENV;
    delete g.prisma;
    vi.resetModules();
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved;
    const env = process.env as Record<string, string | undefined>;
    if (savedNodeEnv === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = savedNodeEnv;
    delete g.prisma;
    vi.resetModules();
  });

  it("**无 DATABASE_URL 时 import 不得抛错** —— 否则构建期一 import 路由就炸", async () => {
    delete process.env.DATABASE_URL;
    const mod = await import("@/lib/server/db");
    expect(mod.prisma).toBeDefined();
  });

  it("延迟到真正用库时才报错,且错误信息不含连接串内容", async () => {
    delete process.env.DATABASE_URL;
    const { prisma } = await import("@/lib/server/db");
    expect(() => prisma.part).toThrow(/DATABASE_URL 未配置/);
  });

  it("配了连接串后,模型委托与 $transaction 照常可取", async () => {
    process.env.DATABASE_URL = "postgresql://postgres@localhost:5433/ezplm_scm_dev";
    const { prisma } = await import("@/lib/server/db");
    expect(prisma.part).toBeDefined();
    expect(typeof prisma.$transaction).toBe("function");
  });

  it("**生产下也必须是单例** —— 只查 globalThis 会让每次属性访问都新建客户端与连接池,连接数迅速打满", async () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.DATABASE_URL = "postgresql://postgres@localhost:5433/ezplm_scm_dev";
    const { prisma } = await import("@/lib/server/db");
    // 模型委托由客户端实例自身缓存:同一实例取两次是同一个对象,新建实例则不是
    expect(prisma.part).toBe(prisma.part);
    // 生产下不往 globalThis 挂(那是给开发热重载用的),单例靠模块作用域缓存
    expect(g.prisma).toBeUndefined();
  });
});
