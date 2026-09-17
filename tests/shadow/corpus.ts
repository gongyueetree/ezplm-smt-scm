/**
 * REF-0.8:把既有金样夹具固化为**可复用输入集**。
 *
 * 金样套件(tests/golden)用这些夹具做「跑生产管线 + 按 manifest 断言期望」;
 * 对拍(Golden Master)需要的是同一批夹具的**另一种用法** ——
 * 只当输入喂给新旧两套实现,逐字段比差异,不关心期望值。
 *
 * 把"有哪些输入"这件事抽到这里,两边共用同一份发现逻辑:
 * 将来加一个夹具目录,金样断言与对拍**同时**覆盖到,不会漏掉一边。
 *
 * 注意:这里只枚举**已进版本库的公共夹具**。
 * 乾创私有夹具(tests/fixtures/customer-private)不在此列 ——
 * 它由 QIANCHUANG_UAT_FIXTURE_DIR 单独驱动,且绝不进公共语料(R4 §4)。
 */
import { existsSync, readdirSync, statSync } from "fs";
import path from "path";
import { GOLDEN_ROOT } from "../golden/manifest";

export interface CorpusItem {
  /** 夹具家族目录名,如 standard / aliases-cn / edge-cases */
  family: string;
  /** 文件名 */
  name: string;
  /** 绝对路径 */
  file: string;
  ext: ".csv" | ".xlsx" | ".xls";
  bytes: number;
}

const PARSEABLE = new Set([".csv", ".xlsx", ".xls"]);

/**
 * 枚举 BOM 输入语料(按 family/name 排序,保证**确定性** ——
 * 对拍报告要可复现,输入顺序就不能随文件系统返回顺序变)。
 */
export function loadBomCorpus(root: string = path.join(GOLDEN_ROOT, "bom")): CorpusItem[] {
  if (!existsSync(root)) return [];
  const out: CorpusItem[] = [];

  for (const family of readdirSync(root).sort()) {
    const dir = path.join(root, family);
    if (!statSync(dir).isDirectory()) continue;
    for (const name of readdirSync(dir).sort()) {
      const ext = path.extname(name).toLowerCase();
      if (!PARSEABLE.has(ext)) continue; // manifest.json / README.md 不是输入
      const file = path.join(dir, name);
      out.push({
        family,
        name,
        file,
        ext: ext as CorpusItem["ext"],
        bytes: statSync(file).size,
      });
    }
  }
  return out;
}

/** 语料的稳定标签,用作对拍 label(进报告好聚合) */
export function corpusLabel(item: CorpusItem): string {
  return `bom:${item.family}/${item.name}`;
}
