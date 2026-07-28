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
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
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
