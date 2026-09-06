/**
 * F5:构建 golden 套件的 xlsx 夹具(公式 / 合并单元格 / 多工作表)。
 *
 * 这些形态没法用文本文件表达,只能生成二进制入库。
 * 内容完全确定(无时间戳、无随机),需要调整时改本脚本重跑:
 *   pnpm exec tsx scripts/build-golden-xlsx.ts
 */
import ExcelJS from "exceljs";
import path from "path";

const G = path.resolve(__dirname, "../tests/fixtures/golden/bom");

async function buildStandardEn() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("BOM");
  ws.addRow(["Ref", "Qty", "Manufacturer", "MPN", "Package", "Description"]);
  ws.addRow(["R1", 1, "Yageo", "GOLD-EN-0001", "0603", "RES 10K"]);
  // 公式行:Qty = 2+3,解析必须取计算结果 5
  const f = ws.addRow(["C1,C2,C3,C4,C5", null, "Murata", "GOLD-EN-0002", "0402", "CAP 100nF"]);
  f.getCell(2).value = { formula: "2+3", result: 5 } as ExcelJS.CellFormulaValue;
  ws.addRow(["U1", 1, "TI", "GOLD-EN-0003", "TQFP-48", "MCU"]);
  // 合并单元格:描述跨两行 —— 从属格读出为空,行仍须各自有去向
  ws.addRow(["U2", 1, "ADI", "GOLD-EN-0004", "SOIC-8", "OpAmp dual(描述与下一行合并)"]);
  ws.addRow(["U3", 1, "ADI", "GOLD-EN-0005", "SOIC-8", null]);
  ws.mergeCells("F5:F6");
  await wb.xlsx.writeFile(path.join(G, "standard/standard-en.xlsx"));
}

async function buildMultiSheetCover() {
  const wb = new ExcelJS.Workbook();
  const cover = wb.addWorksheet("封面");
  cover.addRow(["某某电子有限公司"]);
  cover.addRow(["BOM 交付包 · 仅供报价"]);
  cover.addRow(["联系人:采购部"]);
  const bom = wb.addWorksheet("BOM明细");
  bom.addRow(["位号", "用量", "制造商", "制造商料号", "封装", "描述"]);
  bom.addRow(["R1", 2, "Yageo", "GOLD-MS-0001", "0603", "RES 2.2K"]);
  bom.addRow(["C1", 1, "Murata", "GOLD-MS-0002", "0603", "CAP 1uF"]);
  bom.addRow(["U1", 1, "ST", "GOLD-MS-0003", "LQFP-64", "MCU"]);
  bom.addRow(["L1", 1, "TDK", "GOLD-MS-0004", "0805", "电感 10uH"]);
  await wb.xlsx.writeFile(path.join(G, "nonstandard/multi-sheet-cover.xlsx"));
}

Promise.all([buildStandardEn(), buildMultiSheetCover()]).then(() => console.log("golden xlsx built"));
