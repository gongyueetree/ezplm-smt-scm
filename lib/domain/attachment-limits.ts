/**
 * 附件上传的大小与类型判定(纯函数)。
 *
 * E1b(客户 Q13:「gerber 无固定大小,**无法将 gerber 作为附件传入,出现死机情况**」)。
 *
 * 审计结论:旧实现里 `await req.formData()` 会**先把所有文件整个缓冲进内存**,
 * 之后才检查 20MB 上限 —— 传一个 200MB 的包,系统会先吃下 200MB
 * 再告诉你"超过 20MB"。容器内存有限,这一步足以打死进程或挂住请求。
 *
 * 所以第一件事是**在读 body 之前就按 Content-Length 拒掉**,
 * 第二件事是让能收的文件走流式,不在内存里驻留整份。
 */

/** 默认上限 100MB。Gerber 压缩包 20MB 是不够的 —— 客户原话「无固定大小」。 */
export const DEFAULT_ATTACHMENT_MAX_MB = 100;

/** 上限的绝对天花板:再大就该走线下交换,而不是让 Web 端硬扛 */
export const ATTACHMENT_MAX_MB_CEILING = 2048;

/**
 * 从环境变量读上限(MB)。**可配置**是客户明确要求的一条。
 * 非法值一律回落默认值,并且不静默 —— 调用方会把实际生效值显示在界面上。
 */
export function resolveMaxBytes(raw: string | undefined): {
  maxBytes: number;
  maxMb: number;
  usedDefault: boolean;
  reason: string | null;
} {
  const fallback = {
    maxBytes: DEFAULT_ATTACHMENT_MAX_MB * 1024 * 1024,
    maxMb: DEFAULT_ATTACHMENT_MAX_MB,
    usedDefault: true,
  };
  if (raw === undefined || raw.trim() === "") {
    return { ...fallback, reason: null };
  }
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || n <= 0) {
    return { ...fallback, reason: `ATTACHMENT_MAX_MB=${raw} 不是有效数字,已回落默认值` };
  }
  if (n > ATTACHMENT_MAX_MB_CEILING) {
    return { ...fallback, reason: `ATTACHMENT_MAX_MB=${raw} 超过上限 ${ATTACHMENT_MAX_MB_CEILING}MB,已回落默认值` };
  }
  return { maxBytes: Math.floor(n * 1024 * 1024), maxMb: n, usedDefault: false, reason: null };
}

export type SizeCheck =
  | { ok: true; bytes: number | null }
  | { ok: false; code: "too_large" | "unknown_length"; message: string };

/**
 * 读 body **之前**的大小校验。
 *
 * `Content-Length` 缺失时不放行 —— 分块传输的请求长度未知,
 * 放行等于把"能不能扛住"交给运气。客户端一律带长度,不是苛刻要求。
 */
export function checkContentLength(
  header: string | null,
  maxBytes: number,
  maxMb: number,
): SizeCheck {
  if (header === null || header.trim() === "") {
    return {
      ok: false,
      code: "unknown_length",
      message: "请求没有 Content-Length,无法在读取前判断大小 —— 为避免大文件把服务打挂,这里直接拒绝",
    };
  }
  const n = Number(header);
  if (!Number.isFinite(n) || n < 0) {
    return { ok: false, code: "unknown_length", message: `Content-Length 非法:${header}` };
  }
  if (n > maxBytes) {
    return {
      ok: false,
      code: "too_large",
      message:
        `文件 ${(n / 1024 / 1024).toFixed(1)}MB,超过当前上限 ${maxMb}MB。` +
        `上限可由部署方通过 ATTACHMENT_MAX_MB 调整;确实超大的 Gerber 包建议走线下交换,` +
        `并在 RFQ 里附一条说明。`,
    };
  }
  return { ok: true, bytes: n };
}

/**
 * Gerber 相关扩展名(客户点名的那些)。
 *
 * 用途只有一个:**给附件打上类型标签**,方便人在列表里认出来。
 * 认出扩展名**不代表系统会解析它** —— 这一点在界面上必须写清楚,
 * 否则用户会以为传上去就等于系统读懂了。
 */
const GERBER_EXTENSIONS = new Set([
  "gbr", "ger", "gtl", "gbl", "gts", "gbs", "gto", "gbo", "gko", "gml", "gm1",
  "drl", "txt", "xln", "nc", "tap", "gpi", "gbp", "gtp", "art", "pho",
]);

const ARCHIVE_EXTENSIONS = new Set(["zip", "rar", "7z", "tar", "gz"]);

export type AttachmentKindGuess = "GERBER" | "ARCHIVE" | "OTHER";

export function guessGerberKind(fileName: string): AttachmentKindGuess {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (GERBER_EXTENSIONS.has(ext)) return "GERBER";
  if (ARCHIVE_EXTENSIONS.has(ext)) return "ARCHIVE";
  return "OTHER";
}

/**
 * 上传后的处理状态。
 *
 * 客户要求:「如果超过解析能力,附件仍然保存成功,不要上传失败」。
 * 所以**保存**与**解析**是两件事,状态分开表达 ——
 * `UPLOADED_NOT_PARSED` 就是"存下来了,但我们没读它",
 * 这比假装解析成功诚实,也比上传失败有用。
 */
export type AttachmentProcessState = "UPLOADED_NOT_PARSED" | "PARSED" | "PARSE_FAILED";

export const PROCESS_STATE_LABEL: Record<AttachmentProcessState, string> = {
  UPLOADED_NOT_PARSED: "已保存 · 未解析",
  PARSED: "已解析",
  PARSE_FAILED: "已保存 · 解析失败",
};

/**
 * RFQ 阶段要不要解析这个附件。
 *
 * 结论是**不解析**:Gerber 在 RFQ 阶段首先是一份要留档的客户文件,
 * 上传成功不等于必须立刻解析。先把"存下来"这件事做稳,
 * 解析是后续可选步骤 —— 把两者绑在一起正是卡死的根源之一。
 */
export function shouldParseAtUpload(): boolean {
  return false;
}
