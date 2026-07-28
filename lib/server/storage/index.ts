import type { FileStorageProvider } from "./types";
import { LocalStorageProvider } from "./local";
import { VercelBlobStorageProvider } from "./vercel-blob";

let cached: FileStorageProvider | undefined;

/**
 * 按环境选择存储实现(业务代码不感知差异):
 * FILE_STORAGE_PROVIDER=local | vercel-blob;缺省 local。
 */
export function getStorageProvider(): FileStorageProvider {
  if (cached) return cached;
  const kind = process.env.FILE_STORAGE_PROVIDER ?? "local";
  switch (kind) {
    case "vercel-blob":
      cached = new VercelBlobStorageProvider();
      break;
    case "local":
      cached = new LocalStorageProvider();
      break;
    default:
      throw new Error(`未知 FILE_STORAGE_PROVIDER: ${kind}`);
  }
  return cached;
}

export type { FileStorageProvider, StoredFile, PutOptions } from "./types";
