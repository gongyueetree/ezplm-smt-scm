# SETUP — 启动包使用说明(5 分钟布置仓库)

## 一、把启动包内容放进仓库
在本地克隆 `eehubio/ezplm_smt_full` 后,按下面结构放置:

```
ezplm_smt_full/
├── CLAUDE.md                    ← 启动包根目录的 CLAUDE.md(核心,必放)
├── docs/
│   ├── SPEC.pdf                 ← GPT 实施规范(启动包已含)
│   ├── INTEGRATION_PLAN.md      ← 升级整合方案(启动包已含)
│   ├── KICKOFF_PROMPTS.md       ← 各 PR 开工指令(启动包已含)
│   └── customer-feedback/
│       ├── 功能层级清单.xlsx     ← (启动包已含)
│       └── 客户测试意见20260716.docx
├── legacy-static/               ← 【你自己放】解压 ezplm-prototype-v5.2.1.zip 到此
│   ├── customer-confirmation/   （整包放入即可,含 reports/ 也无妨）
│   └── internal-demo/
└── reference/
    └── nestjs-v15/              ← 【你自己放】旧后端至少 schema.prisma;
                                    若方便,把 src/ 一并放入供逻辑参考
```

需要你补的只有两处:`legacy-static/`(用你本地的 v5.2.1 交付包)和 `reference/nestjs-v15/`(旧后端 schema 与代码)。仓库里现有的静态 HTML 若与 v5.2.1 重复,以 v5.2.1 为准。

## 二、提交基线
```bash
git checkout -b feature/nextjs-agent-v1
git add -A && git commit -m "chore: baseline — CLAUDE.md, docs, legacy-static, nestjs reference"
git push -u origin feature/nextjs-agent-v1
```

## 三、启动第一个会话
在仓库根目录运行 `claude`,粘贴 `docs/KICKOFF_PROMPTS.md` 里的【PR1 开工指令】。
Claude Code 会自动读取 CLAUDE.md;PR1 完成后它会停下等你确认。

## 四、每个 PR 的循环(沿用你既有的双轨质量结构)
1. Claude Code 完成一个 PR → 输出测试结果 + 已完成/未完成清单;
2. 你把关键产出(如 PR1 的 schema 对照表、测试报告)拿回 claude.ai 对话或 GPT 做独立评审;
3. 评审通过 → 回 Claude Code 说"确认,开始 PR2"并粘贴对应开工指令;有问题 → 把诊断意见贴给 Claude Code 修复。

## 五、小提示
- 会话中途要补充长期规则时,在 Claude Code 里输入 `#` 开头的内容可快速写入 CLAUDE.md;
- 上下文过长时用 `/compact` 压缩;换会话不丢约束(CLAUDE.md 常驻);
- DigiKey/Mouser 的 Key 到位前,PR4 只做 Mock+合同测试骨架,这是预期内的,不算欠账;
- 不要让 Claude Code 一次做多个 PR——规范第十九节和 CLAUDE.md 都写了,逐 PR 人工确认是三轮诊断买来的纪律。
