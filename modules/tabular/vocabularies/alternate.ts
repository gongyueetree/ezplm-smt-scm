/**
 * 列词表:替代料批量导入(`lib/domain/alternate-bulk.ts`)。
 * REF-2b 从解析器原样迁出为数据,别名与顺序未改(等价性见 tests/unit/column-vocabulary.test.ts)。
 */
import type { ColumnVocabulary } from "../domain/column-mapping";

export const ALTERNATE_VOCABULARY = {
  id: "alternate",
  aliases: {
    basePn: ["基准内部料号", "基准料号", "内部料号", "baseinternalpn", "basepn", "主料号"],
    baseMfg: ["基准制造商", "基准厂商", "basemfg", "basemanufacturer", "主料制造商"],
    baseMpn: ["基准mpn", "基准型号", "basempn", "主料mpn"],
    altPn: ["替代内部料号", "替代料号", "alternateinternalpn", "altpn"],
    altMfg: ["替代制造商", "替代厂商", "altmfg", "alternatemfg", "alternatemanufacturer"],
    altMpn: ["替代mpn", "替代型号", "altmpn", "alternatempn"],
    functional: ["功能等效", "功能一致", "功能兼容", "functionalequivalence", "functional"],
    packageCompat: ["封装兼容", "封装一致", "packagecompatibility", "packagecompat", "package"],
    pin: ["引脚兼容", "引脚一致", "pincompatibility", "pincompat", "pin"],
    reason: ["判定依据", "依据", "原因", "reason"],
    source: ["依据来源", "来源", "source", "evidencesource"],
    approvedBy: ["确认人", "审核人", "approvedby", "approver"],
    note: ["备注", "说明", "note", "remark"],
  },
  required: ["basePn", "altPn", "functional", "packageCompat", "pin"],
} as const satisfies ColumnVocabulary<string>;
