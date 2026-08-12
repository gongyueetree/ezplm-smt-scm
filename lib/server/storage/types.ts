/** 文件存储抽象(SPEC §15):业务代码只依赖本接口,不感知 Vercel Blob / 本地差异 */

export interface StoredFile {
  /** 存储键(落库到各表的 fileKey 字段) */
  key: string;
  /** 可访问 URL(本地实现为应用内下载路由;Blob 为其返回 URL) */
  url: string;
  sizeBytes: number;
  contentType: string;
}

export interface PutOptions {
  contentType: string;
  /** 逻辑目录(如 rfq-attachments/<tenantId>) */
  prefix: string;
}

export interface FileStorageProvider {
  readonly kind: "local" | "vercel-blob";
  put(fileName: string, body: Buffer | Uint8Array, opts: PutOptions): Promise<StoredFile>;
  /**
   * E1b:**流式写入**,不把整个文件读进内存。
   *
   * Gerber 压缩包没有固定大小,几十上百 MB 很常见。走 `put()` 的话
   * 一个 200MB 的包会在 Node 进程里完整驻留一份 —— 容器内存有限,
   * 表现就是客户说的"死机"。
   */
  putStream(
    fileName: string,
    body: ReadableStream<Uint8Array>,
    opts: PutOptions & { contentLength?: number },
  ): Promise<StoredFile>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}
