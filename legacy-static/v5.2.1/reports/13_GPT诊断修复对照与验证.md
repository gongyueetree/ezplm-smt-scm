# 报告 13 · GPT 第三方诊断修复对照与验证（V4 → V5）

针对 GPT 诊断列出的 2 个 P0、约 8 个业务一致性问题、1 个主体错误、1 个交付边界问题，逐项修复并验证。

## P0（运行时缺陷）

### P0-1 CSV 导出 TypeError
- **问题**：`ezExportCSV(name, headers, rows)` 需 3 参，但 15 处按 2 参 `ezExportCSV(name, rowsFn())` 调用（rowsFn 返回 `[[表头],...行]`），`rows` 为 undefined 时 `rows.map` 抛错。
- **修复**：函数兼容两种形态——2 参时自动 `headers=table[0]; rows=table.slice(1)`；非数组入参给出友好提示而非崩溃；自动补 `.csv`。
- **验证**：check-v5 第 17 节用 Node 桩自动实测 3 种形态（3 参 / 2 参 table / 仅表头）+ 垃圾输入，**异常 0 次**（此项确为 check-v5 内置运行时实测）。

### P0-2 Tab 面板失效（ar-ap / procurement / trace）
- **问题**：处理器只匹配 `.tab-pane` 且按 `p.id===paneId`；这些页用 `class="pane" data-pane=…`（无 id），且 CSS 无 `.pane` 规则 → 内容不切换、可能同时显示。
- **修复**：处理器改为匹配 `.tab-pane, .pane`，目标用 `p.id || p.dataset.pane`；CSS 增加 `.pane{display:none}` / `.pane.active{display:block}`。
- **验证**：check-v5.py 静态校验类名/目标匹配与 CSS；开发侧 jsdom 另跑三页共 8 次点击，每次**恰好激活一个**正确面板（含切回首个）。

## 业务一致性

| # | 问题 | 修复 | 验证 |
|---|---|---|---|
| 4 | 系统使用方与客户混淆（登录"联创科技"，又把联创作客户） | 使用方/登录用户/邮件落款统一 **乾创电子**；联创科技仅作下游客户样例 | check-v5 §19 |
| 5a | 报价静态 HTML（¥343.16/¥1,029,480/21.4%）与运行值不一致、加载闪现 | 静态值改 `—`，由 `recalc()` 初始化填充 | 目检/§5 |
| 5b | 毛利率含无依据的 0.82 | 改透明基线（物料+加工），标注"口径待甲方确认" | 复算 9.6% |
| 5c | C 模式"工程费另计"但无工程费字段 | 删除该表述 | 目检 |
| 6 | GTB 声称用 MOQ/SPQ 实际只用 MOQ | 加 `spq` 字段，`max(raw,MOQ)` 后按 SPQ 向上圆整，含 `lossRate`（待确认，默认 0） | check-v5 §20 + 复算 |
| 7 | "PM 确认全部"跳过逐项、无 decision 记录 | 每条异常 `decision/decisionNote/confirmedBy/confirmedAt`，`every(decision)` 才可提交 | check-v5 §23 |
| 8 | Stepper 初始无高亮、完成仍停在第 6 步 | `ezStepper` 支持 current>总步数时全部 done | 目检 |
| 9 | 计划声称"工序"实际未参与 | 加 `route`/`currentOp`，未齐料不进上线队列 | check-v5 §21 |
| 10 | `fixHours` 只弹窗不改数据 | 读取输入、校验原因必填、写回 `WOS.manual`、重渲染工时/排产/KPI | check-v5 §22 静态校验；开发侧 jsdom 验证 KPI 523h→526h、显示 250h |
| 11 | OPO `simulateReply` 后异常 KPI 不变、表不更新 | KPI（异常 8→10）+ 差异表 + 异常清单同步追加；`portalSubmit` 更新行状态 | check-v5 §24 |

## 主体 / 交付边界

| # | 问题 | 修复 |
|---|---|---|
| 12 | 培训写"现场/远程·半天"，超出"远程为主、现场另计"约定 | 改"远程为主；如需现场培训，差旅及现场服务另行确认；时长按内容安排" |
| 13 | "下载全部模板"只弹 Toast 不下载 | `exportAll` 真正逐个导出 6 份模板 CSV |
| 14 | "主管/张主管"未对齐角色模型 | 统一"管理人员（主管）"，日志"张经理（管理人员）" |

## 校验脚本升级（#15）
`check-v5.py` 在 V4 的 16 项基础上新增 10 项（§17–§26）：导出参数兼容性（含运行时实测）、Tab 面板匹配、租户主体、MOQ+SPQ、工序字段、fixHours 写回、逐项 decision、OPO KPI 一致、培训方式、模板下载。
- 在 **V5** 上：26 项全过，EXIT=0。
- 在原始 **V3** 上：EXIT=1，新检查命中 16 处（导出/Tab/主体/SPQ/工序/fixHours/OPO 等），证明能真实拦截。
