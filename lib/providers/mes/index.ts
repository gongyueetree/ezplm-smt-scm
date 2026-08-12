/**
 * MES 追溯 Provider(E6 / 客户 Q12)。
 *
 * 客户原话:「最好 SN 级别,但 **SN 需要和 MES 关联**,请确认是否可以达成」。
 *
 * 我方答复必须先讲清楚:**本系统没有 MES,也不产生 SN**。
 * SN 级追溯的前提是贵司有 MES、或产线能产出 SN 与批次的绑定记录。
 * 若没有,SN 级追溯**无法实现** —— 这不是排期问题,是没有数据来源。
 *
 * 所以这里只落一个接口 + `NOT_CONFIGURED` 状态:
 * - 界面据此显示「当前粒度:批次级 / SN 级:MES 接口待接入」;
 * - **绝不生成虚构 SN**,也不用 Mock 冒充已联调。
 */

export type MesProviderState = "NOT_CONFIGURED" | "CONFIGURED";

export interface MesSerialRecord {
  sn: string;
  finishedLotId: string | null;
  workOrderId: string | null;
  productId: string | null;
  mesExternalId: string | null;
}

export interface MesTraceProvider {
  readonly state: MesProviderState;
  /** 厂商标识(未配置时为 null —— 客户还没告诉我们用的是哪家) */
  readonly vendor: string | null;
  /** 未配置时抛错,不返回空数组冒充"没数据" */
  pullSerials(input: { workOrderId?: string; since?: string }): Promise<MesSerialRecord[]>;
}

export class MesNotConfiguredError extends Error {
  readonly code = "mes_not_configured";
  constructor() {
    super(
      "MES 接口尚未接入:本系统不产生 SN,SN 级追溯依赖贵司 MES 或产线的 SN↔批次绑定记录。" +
        "请提供 MES 厂商、接口文档与 SN 编码规则(见 OPEN-QUESTIONS O9)。",
    );
  }
}

class NotConfiguredMesProvider implements MesTraceProvider {
  readonly state = "NOT_CONFIGURED" as const;
  readonly vendor = null;
  async pullSerials(): Promise<MesSerialRecord[]> {
    throw new MesNotConfiguredError();
  }
}

/**
 * 取 MES Provider。
 *
 * 目前**永远返回未配置** —— 客户尚未提供 MES 厂商与接口(O9)。
 * 等信息到位后在这里加真实实现;在那之前不存在"看起来能用"的中间态。
 */
export function getMesTraceProvider(): MesTraceProvider {
  return new NotConfiguredMesProvider();
}

/** 界面文案:粒度说明。**不允许在无 MES 时说 SN 级可用** */
export function traceGranularityNote(state: MesProviderState, snCount: number): string {
  if (state === "NOT_CONFIGURED") {
    return snCount > 0
      ? `当前粒度:**批次级**;已导入 ${snCount} 条 SN 记录(人工/离线导入),可由 SN 反查工单与物料批次。MES 接口**待接入**。`
      : "当前粒度:**批次级**。SN 级追溯需要 MES 提供 SN↔批次绑定记录 —— 接口**待接入**,系统不会自行生成 SN。";
  }
  return `当前粒度:**SN 级**(MES 已接入),共 ${snCount} 条 SN 记录。`;
}
