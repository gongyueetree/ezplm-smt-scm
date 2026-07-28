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
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}
