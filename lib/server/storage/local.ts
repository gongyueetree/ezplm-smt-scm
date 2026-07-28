/** 本地文件存储(开发/测试/Docker 私有化部署可用)。根目录 FILE_STORAGE_DIR,默认 .storage/ */
import { createHash, randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import type { FileStorageProvider, PutOptions, StoredFile } from "./types";

function storageRoot(): string {
  return path.resolve(process.cwd(), process.env.FILE_STORAGE_DIR ?? ".storage");
}

/** key 只允许 [a-zA-Z0-9/_.-],且解析后必须位于存储根目录内(防路径穿越) */
function resolveSafe(key: string): string {
  if (!/^[a-zA-Z0-9/_.-]+$/.test(key) || key.includes("..")) {
    throw new Error(`非法存储键: ${key}`);
  }
  const abs = path.resolve(storageRoot(), key);
  if (!abs.startsWith(storageRoot() + path.sep)) throw new Error(`非法存储键: ${key}`);
  return abs;
}

export class LocalStorageProvider implements FileStorageProvider {
  readonly kind = "local" as const;

  async put(fileName: string, body: Buffer | Uint8Array, opts: PutOptions): Promise<StoredFile> {
    const ext = path.extname(fileName).slice(0, 12).replace(/[^a-zA-Z0-9.]/g, "");
    const hash = createHash("sha256").update(body).digest("hex").slice(0, 8);
    const key = `${opts.prefix}/${randomUUID()}-${hash}${ext}`;
    const abs = resolveSafe(key);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, body);
    return {
      key,
      // 应用内下载路由随附件功能 PR(PR5)提供;此 URL 形态先行约定
      url: `/api/files/${key}`,
      sizeBytes: body.byteLength,
      contentType: opts.contentType,
    };
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(resolveSafe(key));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await fs.unlink(resolveSafe(key));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
}
