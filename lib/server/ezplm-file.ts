/**
 * 拉取 ezPLM 返回的库文件(.kicad_sym / .kicad_mod / .step / .pdf)。
 *
 * 安全纪律(**这是防 SSRF 的关口,改动前先想清楚**):
 * - URL 来自外部 API 响应,属于**不可信输入**,绝不能直接丢给 fetch;
 * - 只允许 https,且 host 必须命中白名单(默认 *.ezplm.com / *.ezplm.cn);
 * - 禁止跟随跳转(redirect: "error"),否则白名单可被 302 绕过;
 * - 限制响应大小与超时,避免一个超大文件拖垮服务端。
 */

const DEFAULT_HOST_SUFFIXES = [".ezplm.com", ".ezplm.cn"];

function allowedSuffixes(): string[] {
  const configured = process.env.EZPLM_FILE_HOST_SUFFIXES;
  if (!configured) return DEFAULT_HOST_SUFFIXES;
  const list = configured
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .map((s) => (s.startsWith(".") ? s : `.${s}`));
  return list.length > 0 ? list : DEFAULT_HOST_SUFFIXES;
}

export class EzplmFileError extends Error {
  constructor(
    message: string,
    readonly kind: "blocked" | "http" | "too_large" | "timeout" | "network",
  ) {
    super(message);
    this.name = "EzplmFileError";
  }
}

/** 校验 URL 是否允许拉取;不允许时给出**不含 token 的**原因 */
export function assertAllowedFileUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new EzplmFileError("文件地址不是合法 URL", "blocked");
  }
  if (url.protocol !== "https:") {
    throw new EzplmFileError(`只允许 https 拉取库文件,实际为 ${url.protocol}`, "blocked");
  }
  const host = url.hostname.toLowerCase();
  const ok = allowedSuffixes().some((suffix) => host === suffix.slice(1) || host.endsWith(suffix));
  if (!ok) {
    throw new EzplmFileError(`文件主机 ${host} 不在允许清单内,已拒绝拉取`, "blocked");
  }
  return url;
}

export interface FetchFileOptions {
  /** 最大字节数,超过即中止 */
  maxBytes?: number;
  timeoutMs?: number;
}

export async function fetchEzplmFile(
  raw: string,
  options: FetchFileOptions = {},
): Promise<ArrayBuffer> {
  const url = assertAllowedFileUrl(raw);
  const maxBytes = options.maxBytes ?? 4 * 1024 * 1024;
  const timeoutMs = options.timeoutMs ?? 10_000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: "error" });
    if (!res.ok) {
      throw new EzplmFileError(`拉取库文件失败:HTTP ${res.status}`, "http");
    }
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > maxBytes) {
      throw new EzplmFileError(
        `库文件 ${Math.round(declared / 1024)} KB 超过 ${Math.round(maxBytes / 1024)} KB 上限,未拉取`,
        "too_large",
      );
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength > maxBytes) {
      throw new EzplmFileError(
        `库文件 ${Math.round(buf.byteLength / 1024)} KB 超过上限,已丢弃`,
        "too_large",
      );
    }
    return buf;
  } catch (e) {
    if (e instanceof EzplmFileError) throw e;
    if (e instanceof Error && e.name === "AbortError") {
      throw new EzplmFileError(`拉取库文件超时(${timeoutMs}ms)`, "timeout");
    }
    throw new EzplmFileError(
      `拉取库文件出错:${e instanceof Error ? e.message : String(e)}`,
      "network",
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchEzplmTextFile(raw: string, options: FetchFileOptions = {}): Promise<string> {
  const buf = await fetchEzplmFile(raw, { maxBytes: 2 * 1024 * 1024, ...options });
  return new TextDecoder("utf-8").decode(buf);
}
