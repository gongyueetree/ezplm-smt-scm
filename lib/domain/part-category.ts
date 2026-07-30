/**
 * 物料分类两级(客户 docx:「仅一级大类(电阻/电容/IC),无二级细分(IC:MCU/USB/电源IC)」)。
 *
 * 分类由**本地人工维护**;ezPLM 的 category 字符串只作为**建议来源**。
 *
 * 纪律:
 * - 建议一律走**明确映射表**,不做模糊猜测 —— 与外部字段解析同一条纪律
 *   (`lib/providers/common/parse.ts` 的教训:裸 includes 会把否定式判成肯定式);
 * - 映射不到就返回 null,让人来填。**猜错的分类比空分类更糟**:
 *   分类会被用于分组统计与替代料筛选,错的会一路带偏;
 * - 一级大类是**封闭集合**(便于统计),二级细分开放(各家叫法差异大)。
 */

/** 一级大类:封闭集合 */
export const CATEGORY_L1 = [
  "IC",
  "分立器件",
  "阻容感",
  "连接器",
  "机电",
  "模块",
  "结构件",
  "其它",
] as const;

export type CategoryL1 = (typeof CATEGORY_L1)[number];

export function isCategoryL1(v: string): v is CategoryL1 {
  return (CATEGORY_L1 as readonly string[]).includes(v);
}

/**
 * ezPLM / 分销商分类字符串 → 两级分类的**精确映射表**。
 * 键为规范化后的整串或整段,不做子串模糊匹配。
 */
const EXACT: Record<string, { l1: CategoryL1; l2: string }> = {
  微控制器: { l1: "IC", l2: "MCU" },
  MCU: { l1: "IC", l2: "MCU" },
  单片机: { l1: "IC", l2: "MCU" },
  微处理器: { l1: "IC", l2: "MPU" },
  存储器: { l1: "IC", l2: "存储器" },
  FLASH: { l1: "IC", l2: "存储器" },
  EEPROM: { l1: "IC", l2: "存储器" },
  运算放大器: { l1: "IC", l2: "模拟-放大器" },
  比较器: { l1: "IC", l2: "模拟-比较器" },
  稳压器: { l1: "IC", l2: "电源-稳压器" },
  LDO: { l1: "IC", l2: "电源-LDO" },
  DCDC: { l1: "IC", l2: "电源-DCDC" },
  电源管理: { l1: "IC", l2: "电源管理" },
  接口: { l1: "IC", l2: "接口" },
  USB接口: { l1: "IC", l2: "接口-USB" },
  收发器: { l1: "IC", l2: "接口-收发器" },
  逻辑: { l1: "IC", l2: "逻辑" },
  时钟: { l1: "IC", l2: "时钟" },
  传感器: { l1: "IC", l2: "传感器" },
  二极管: { l1: "分立器件", l2: "二极管" },
  三极管: { l1: "分立器件", l2: "三极管" },
  MOSFET: { l1: "分立器件", l2: "MOSFET" },
  晶体管: { l1: "分立器件", l2: "晶体管" },
  电阻: { l1: "阻容感", l2: "电阻" },
  电容: { l1: "阻容感", l2: "电容" },
  电感: { l1: "阻容感", l2: "电感" },
  磁珠: { l1: "阻容感", l2: "磁珠" },
  晶振: { l1: "机电", l2: "晶振" },
  连接器: { l1: "连接器", l2: "通用" },
  排针: { l1: "连接器", l2: "排针排母" },
  继电器: { l1: "机电", l2: "继电器" },
  开关: { l1: "机电", l2: "开关" },
  蜂鸣器: { l1: "机电", l2: "蜂鸣器" },
};

/** 规范化:去空白、全角转半角、去括号内说明、大写 */
function normalize(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/[((].*?[))]/g, "")
    .replace(/[\s\-_/]/g, "")
    .toUpperCase();
}

export interface CategorySuggestion {
  l1: CategoryL1 | null;
  l2: string | null;
  /** 命中的映射键;未命中时为 null */
  matchedKey: string | null;
  reason: string;
}

/**
 * 从外部分类字符串**建议**两级分类。
 * 映射不到一律返回 null —— 不猜,交给人填。
 */
export function suggestCategory(raw: string | null | undefined): CategorySuggestion {
  if (!raw || !raw.trim()) {
    return { l1: null, l2: null, matchedKey: null, reason: "外部未提供分类,需人工填写" };
  }
  const n = normalize(raw);

  // 整串精确命中
  for (const [key, val] of Object.entries(EXACT)) {
    if (normalize(key) === n) {
      return { l1: val.l1, l2: val.l2, matchedKey: key, reason: `精确命中映射「${key}」` };
    }
  }

  // 分段命中:ezPLM 的分类常写成「微控制器（MCU）- 32位」这类,按分隔符切段后逐段精确比
  const segments = raw
    .normalize("NFKC")
    .split(/[-—–>/、,,]|\s+/)
    .map((x) => normalize(x))
    .filter(Boolean);
  for (const seg of segments) {
    for (const [key, val] of Object.entries(EXACT)) {
      if (normalize(key) === seg) {
        return { l1: val.l1, l2: val.l2, matchedKey: key, reason: `分段命中映射「${key}」` };
      }
    }
  }

  return {
    l1: null,
    l2: null,
    matchedKey: null,
    reason: `分类「${raw.trim()}」不在映射表中 —— 不做模糊猜测,请人工填写`,
  };
}
