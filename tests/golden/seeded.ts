/**
 * F5:确定性合成生成器。
 *
 * 关键设计:生成器**边生成边记账** —— 每放一行就登记它按构造应属的去向,
 * 期望值由构造推导而来,而不是跑一遍解析后抄下来。
 * 这样"生成器说有 10500 行业务行"与"解析器说识别了多少"是**两个独立来源**,
 * 对得上才算数;抄快照的话两边永远相等,测不出任何东西。
 *
 * 固定种子(mulberry32):同一种子生成逐字节相同的文件,CI 与本地一致。
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface GeneratedBom {
  csv: string;
  /** 构造推导的期望账目(与解析结果独立的第二来源) */
  expected: {
    totalRows: number;
    recognized: number;
    nonBusiness: number;
    needsReview: number;
    withIssues: number;
  };
}

const HEADER = "位号,用量,制造商,制造商料号,封装,描述";

/**
 * 生成混合脏数据 BOM。
 *
 * 刻意**不生成**会触发续行合并的形态(位号数 < 数量):
 * 合并启发式的判定属 bom-parse 单测的职责;生成器保持每行去向
 * 在构造时即唯一确定,期望才推导得出来。
 *
 * @param rows 表头后的物理行数
 * @param opts.padBytes 每行附加的描述填充(拉体积用,0 = 不填充)
 */
export function generateBomCsv(
  rows: number,
  seed: number,
  opts: { padBytes?: number } = {},
): GeneratedBom {
  const rand = mulberry32(seed);
  const pad = opts.padBytes ? "膨".repeat(Math.ceil(opts.padBytes / 3)) : "";
  const lines: string[] = [HEADER];
  let recognized = 0;
  let nonBusiness = 0;
  let needsReview = 0;
  let withIssues = 0;

  for (let i = 1; i <= rows; i++) {
    const roll = rand();
    if (roll < 0.04) {
      lines.push(",,,,,"); // 空行
      nonBusiness++;
    } else if (roll < 0.07) {
      lines.push(HEADER); // 翻页重复表头
      nonBusiness++;
    } else if (roll < 0.1) {
      lines.push(`,,GEN-MFG-${i},,,`); // 无料号无位号 → 待人工
      needsReview++;
    } else if (roll < 0.13) {
      lines.push(`R${i},abc,GEN-MFG-${i},GEN-MPN-${i},0603,${pad}数量非法行`); // 识别但带 issue
      recognized++;
      withIssues++;
    } else {
      lines.push(`R${i},1,GEN-MFG-${i},GEN-MPN-${i},0603,${pad}描述${i}`);
      recognized++;
    }
  }

  return {
    csv: lines.join("\n"),
    expected: { totalRows: rows, recognized, nonBusiness, needsReview, withIssues },
  };
}
