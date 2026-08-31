/**
 * Excess(呆滞/多余料)数据 Provider。
 *
 * PR2-PROC-05-D / PR2-PROC-12:客户要求「提示哪些材料可以不用买」。
 *
 * **当前没有任何真实数据源** —— 客户尚未确认 excess 从哪来
 * (ERP 导出?人工上传?系统自算?见 OPEN-QUESTIONS Q1)。
 *
 * 所以这一层只做接口与诚实空态:
 * - 未配置时 `mode = "unconfigured"`,查询一律返回空 + 明确原因;
 * - **不返回 Mock 数据**。一个编出来的「可用 500 PCS」会让 PM 少买 500 颗,
 *   这是直接的业务损失,比"功能还没有"严重得多;
 * - 业务代码永不感知配置与否的差异,只读 `unavailableReason` 决定怎么显示。
 */
import type { ExcessSource } from "@prisma/client";

export interface ExcessAvailability {
  /** 归属客户;null = 不限客户的通用库存 */
  customerId: string | null;
  mpn: string | null;
  internalPn: string | null;
  /** 账面数量 */
  qty: string;
  /** 其中可动用的数量(可能小于账面) */
  availableQty: string;
  source: ExcessSource;
  snapshotAt: string;
  notes: string | null;
}

export interface ExcessQuery {
  tenantId: string;
  mpns: readonly string[];
  /** 限定客户;不传表示只看通用(不跨客户) */
  customerId?: string | null;
}

export interface ExcessLookupResult {
  lines: ExcessAvailability[];
  /**
   * 数据不可用的原因;可用时为 null。
   * 页面据此显示「Excess 数据源未配置」而不是空表 ——
   * 空表会被读成"没有多余料",与"不知道有没有"完全是两回事。
   */
  unavailableReason: string | null;
  /** 数据时点;不可用时为 null */
  snapshotAt: string | null;
}

export interface ExcessProvider {
  readonly mode: "unconfigured" | "db";
  lookup(query: ExcessQuery): Promise<ExcessLookupResult>;
}

const UNCONFIGURED_REASON =
  "Excess 数据源未配置 —— 尚未确认 excess 从 ERP 导出、人工上传还是系统自算(待客户确认)。" +
  "在接入之前系统不估算可用 Excess,也不按 0 计入采购核算。";

/** 未配置:诚实返回空 + 原因,**绝不给 Mock 数字** */
class UnconfiguredExcessProvider implements ExcessProvider {
  readonly mode = "unconfigured" as const;
  async lookup(): Promise<ExcessLookupResult> {
    return { lines: [], unavailableReason: UNCONFIGURED_REASON, snapshotAt: null };
  }
}

/**
 * 库内快照 Provider —— 一旦有人通过导入/ERP 同步写入 ExcessSnapshot 就自动生效。
 *
 * 取**最近一个快照**,不做跨快照合并:两个快照的口径可能不同,
 * 合并出来的数字没人能解释。
 */
class DbExcessProvider implements ExcessProvider {
  readonly mode = "db" as const;

  constructor(
    private readonly deps: {
      findLatestSnapshot: (tenantId: string) => Promise<{ id: string; snapshotAt: Date; source: ExcessSource } | null>;
      findLines: (args: {
        tenantId: string;
        snapshotId: string;
        mpns: readonly string[];
        customerId?: string | null;
      }) => Promise<
        {
          customerId: string | null;
          mpn: string | null;
          internalPn: string | null;
          qty: { toString(): string };
          availableQty: { toString(): string };
          notes: string | null;
        }[]
      >;
    },
  ) {}

  async lookup(query: ExcessQuery): Promise<ExcessLookupResult> {
    const snap = await this.deps.findLatestSnapshot(query.tenantId);
    if (!snap) {
      return {
        lines: [],
        unavailableReason: "尚未导入任何 Excess 快照 —— 导入后本页会自动使用最近一个快照",
        snapshotAt: null,
      };
    }
    if (query.mpns.length === 0) {
      return { lines: [], unavailableReason: null, snapshotAt: snap.snapshotAt.toISOString() };
    }
    const rows = await this.deps.findLines({
      tenantId: query.tenantId,
      snapshotId: snap.id,
      mpns: query.mpns,
      customerId: query.customerId,
    });
    return {
      lines: rows.map((r) => ({
        customerId: r.customerId,
        mpn: r.mpn,
        internalPn: r.internalPn,
        qty: r.qty.toString(),
        availableQty: r.availableQty.toString(),
        source: snap.source,
        snapshotAt: snap.snapshotAt.toISOString(),
        notes: r.notes,
      })),
      unavailableReason: null,
      snapshotAt: snap.snapshotAt.toISOString(),
    };
  }
}

export function createUnconfiguredExcessProvider(): ExcessProvider {
  return new UnconfiguredExcessProvider();
}

export function createDbExcessProvider(
  deps: ConstructorParameters<typeof DbExcessProvider>[0],
): ExcessProvider {
  return new DbExcessProvider(deps);
}

/**
 * 跨客户占用护栏(纯函数)。
 *
 * 客户第三轮答复(2026-08 回复清单第 2 项)已明确口径:
 * 跨客户共用**允许**,但规则是「由 PM、品质、工程确认后允许使用」;
 * Excess 可用量「由 PM 确定后使用」。
 *
 * 这**不改变**本函数的行为:**系统仍然绝不自动跨客户占用** ——
 * 三方确认是一个人工流程,不是一个布尔开关。系统只做两件事:
 *   ① 把「不限客户」和「正好属于本客户」的量算作可提示量;
 *   ② 把属于**其它客户**的量单列出来,标注为
 *     「可申请跨客户占用(需 PM / 品质 / 工程确认后由人工操作)」,
 *     而不是过去的一律「不可用」—— 客户开了这扇门,界面要如实说;
 *     但在三方确认的线上流程落地之前,占用动作仍在系统之外发生。
 */
export function splitExcessByOwnership(
  lines: readonly ExcessAvailability[],
  forCustomerId: string | null,
): { usable: ExcessAvailability[]; otherCustomers: ExcessAvailability[] } {
  const usable: ExcessAvailability[] = [];
  const otherCustomers: ExcessAvailability[] = [];
  for (const l of lines) {
    if (l.customerId === null || (forCustomerId !== null && l.customerId === forCustomerId)) {
      usable.push(l);
    } else {
      otherCustomers.push(l);
    }
  }
  return { usable, otherCustomers };
}
