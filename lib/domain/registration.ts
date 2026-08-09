/**
 * 自助注册的准入规则(纯函数)。
 *
 * 为什么单独一层:注册是**唯一**一个未登录就能写库的入口,
 * 判定逻辑埋在路由里既测不到也容易被后来的改动绕过。
 *
 * 纪律:
 * - 邮箱统一小写去空白后再比对 —— 否则 `PM@x.cn` 能绕过唯一约束
 *   注册出第二个"同一个人",登录时 findFirst 命中哪个全看运气;
 * - **SUPPLIER 必须绑定供应商**。schema 的注释写得很清楚:没有归属就
 *   无法判断"与自身相关",追溯查询一律拒绝。让人注册一个空归属的
 *   供应商账号,他登录后看到的是一个处处被拒的系统,只会以为系统坏了;
 * - 口令规则与重设脚本保持一致(至少 8 位),并**明确拒绝演示口令** ——
 *   注册一个口令是 demo1234 的账号等于没设口令。
 */

export const REGISTRABLE_ROLES = [
  "PM",
  "PROCUREMENT",
  "ENGINEERING",
  "MANAGEMENT",
  "SUPPLIER",
] as const;

export type RegistrableRole = (typeof REGISTRABLE_ROLES)[number];

export const ROLE_LABEL: Record<RegistrableRole, string> = {
  PM: "PM 经理",
  PROCUREMENT: "采购",
  ENGINEERING: "工程",
  MANAGEMENT: "管理层",
  SUPPLIER: "供应商",
};

/** 明令禁止的口令 —— 与演示口令相同等于没设口令 */
const FORBIDDEN_PASSWORDS = new Set(["demo1234", "12345678", "password", "qianchuang"]);

export const MIN_PASSWORD_LENGTH = 8;

export interface RegistrationInput {
  email: string;
  name: string;
  password: string;
  role: string;
  /** 选 SUPPLIER 时必填 */
  supplierId?: string | null;
}

export type RegistrationCheck =
  | {
      ok: true;
      /** 规范化后的值 —— 落库必须用这份,不能用原始输入 */
      value: {
        email: string;
        name: string;
        password: string;
        role: RegistrableRole;
        supplierId: string | null;
      };
    }
  | { ok: false; field: string; message: string };

/** 邮箱规范化:去首尾空白 + 全小写。**比对与落库都用这一份** */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function checkRegistration(input: RegistrationInput): RegistrationCheck {
  const email = normalizeEmail(input.email ?? "");
  // 不自己造正则做完整 RFC 校验 —— 只挡明显不是邮箱的输入,真伪由能否收信决定
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, field: "email", message: "请输入合法的邮箱地址" };
  }
  if (email.length > 200) {
    return { ok: false, field: "email", message: "邮箱过长(上限 200 字符)" };
  }

  const name = (input.name ?? "").trim();
  if (name.length < 2) {
    return { ok: false, field: "name", message: "请填写姓名(至少 2 个字)" };
  }
  if (name.length > 50) {
    return { ok: false, field: "name", message: "姓名过长(上限 50 字符)" };
  }

  const password = input.password ?? "";
  if (password.length < MIN_PASSWORD_LENGTH) {
    // 说清差多少,不要只说"太短"——重设脚本上踩过这个坑
    return {
      ok: false,
      field: "password",
      message: `口令至少 ${MIN_PASSWORD_LENGTH} 位(当前 ${password.length} 位)`,
    };
  }
  if (password.length > 200) {
    return { ok: false, field: "password", message: "口令过长(上限 200 字符)" };
  }
  if (FORBIDDEN_PASSWORDS.has(password.toLowerCase())) {
    return {
      ok: false,
      field: "password",
      message: "这个口令太常见(演示口令/弱口令),请换一个 —— 你的账号别人也能猜到",
    };
  }

  const role = input.role as RegistrableRole;
  if (!REGISTRABLE_ROLES.includes(role)) {
    return { ok: false, field: "role", message: "请选择一个角色" };
  }

  const supplierId = input.supplierId?.trim() || null;
  if (role === "SUPPLIER" && !supplierId) {
    return {
      ok: false,
      field: "supplierId",
      message:
        "供应商账号必须指定所属供应商 —— 没有归属就无法判断哪些数据与你相关,登录后会处处被拒",
    };
  }
  // 非供应商角色带 supplierId 没有意义,直接丢弃而不是存下来误导后续判定
  return {
    ok: true,
    value: { email, name, password, role, supplierId: role === "SUPPLIER" ? supplierId : null },
  };
}

/**
 * 自助注册是否开启。
 *
 * **默认关闭**。这是给公网部署的安全默认值:开着就意味着任何拿到网址的人
 * 都能建号并看到租户里的数据。演示环境显式设 `ALLOW_SELF_REGISTRATION=true`
 * 打开,测试结束改回或删掉即可。
 */
export function isRegistrationEnabled(env: Record<string, string | undefined>): boolean {
  return env.ALLOW_SELF_REGISTRATION === "true";
}
