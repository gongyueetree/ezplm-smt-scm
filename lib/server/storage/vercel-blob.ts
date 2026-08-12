/**
 * Vercel Blob 存储实现。
 * 状态:代码就绪、待联调 —— 依赖 BLOB_READ_WRITE_TOKEN(Vercel 项目开通 Blob 后注入);
 * 无 token 时构造即抛出结构化错误,不伪造可用。
 */
import { del, head, put } from "@vercel/blob";
import type { FileStorageProvider, PutOptions, StoredFile } from "./types";

export class VercelBlobStorageProvider implements FileStorageProvider {
  readonly kind = "vercel-blob" as const;

  constructor() {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      throw new Error(
        "VercelBlobStorageProvider 不可用:BLOB_READ_WRITE_TOKEN 未配置(状态:待联调)。" +
          "开发/私有化环境请使用 FILE_STORAGE_PROVIDER=local。",
      );
    }
  }

  async put(fileName: string, body: Buffer | Uint8Array, opts: PutOptions): Promise<StoredFile> {
    const result = await put(`${opts.prefix}/${fileName}`, Buffer.from(body), {
      access: "public",
      contentType: opts.contentType,
      addRandomSuffix: true,
    });
    return {
      key: result.pathname,
      url: result.url,
      sizeBytes: body.byteLength,
      contentType: opts.contentType,
    };
  }

  /** Blob SDK 直接接受 ReadableStream,不必先落成 Buffer */
  async putStream(
    fileName: string,
    body: ReadableStream<Uint8Array>,
    opts: PutOptions & { contentLength?: number },
  ): Promise<StoredFile> {
    const result = await put(`${opts.prefix}/${fileName}`, body, {
      access: "public",
      contentType: opts.contentType,
      addRandomSuffix: true,
    });
    return {
      key: result.pathname,
      url: result.url,
      // 流式写入时长度以 Content-Length 为准;没有就记 0 并由调用方回填
      sizeBytes: opts.contentLength ?? 0,
      contentType: opts.contentType,
    };
  }

  async get(key: string): Promise<Buffer | null> {
    const meta = await head(key).catch(() => null);
    if (!meta) return null;
    const res = await fetch(meta.url);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    await del(key);
  }
}
