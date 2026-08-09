-- This is an empty migration.
-- ============================================================
-- A-2:同一 (租户, 连接, 实体) 只允许一个 RUNNING 作业。
--
-- 为什么必须下沉到 DB:应用层的"先查再插"在并发下必然有竞态窗口,
-- 两个请求可以同时查到"没有 RUNNING"然后各插一条。
-- 只有唯一索引能真正保证。Prisma schema 表达不了部分唯一索引,故用原生 SQL。
--
-- 先修历史冲突再建索引 —— 直接建索引会让存量数据把生产迁移炸掉。
-- 重复的 RUNNING 本身就是卡死的作业(真正在跑的只可能有一个),
-- 保留最新一条,其余标 FAILED 并写明原因,便于事后追查。
-- ============================================================
UPDATE "ErpSyncJob" j
SET "status" = 'FAILED',
    "errorSummary" = COALESCE(j."errorSummary", '') ||
      '[迁移 erp_job_lease] 同一连接与实体存在多个 RUNNING 作业,保留最新一条,本条判为失败'
WHERE j."status" = 'RUNNING'
  AND EXISTS (
    SELECT 1 FROM "ErpSyncJob" k
    WHERE k."tenantId" = j."tenantId"
      AND k."connectionId" = j."connectionId"
      AND k."entityType" = j."entityType"
      AND k."status" = 'RUNNING'
      AND (k."createdAt" > j."createdAt" OR (k."createdAt" = j."createdAt" AND k."id" > j."id"))
  );

CREATE UNIQUE INDEX "ErpSyncJob_one_running_per_scope"
  ON "ErpSyncJob" ("tenantId", "connectionId", "entityType")
  WHERE "status" = 'RUNNING';
