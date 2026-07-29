/**
 * 供冒烟脚本使用的 .env.local 加载器。
 *
 * **为什么不让使用者在 shell 里 `. ./.env.local`**:
 * zsh/bash 遇到 `KEY= value`(= 后多一个空格)会把值当成命令执行,
 * 于是 Key 原文出现在 `command not found: <Key>` 里 ——
 * 直接泄进终端历史、CI 日志和任何抓屏。这个坑实测踩过一次,不能再有第二次。
 *
 * 因此:脚本自己解析文件,并兼容 `= 空格`、引号包裹等常见手滑写法。
 */
import fs from "node:fs";
import path from "node:path";

export function loadEnvLocal(fileName = ".env.local"): void {
  const file = path.join(process.cwd(), fileName);
  if (!fs.existsSync(file)) return;
  for (const rawLine of fs.readFileSync(file, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    // 已存在的环境变量优先(CI 注入的 secret 不该被文件覆盖)
    if (process.env[key] !== undefined) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
