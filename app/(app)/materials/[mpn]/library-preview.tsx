import { Badge } from "@/components/ui/badge";
import { parseKicadFootprint, renderFootprintSvg } from "@/lib/domain/kicad-footprint";
import { parseKicadSymbol, renderSymbolSvg } from "@/lib/domain/kicad-symbol";
import type { PartDocument } from "@/lib/providers/ezplm/types";
import { fetchEzplmTextFile } from "@/lib/server/ezplm-file";

/**
 * 原理图符号与 PCB 封装的**在线渲染**(服务端把 KiCad 库文件解析成 SVG)。
 *
 * 为什么在服务端渲染:
 * - 解析逻辑是确定性纯函数,服务端渲染便于单测与缓存,也不给浏览器塞解析器;
 * - 库文件 URL 是外部 API 给的,统一过 fetchEzplmTextFile 的白名单关口(防 SSRF)。
 *
 * 渲染失败**如实报错**并保留下载入口,绝不给一张空图冒充"渲染成功"。
 */

async function renderOne(
  doc: PartDocument | undefined,
  kind: "symbol" | "footprint",
): Promise<{ svg: string; skipped: number } | { error: string }> {
  if (!doc?.url) return { error: "ezPLM 未提供该文件" };
  try {
    const text = await fetchEzplmTextFile(doc.url);
    if (kind === "symbol") {
      const parsed = parseKicadSymbol(text);
      return { svg: renderSymbolSvg(parsed), skipped: parsed.skipped };
    }
    const parsed = parseKicadFootprint(text);
    return { svg: renderFootprintSvg(parsed), skipped: parsed.skipped };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

function Pane({
  title,
  result,
  downloadUrl,
}: {
  title: string;
  result: Awaited<ReturnType<typeof renderOne>>;
  downloadUrl: string | null;
}) {
  return (
    <div style={{ flex: "1 1 320px", minWidth: 0 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          marginBottom: 6,
        }}
      >
        <b className="small">{title}</b>
        {downloadUrl ? (
          <a className="btn sm" href={downloadUrl} target="_blank" rel="noreferrer">
            下载源文件
          </a>
        ) : null}
      </div>
      <div
        style={{
          border: "1px solid var(--gray-200)",
          borderRadius: 8,
          padding: 10,
          background: "var(--gray-50)",
          minHeight: 160,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "auto",
        }}
      >
        {"error" in result ? (
          <span className="small muted" style={{ textAlign: "center" }}>
            无法在线渲染:{result.error}
            {downloadUrl ? <br /> : null}
            {downloadUrl ? "可下载源文件用 KiCad 打开。" : null}
          </span>
        ) : (
          <div style={{ width: "100%" }} dangerouslySetInnerHTML={{ __html: result.svg }} />
        )}
      </div>
      {!("error" in result) && result.skipped > 0 ? (
        <p className="small muted" style={{ marginTop: 4 }}>
          有 {result.skipped} 个图元未能识别,未参与渲染(下载源文件可看到完整内容)。
        </p>
      ) : null}
    </div>
  );
}

export async function LibraryPreview({ documents }: { documents: PartDocument[] }) {
  const symbolDoc = documents.find((d) => d.kind === "SYMBOL");
  const footprintDoc = documents.find((d) => d.kind === "FOOTPRINT");

  const [symbol, footprint] = await Promise.all([
    renderOne(symbolDoc, "symbol"),
    renderOne(footprintDoc, "footprint"),
  ]);

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <Pane title="原理图符号(.kicad_sym)" result={symbol} downloadUrl={symbolDoc?.url ?? null} />
        <Pane title="PCB 封装(.kicad_mod)" result={footprint} downloadUrl={footprintDoc?.url ?? null} />
      </div>
      <p className="small muted" style={{ marginTop: 10 }}>
        <Badge tone="gray">示意渲染</Badge> 由本系统解析 KiCad 库文件后绘制,
        用于快速确认引脚与封装形态;字体、隐藏属性等细节<b>与 KiCad 中的显示可能存在差异</b>,
        以源文件为准。
      </p>
    </div>
  );
}

export function LibraryPreviewFallback() {
  return (
    <p className="small muted" style={{ padding: 16 }}>
      正在从 ezPLM 拉取并渲染库文件…
    </p>
  );
}
