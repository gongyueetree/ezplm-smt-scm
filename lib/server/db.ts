/**
 * PrismaClient 单例(Prisma 7 + node-postgres 适配;连接串仅存服务端 env)。
 *
 * **懒构造**:import 本模块不得触发任何连接串校验。
 * Next 构建期(collect page data)会 import 每一个路由模块 —— 在模块顶层构造客户端,
 * 会让"构建环境没有 DATABASE_URL"这件事直接炸掉整个 build
 * (实测 Railway:`Failed to collect page data for /api/...`)。
 * 构建期本就不该连库(镜像里迁移在容器启动时才跑),所以缺连接串必须**延迟到真正用库时**才报错。
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL 未配置(仅存服务端环境变量)");
  const created = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  // 开发下热重载会重复求值本模块,挂到 global 上避免连接数爆掉
  if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = created;
  return created;
}

/**
 * 单例缓存必须在**模块作用域**,不能只依赖 globalForPrisma ——
 * 后者只在非 production 下写入(给开发热重载用)。若只查 global,
 * 生产下每访问一次属性就新建一个客户端与一个 pg 连接池,连接数迅速打满
 * (实测:E2E 全量跑从 1.2 分钟劣化到 4.9 分钟并大面积超时)。
 */
let instance: PrismaClient | undefined;

function client(): PrismaClient {
  instance ??= globalForPrisma.prisma ?? createClient();
  return instance;
}

/**
 * 用法与真实客户端完全一致(`prisma.part.findMany(...)`、`prisma.$transaction(...)`);
 * 差别只在于:第一次**访问属性**时才构造,而不是 import 时。
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const c = client();
    const value = Reflect.get(c, prop, c);
    // 方法必须绑回真实客户端:代理目标是空对象,不绑会丢 this
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(c) : value;
  },
  has(_target, prop) {
    return prop in client();
  },
  set(_target, prop, value) {
    return Reflect.set(client(), prop, value);
  },
});
