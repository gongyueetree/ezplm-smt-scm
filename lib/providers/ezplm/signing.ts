/**
 * ezPLM API Key 请求签名(依据《API 密钥查询接口用户操作手册》)。
 *
 * 签名串 = [METHOD, path, 排序后的 query, X-Timestamp, X-Nonce].join("\n")
 * 签名值 = HMAC-SHA256(apiKey, 签名串) 的 base64url
 *
 * 纪律:
 * - X-Nonce **一次性**(防重放),每次请求必须新生成;
 * - apiKey 只作为 HMAC 密钥与 X-API-Key 头使用,**绝不进入日志或错误消息**;
 * - query 规范化规则必须与服务端一致(先按 key 再按 value 排序,再 URL 编码)。
 */
import crypto from "node:crypto";

export type QueryParams = Record<string, string | number | undefined | null>;

/** 规范化 query:过滤空值 → 按 key 再按 value 排序 → URL 编码 → & 连接 */
export function canonicalQuery(params: QueryParams): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && String(v) !== "")
    .map(([k, v]) => [String(k), String(v)] as [string, string])
    .sort(([lk, lv], [rk, rv]) => (lk === rk ? lv.localeCompare(rv) : lk.localeCompare(rk)))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

export interface SignInput {
  method: string;
  /** 不含 query 的路径,如 /api/v1/api-key/parts */
  path: string;
  params: QueryParams;
  /** Unix 秒 */
  timestamp: string;
  nonce: string;
}

/** 构造待签名串(单独导出便于单测比对) */
export function buildCanonicalString(input: SignInput): string {
  return [
    input.method.toUpperCase(),
    input.path,
    canonicalQuery(input.params),
    input.timestamp,
    input.nonce,
  ].join("\n");
}

export function signRequest(apiKey: string, input: SignInput): string {
  return crypto
    .createHmac("sha256", apiKey)
    .update(buildCanonicalString(input))
    .digest("base64url");
}

export interface SignedHeaders {
  "X-API-Key": string;
  "X-Timestamp": string;
  "X-Nonce": string;
  "X-Signature": string;
}

/** 生成一次性签名头;nowMs/nonce 可注入以便确定性测试 */
export function buildSignedHeaders(
  apiKey: string,
  input: Omit<SignInput, "timestamp" | "nonce">,
  options: { nowMs?: number; nonce?: string } = {},
): SignedHeaders {
  const timestamp = Math.floor((options.nowMs ?? Date.now()) / 1000).toString();
  const nonce = options.nonce ?? crypto.randomUUID();
  return {
    "X-API-Key": apiKey,
    "X-Timestamp": timestamp,
    "X-Nonce": nonce,
    "X-Signature": signRequest(apiKey, { ...input, timestamp, nonce }),
  };
}

/** 本地或内网地址:私有化部署常见,允许 http */
function isPrivateHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname.endsWith(".local")) return true;
  if (/^127\./.test(hostname) || hostname === "::1") return true;
  if (/^10\./.test(hostname)) return true;
  if (/^192\.168\./.test(hostname)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true;
  return false;
}

/**
 * 规范化配置的 Base URL。
 * 手册中的接口路径是绝对路径(/api/v1/api-key/...),且**签名覆盖 path**,
 * 因此这里只取 origin;配置里误带的路径尾巴(如 /api/v1/api-)会被忽略。
 *
 * https 策略:**公网主机**上用 http 会让 API Key 明文过网,故强制升级;
 * localhost / 内网地址(私有化部署常见形态)保留 http,仅给出提示 ——
 * 一刀切升级会打断合法的内网部署。
 */
export function normalizeEzplmOrigin(configured: string): {
  origin: string;
  warnings: string[];
} {
  const warnings: string[] = [];
  const url = new URL(configured);
  if (url.protocol === "http:") {
    if (isPrivateHost(url.hostname)) {
      warnings.push(
        `EZPLM_API_BASE_URL 使用 http(${url.hostname} 为本地/内网地址,已保留);公网部署请改用 https`,
      );
    } else {
      warnings.push("EZPLM_API_BASE_URL 使用 http,已强制升级为 https(公网传输不得明文携带 API Key)");
      url.protocol = "https:";
    }
  }
  const path = url.pathname.replace(/\/+$/, "");
  if (path && path !== "") {
    warnings.push(
      `EZPLM_API_BASE_URL 中的路径「${path}」已忽略:接口路径由系统按手册固定为 /api/v1/api-key/*,只需配置到域名即可`,
    );
  }
  return { origin: url.origin, warnings };
}
