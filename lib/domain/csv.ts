/**
 * CSV 解析(纯函数,无依赖)。
 * 支持:双引号包裹、字段内逗号与换行、"" 转义、CRLF/LF、UTF-8 BOM。
 * 不做类型推断 —— 一律返回字符串,数值转换由业务层按列语义处理。
 */

export function parseCsv(input: string, delimiter = ","): string[][] {
  const text = input.replace(/^﻿/, ""); // 去 BOM
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'; // "" → 字面量引号
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === delimiter) {
      pushField();
      i += 1;
      continue;
    }
    if (ch === "\r") {
      // CRLF 与孤立 CR 都视为换行
      pushRow();
      i += text[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    if (ch === "\n") {
      pushRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  // 末尾无换行时补最后一行;完全空输入不产生行
  if (field !== "" || row.length > 0) pushRow();

  // 丢弃完全空白的行(BOM 文件常见尾部空行)
  /*
   * F5 golden 套件抓出的缺陷:原实现把**所有**空行过滤掉。
   * 后果不只是少几行 —— 文件中段的空行(常见的分组分隔)消失后,
   * 后续所有行号整体前移,行去向账本里的「第 8 行」对应原文件第 9 行,
   * 「行号指得回原表」这条 E1a 承诺被悄悄破坏。
   *
   * 修法按 CSV 语义分两类:
   * - **中段空行是数据行**,保留(交给各消费方按空行处理,BOM 账本记 BLANK);
   * - **结尾的空行是行终止符的残留**(文件末尾的 \n 不构成新记录),丢弃 ——
   *   否则每个以换行结尾的文件都会凭空多一条 BLANK。
   */
  while (rows.length > 0 && rows[rows.length - 1].every((c) => c.trim() === "")) {
    rows.pop();
  }
  return rows;
}

/** 猜分隔符:比较首行中逗号/分号/制表符出现次数(引号外) */
export function detectDelimiter(sample: string): string {
  const firstLine = sample.split(/\r?\n/, 1)[0] ?? "";
  const counts: [string, number][] = [
    [",", 0],
    [";", 0],
    ["\t", 0],
  ];
  let inQuotes = false;
  for (const ch of firstLine) {
    if (ch === '"') inQuotes = !inQuotes;
    if (inQuotes) continue;
    const hit = counts.find(([d]) => d === ch);
    if (hit) hit[1] += 1;
  }
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}

/**
 * F7:CSV 序列化(导出用)。
 * 引号纪律:含分隔符/引号/换行的单元格整体加引号,内部引号翻倍 —— 与 parseCsv 互逆。
 */
export function toCsv(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const cell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [header, ...rows].map((r) => r.map(cell).join(",")).join("\n") + "\n";
}
