# ERP CLOSED-LOOP ACCEPTANCE MATRIX

> 证据来源:`tests/e2e/zz-erp-closed-loop-acceptance.spec.ts` 于 2026-09-07 对
> **真实 Lab 服务**(`scripts/dev-server.mjs`,复用线上同一 handler + Prisma 仓储)
> 的本地运行,**8/8 全绿**。CI 中该组在未配置 `ERP_LAB_BASE_URL/TOKEN` 时整组跳过
> (BLOCKED_EXTERNAL),不假装通过。复跑方式见文末。
>
> ⚠ **所有 PASS 均指 ERP 仿真环境(ezplm-erp-lab)**。真实金蝶 K3 云星空一律
> `WAITING_FOR_DOCUMENTATION`(O1 凭据未到)——**严禁把 Lab PASS 读作金蝶 PASS**。

| # | 验收项 | ERP Lab | 真实金蝶 | 证据(验收组编号) |
|---|---|---|---|---|
| 1 | Material Sync(分页信封拉取) | **PASS** | WAITING_FOR_DOCUMENTATION | 〔1〕 |
| 2 | Inventory Sync(+customerCode/materialCode/warehouseCode 服务端过滤) | **PASS** | WAITING_FOR_DOCUMENTATION | 〔1〕〔6〕 |
| 3 | Excess Sync(customer 过滤互不可见) | **PASS** | WAITING_FOR_DOCUMENTATION | 〔1〕 |
| 4 | FX Sync(读取面;主仓仍不落数值,口径待 O3) | **PASS**(读取)/ PARTIAL(落库刻意不做) | WAITING_FOR_DOCUMENTATION | 〔1〕 |
| 5 | Open PO Sync | **PASS** | WAITING_FOR_DOCUMENTATION | 〔1〕 |
| 6 | Work Order(LAB-1) | **PASS**(头+consumedLines) | WAITING_FOR_DOCUMENTATION | 〔1〕〔2〕 |
| 7 | Sales Order(LAB-1) | **PASS** | WAITING_FOR_DOCUMENTATION | 〔1〕〔2〕 |
| 8 | PO Create(经主应用回写,取回 SIM 单号) | **PASS** | WAITING_FOR_DOCUMENTATION | 〔3〕 |
| 9 | Duplicate PO(PO_ALREADY_EXISTS → BLOCKED,不自动重试) | **PASS** | WAITING_FOR_DOCUMENTATION | 〔4〕 |
| 10 | Network Drop After Commit(→RETRY_REQUIRED) | **PASS** | WAITING_FOR_DOCUMENTATION | 〔4〕 |
| 11 | Retry(同幂等键取回**原单**,不重复建) | **PASS** | WAITING_FOR_DOCUMENTATION | 〔3〕〔4〕 |
| 12 | Supplier ETA(免登录确认,公开路径不同步等待 ERP) | **PASS** | 不适用(本系统能力) | 〔5〕 |
| 13 | ETA Writeback(worker 异步消费 PENDING → updateEta → SYNCED;PO 未回写时 BLOCKED 并说人话) | **PASS** | WAITING_FOR_DOCUMENTATION | 〔5〕 |
| 14 | Receipt(receivePurchaseOrder,幂等) | **PASS**(镜像契约直调;主应用收货 UI 未做,见下) | WAITING_FOR_DOCUMENTATION | 〔6〕 |
| 15 | Inventory Update(收货后库存 +500 可查) | **PASS** | WAITING_FOR_DOCUMENTATION | 〔6〕 |
| 16 | Customer Isolation(excess/inventory 按 customerCode 服务端隔离;门户 defense-in-depth 二次过滤) | **PASS** | 不适用(本系统+Lab 能力) | 〔1〕+ F6 隔离矩阵 E2E |
| 17 | Tenant Isolation(Lab 数据集按租户隔离;匿名读客户租户 401;场景注入互不污染) | **PASS** | 不适用 | 〔7〕+ Lab 单测 |
| 18 | Correlation(主仓 correlationId ↔ Lab requestLog 对齐) | **PASS** | WAITING_FOR_DOCUMENTATION | 〔3〕 |

## PARTIAL / 未覆盖(如实)

- **#14 收货**:契约与 Lab 实现完备并验收;**主应用尚无收货 UI/流程**(RECEIPT_LOT 语义已在追溯域,接线属后续 PR)。
- **#4 FX**:读取链路 PASS;主仓**刻意不落汇率数值**(客户口径 O3 未答,比价页继续拒绝跨币种比大小)。
- Snapshot STRICT_UAT 导入:Lab 单测覆盖模式逻辑;**乾创真实脱敏 Excel 演练待客户提供文件**(BLOCKED_CUSTOMER)。

## 复跑方式

```bash
# 1. Lab 侧(ezplm-erp-lab 仓库;scratch Postgres)
DATABASE_URL=postgresql://.../erp_lab_dev npx prisma migrate deploy
DATABASE_URL=... ERP_LAB_ACCESS_TOKEN=loop-token node --import tsx scripts/dev-server.mjs 4872

# 2. 主仓
ERP_LAB_BASE_URL=http://127.0.0.1:4872 ERP_LAB_ACCESS_TOKEN=loop-token \
  pnpm exec playwright test tests/e2e/zz-erp-closed-loop-acceptance.spec.ts
```
