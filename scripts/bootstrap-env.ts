/**
 * 副作用模块:**在其它任何模块之前**把 .env.local 读进 process.env。
 *
 * 为什么单独一个文件:import 会被提升,`loadEnvLocal()` 写在 import 之后就晚了 ——
 * 像 lib/server/db.ts 这种在模块加载时就读 DATABASE_URL 的模块会直接抛错。
 * 把加载动作放进模块顶层,并在脚本里**第一行** import 它,顺序才有保证。
 */
import { loadEnvLocal } from "./load-env";

loadEnvLocal();
