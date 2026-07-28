/**
 * PDF → 带坐标的文本片段(服务端,pdfjs-dist legacy build)。
 *
 * 这里只负责"把文本层取出来",几何重建交给 lib/domain/pdf-table.ts(纯函数,可单测)。
 *
 * 关键区分:
 * - **有文本层**的 PDF(Excel/WPS/ERP 导出)→ 确定性解析,不涉及任何模型;
 * - **没有文本层**的 PDF(扫描件)→ 这里返回 hasTextLayer=false,
 *   由调用方决定是否走 OCR,并把结果标注为"识别草稿"。
 *   绝不把扫描件的空结果当成"这份 PDF 没有内容"。
 */
import type { PdfTextItem } from "@/lib/domain/pdf-table";

export interface PdfExtractResult {
  items: PdfTextItem[];
  pages: number;
  /** 是否取到了可用的文本层 */
  hasTextLayer: boolean;
}

/** 一份 PDF 至少要有这么多字符才算"有文本层";否则多半是扫描件里零星的水印文字 */
const MIN_TEXT_CHARS = 20;

export async function extractPdfTextItems(
  buffer: Buffer,
  maxPages = 50,
): Promise<PdfExtractResult> {
  // legacy build 才能在 Node 里跑(标准 build 依赖浏览器 API)
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    // 服务端没有字体/canvas 环境,关掉相关能力,只取文本
    disableFontFace: true,
    useSystemFonts: false,
  }).promise;

  const items: PdfTextItem[] = [];
  const pages = Math.min(doc.numPages, maxPages);

  try {
    for (let pageNo = 1; pageNo <= pages; pageNo++) {
      const page = await doc.getPage(pageNo);
      const content = await page.getTextContent();
      for (const raw of content.items) {
        const it = raw as {
          str?: string;
          transform?: number[];
          width?: number;
          height?: number;
        };
        if (typeof it.str !== "string" || it.str === "") continue;
        const t = it.transform ?? [1, 0, 0, 1, 0, 0];
        items.push({
          text: it.str,
          x: t[4],
          y: t[5],
          width: it.width ?? 0,
          // transform[3] 是纵向缩放,即实际字高;height 字段在部分文档里为 0
          height: it.height && it.height > 0 ? it.height : Math.abs(t[3]) || 10,
          page: pageNo,
        });
      }
      page.cleanup();
    }
  } finally {
    await doc.cleanup();
  }

  const chars = items.reduce((sum, i) => sum + i.text.trim().length, 0);
  return { items, pages: doc.numPages, hasTextLayer: chars >= MIN_TEXT_CHARS };
}
