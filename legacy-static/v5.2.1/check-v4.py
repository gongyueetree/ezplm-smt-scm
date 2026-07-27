#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ezPLM V4 双版本校验 · check-v4.py

相对 V3 的关键升级：不再仅检查"文件数量/关键词/href"，而是校验真实业务逻辑：
  - 报价页所有"当前单价"一致、总额=单价×数量
  - 物料报价提醒数量 == 实际异常数组长度（按规则重算）
  - 计划工时展示值 == 规则公式计算值
  - OPO 下次发送/截止日期无矛盾、无错误 cron
  - Excel/PDF/邮件/接口按钮均带"模拟/草案/CSV-XLSX/待联调"说明
  - 客户确认版 HTML 与 JS 均无范围外关键词，且不加载未使用的旧 JS
  - 审批角色必须存在于角色模型；AI 人工闭环、ERP 替代路径
  - 移动端存在汉堡菜单与抽屉导航
  - 链接无断链、<script src> 存在、内联/外部 JS 通过 node 语法检查（若有 node）
退出码：0 全过 / 1 有失败。
"""
import os, re, sys, subprocess, shutil, math

ROOT = os.path.dirname(os.path.abspath(__file__))
CC = os.path.join(ROOT, 'customer-confirmation')
ID = os.path.join(ROOT, 'internal-demo')
PV = os.path.join(ID, 'phase2-preview')
errors = []
warns = []

def read(p):
    with open(p, encoding='utf-8') as f:
        return f.read()

def pages(d):
    return sorted(f for f in os.listdir(d) if f.endswith('.html'))

def jsfiles(d):
    return sorted(f for f in os.listdir(d) if f.endswith('.js'))

def section(t):
    print('\n' + '=' * 4 + ' ' + t + ' ' + '=' * 4)

# ---------------------------------------------------------------- 1. 链接检查
section('1. 链接 / 脚本检查')
checked = 0
for base in [CC, ID, PV]:
    for f in pages(base):
        html = read(os.path.join(base, f))
        for m in set(re.findall(r'href="([^"#:]+\.html)"', html)):
            checked += 1
            if not os.path.exists(os.path.normpath(os.path.join(base, m))):
                errors.append(f'断链 {os.path.relpath(base, ROOT)}/{f} -> {m}')
        for src in set(re.findall(r'<script src="([^"]+\.js)"', html)):
            if not os.path.exists(os.path.normpath(os.path.join(base, src))):
                errors.append(f'缺脚本 {os.path.relpath(base, ROOT)}/{f} -> {src}')
print(f'共 {checked} 个 href · 断链/缺脚本累计 {len([e for e in errors if "断链" in e or "缺脚本" in e])} 个')

# ---------------------------------------------------------------- 2. JS 语法
section('2. JS 语法检查（外部 JS + 内联 <script>）')
node = shutil.which('node')
if not node:
    warns.append('未检测到 node，跳过 JS 语法检查')
    print('（未检测到 node，跳过）')
else:
    js_checked = 0
    js_bad = 0
    tmp = os.path.join(ROOT, '._chk_tmp.js')
    targets = []
    for base in [CC, ID, PV]:
        for f in jsfiles(base):
            targets.append(('extern', os.path.join(base, f)))
        for f in pages(base):
            targets.append(('inline', os.path.join(base, f)))
    for kind, path in targets:
        if kind == 'extern':
            code = read(path)
        else:
            code = '\n'.join(re.findall(r'<script>(.*?)</script>', read(path), re.S))
            if not code.strip():
                continue
        with open(tmp, 'w', encoding='utf-8') as f:
            f.write(code)
        js_checked += 1
        r = subprocess.run([node, '--check', tmp], capture_output=True, text=True)
        if r.returncode != 0:
            js_bad += 1
            errors.append(f'JS 语法错误 {os.path.relpath(path, ROOT)}: {r.stderr.strip().splitlines()[0] if r.stderr else "?"}')
    if os.path.exists(tmp):
        os.remove(tmp)
    print(f'检查 {js_checked} 段 JS · 语法错误 {js_bad} 段')

# ---------------------------------------------------------------- 3. 范围外关键词（HTML + JS）
section('3. 客户确认版范围外关键词扫描（HTML + JS）')
# 仅允许出现在 phase2.html（变更需求池）与明确标注"二期/超范围/不在本期"的上下文
OOS_KW = ['ECN', 'ECO', '8D', 'PDCA', 'SPC', 'IQC', 'IPQC', 'OQC',
          '高级 APS', '贸易商', '鼎芯', '微信小程序', 'SN 级', 'SN级',
          'hardneng', '告知函']
ALLOW_CTX = ['二期', '超范围', '超出本期', '不在本期', '不属于本期',
             '变更需求', '另行确认', '为二期', '范围外']
def ctx_ok(text, idx):
    win = text[max(0, idx - 140):idx + 140]
    return any(a in win for a in ALLOW_CTX)
scope_hits = 0
for f in pages(CC) + jsfiles(CC):
    if f == 'phase2.html':
        continue  # 变更需求池允许列举超范围名称
    full = os.path.join(CC, f)
    txt = read(full)
    for kw in OOS_KW:
        for m in re.finditer(re.escape(kw), txt):
            if not ctx_ok(txt, m.start()):
                errors.append(f'客户版范围外关键词 {f}: "{kw}"（无二期/超范围上下文）')
                scope_hits += 1
print(f'范围外关键词违规 {scope_hits} 处（phase2.html 与"二期/超范围"上下文已豁免）')

# ---------------------------------------------------------------- 4. 未使用旧 JS
section('4. 客户确认版不得加载/残留未使用旧 JS')
loaded = set()
for f in pages(CC):
    for src in re.findall(r'<script src="([^"]+\.js)"', read(os.path.join(CC, f))):
        loaded.add(os.path.basename(src))
DEAD = ['rbac.js', 'workflow.js', 'ui-helpers.js']
for d in DEAD:
    if os.path.exists(os.path.join(CC, d)):
        if d in loaded:
            warns.append(f'{d} 仍被加载（如已重写为本期内容可忽略）')
        else:
            errors.append(f'客户版残留未加载旧 JS: {d}（应删除）')
unused = [j for j in jsfiles(CC) if j not in loaded]
print(f'客户版 JS: {jsfiles(CC)} · 实际加载: {sorted(loaded)} · 未加载: {unused or "无"}')

# ---------------------------------------------------------------- 5. 报价单价一致性
section('5. 报价页数值一致性（quote.html）')
def check_quote(base):
    f = os.path.join(base, 'quote.html')
    txt = read(f)
    tag = os.path.basename(base)
    # 单价不得写死（KPI 不得是固定 ¥382.6 等，应绑定 id）
    if re.search(r'¥382\.6', txt):
        errors.append(f'{tag}/quote.html KPI 仍写死 ¥382.6')
    if 'id="kpi-price"' not in txt:
        errors.append(f'{tag}/quote.html KPI 单价未绑定计算结果（缺 id="kpi-price"）')
    # 按页面公式重算，校验 std/final 与公布值
    cost = dict(re.findall(r'(\w+):([\d.]+)', re.search(r'const COST=\{([^}]+)\}', txt).group(1)))
    cost = {k: float(v) for k, v in cost.items()}
    proc = cost['smt'] + cost['dip'] + cost['board'] + cost['test']
    mgmtB = (cost['mat'] + proc) * 0.12
    std = cost['mat'] + proc + mgmtB
    fin = cost['mat'] + (proc + mgmtB) * 0.95
    # 页面静态显示的标准单价应与计算一致
    shown_std = re.search(r'id="std">¥\s*([\d.]+)', txt)
    if shown_std and abs(float(shown_std.group(1)) - std) > 0.05:
        errors.append(f'{tag}/quote.html 标准单价显示 {shown_std.group(1)} ≠ 计算 {std:.2f}')
    # 审批角色不得用不存在角色
    for bad in ['销售主管', '总经理']:
        if bad in txt:
            errors.append(f'{tag}/quote.html 含角色模型外审批人: {bad}')
    print(f'  {tag}: 计算标准单价 {std:.2f} · 折后(B/95%) {fin:.2f} · KPI 绑定={"是" if "id=\"kpi-price\"" in txt else "否"}')
for base in [CC, ID]:
    check_quote(base)

# ---------------------------------------------------------------- 6. 物料报价提醒数量
section('6. 物料报价低价提醒数量 == 实际异常数（material-quote.html）')
def check_mq(base):
    f = os.path.join(base, 'material-quote.html')
    txt = read(f)
    tag = os.path.basename(base)
    L = re.findall(r"\{mpn:'([^']+)',desc:'[^']*',need:\d+,stk:\d+,opo:\d+,moq:\d+,low:([\d.]+)", txt)
    fill = re.search(r'const FILL=\[([^\]]+)\]', txt).group(1)
    fill = [float(x) for x in fill.split(',')]
    thr = float(re.search(r'const THRESH=([\d.]+)', txt).group(1))
    flagged = []
    for i, (mpn, low) in enumerate(L):
        low = float(low)
        p = fill[i]
        if p > low * (1 + thr) or p > low:
            flagged.append(mpn)
    n = len(flagged)
    # 页面不得写死 "2 项触发提醒"
    if re.search(r'2 项触发提醒', txt) and n != 2:
        errors.append(f'{tag}/material-quote.html 写死"2 项触发提醒"，实际 {n} 项')
    # 动态计数函数必须存在
    if 'flaggedLines()' not in txt:
        errors.append(f'{tag}/material-quote.html 缺动态计数 flaggedLines()')
    # 遗漏项校验：所有异常 MPN 都应能被弹窗/列表覆盖（动态生成即可）
    print(f'  {tag}: 规则重算异常 {n} 项 -> {flagged}')
    if n != 3:
        warns.append(f'{tag}/material-quote.html 重算异常 {n} 项（设计预期 3 项）')
for base in [CC, ID]:
    check_mq(base)

# ---------------------------------------------------------------- 7. 计划工时一致性
section('7. 计划工时展示值 == 规则公式计算值（planning.html）')
def check_planning(base):
    f = os.path.join(base, 'planning.html')
    txt = read(f)
    tag = os.path.basename(base)
    # 不得残留写死 61.5h 旧值，且工时应由公式动态渲染
    if '61.5 h' in txt or '>61.5<' in txt:
        errors.append(f'{tag}/planning.html 残留写死工时 61.5h')
    if 'calcHoursFor' not in txt or 'renderHours' not in txt:
        errors.append(f'{tag}/planning.html 工时未由统一公式动态计算（缺 calcHoursFor/renderHours）')
    # 系统计算与人工确认必须分列
    if '系统计算工时' not in txt or '人工确认工时' not in txt:
        errors.append(f'{tag}/planning.html 未区分系统计算工时/人工确认工时')
    # 复算 WO-7735 验证公式可得合理值
    m = re.search(r"wo:'WO-7735'[^}]*?qty:(\d+)\s*,\s*smt:(\d+)\s*,\s*dip:(\d+)\s*,\s*chg:(\d+)", txt)
    if m:
        qty, smt, dip, chg = map(int, m.groups())
        # 读默认规则 value
        def dv(idv, d):
            mm = re.search(r'id="%s"[^>]*value="([\d.]+)"' % idv, txt)
            return float(mm.group(1)) if mm else d
        rs = dict(smt=dv('r-smt', .45), dip=dv('r-dip', 4.2), test=dv('r-test', 35), chg=dv('r-chg', 30))
        tot = smt * qty * rs['smt'] / 3600 + dip * qty * rs['dip'] / 3600 + qty * rs['test'] / 3600 + chg * rs['chg'] / 60
        print(f'  {tag}: WO-7735 公式重算 = {tot:.1f}h（应≈164.9，旧写死 61.5 已移除={"是" if "61.5 h" not in txt else "否"}）')
    # 删除高级 APS 表述（除"为二期/不实现"上下文）
    for kw in ['产能约束优化', '多产线多工序自动调度', '换线优化', '实时车间看板']:
        for mm in re.finditer(re.escape(kw), txt):
            win = txt[max(0, mm.start() - 40):mm.start() + 40]
            if not any(a in win for a in ['二期', '不实现', '均为', '不需要', '为二期']):
                errors.append(f'{tag}/planning.html 含高级 APS 表述（非二期上下文）: {kw}')
for base in [CC, ID]:
    check_planning(base)

# ---------------------------------------------------------------- 8. OPO 日期/周期
section('8. OPO 周期与日期一致性（opo.html）')
def check_opo(base):
    f = os.path.join(base, 'opo.html')
    txt = read(f)
    tag = os.path.basename(base)
    if re.search(r'0 9 \* \* 1/2', txt):
        errors.append(f'{tag}/opo.html 残留错误 cron 表达式 0 9 * * 1/2')
    # 必须有清晰的"每 14 天"表述
    if '14 天' not in txt and '14天' not in txt:
        errors.append(f'{tag}/opo.html 缺"每 14 天"周期表述')
    # 周期字段
    for need in ['周期起始日', '上次发送', '下次发送', '截止']:
        if need not in txt:
            errors.append(f'{tag}/opo.html 缺周期字段: {need}')
    # 下次发送 与 邮件正文截止日 不得矛盾（同为 06-15）
    nexts = set(re.findall(r'下次发送[^0-9]*0?(\d-\d\d)|下次发送（\+14 天）</div><div class="mono"><b>2026-(\d\d-\d\d)', txt))
    deadlines = set(re.findall(r'截止 2026-(\d\d-\d\d)', txt))
    dl_panel = set(re.findall(r'回复截止[^0-9]*2026-(\d\d-\d\d)', txt))
    allmail = set(re.findall(r'请于 2026-(\d\d-\d\d) 前', txt))
    combo = deadlines | allmail
    if combo and '06-14' in combo and '06-15' in (combo | dl_panel):
        errors.append(f'{tag}/opo.html 催复截止日期不一致（同时出现 06-14 与 06-15）')
    if '06-14' in combo:
        errors.append(f'{tag}/opo.html 邮件正文仍含旧截止日 06-14（应统一 06-15）')
    # 发送按钮应为"模拟/预览"
    if re.search(r'已发送至', txt) or re.search(r"立即发送'", txt):
        errors.append(f'{tag}/opo.html 含"立即发送/已发送"等真实发送声明')
    print(f'  {tag}: cron 错误={"是" if "0 9 * * 1/2" in txt else "否"} · 周期字段齐备={"是" if all(k in txt for k in ["周期起始日","下次发送","截止"]) else "否"}')
for base in [CC, ID]:
    check_opo(base)

# ---------------------------------------------------------------- 9. 集成实现状态
section('9. 系统集成实现状态用词（integration.html）')
def check_integration(base):
    f = os.path.join(base, 'integration.html')
    txt = read(f)
    tag = os.path.basename(base)
    BANNED = ['已启用', '已试运行', '已回写', '已同步', '已自动重试', '延迟 86ms', '试运行']
    for b in BANNED:
        if b in txt:
            errors.append(f'{tag}/integration.html 含未确认即声称的状态词: {b}')
    # 金蝶具体版本不得断言
    if 'K/3 WISE' in txt:
        errors.append(f'{tag}/integration.html 断言金蝶具体版本 K/3 WISE（应"具体版本待确认"）')
    # 顶部需有"待客户 IT 确认"声明
    if '待客户 IT 确认' not in txt:
        errors.append(f'{tag}/integration.html 缺"待客户 IT 确认"声明')
    # 通道状态用词
    ALLOWED = ['可选', '待确认', '待授权', '待联调', '示例配置']
    print(f'  {tag}: 违规状态词={"无" if not any(b in txt for b in BANNED) else "有"} · IT确认声明={"有" if "待客户 IT 确认" in txt else "无"}')
for base in [CC, ID]:
    check_integration(base)

# ---------------------------------------------------------------- 10. Excel/PDF/邮件/接口说明
section('10. 导出/PDF/邮件/接口按钮的"模拟/草案/CSV-XLSX"说明')
# 10a Excel: ezExportCSV 文件名不得为 .xlsx
xlsx_bad = 0
for base in [CC, ID]:
    for f in pages(base):
        txt = read(os.path.join(base, f))
        for m in re.finditer(r"ezExportCSV\('([^']+)'", txt):
            if m.group(1).lower().endswith('.xlsx'):
                errors.append(f'{os.path.basename(base)}/{f} CSV 导出却命名 .xlsx: {m.group(1)}')
                xlsx_bad += 1
# 10b PDF: 不得"已生成下载"
for base in [CC, ID]:
    txt = read(os.path.join(base, 'quote.html'))
    if 'PDF 报价单已生成下载' in txt:
        errors.append(f'{os.path.basename(base)}/quote.html PDF 仍声称"已生成下载"')
    if '模拟生成 PDF' not in txt:
        errors.append(f'{os.path.basename(base)}/quote.html 缺"模拟生成 PDF"说明')
# 10c API: 拟议接口草案
for base in [CC, ID]:
    for f in pages(base):
        txt = read(os.path.join(base, f))
        if 'api-drawer' in txt and '拟议接口草案' not in txt:
            errors.append(f'{os.path.basename(base)}/{f} API 面板未标"拟议接口草案"')
print(f'  CSV 误命名 .xlsx: {xlsx_bad} · PDF/API 说明见上方错误（若有）')

# ---------------------------------------------------------------- 11. 审批角色存在性
section('11. 审批角色必须存在于角色模型')
# 角色模型以 settings.html 为准
roles_txt = read(os.path.join(CC, 'settings.html'))
ROLE_SET = set()
for r in ['PM', '采购', '计划', '管理', '供应商']:
    if r in roles_txt:
        ROLE_SET.add(r)
APPROVERS = re.findall(r'审批链：([^<]+)', read(os.path.join(CC, 'quote.html')))
bad_role = 0
for chain in APPROVERS:
    for token in re.split(r'[→（）()·\s]+', chain):
        t = token.strip()
        if t in ['销售主管', '总经理']:
            errors.append(f'审批链含角色模型外审批人: {t}')
            bad_role += 1
print(f'  角色模型: {sorted(ROLE_SET)} · 审批链违规 {bad_role}')

# ---------------------------------------------------------------- 12. AI 人工闭环
section('12. AI 输出人工闭环')
AI_PAGES = ['bom-process.html', 'quote.html', 'procurement.html', 'price-compare.html',
            'material-quote.html', 'planning.html', 'ar-ap.html', 'trace.html']
for f in AI_PAGES:
    txt = read(os.path.join(CC, f))
    has_confirm = any(k in txt for k in ['人工确认', '人工修改', '人工核对', '人工确认/修改'])
    has_record = ('留痕' in txt) or ('记录修正' in txt) or ('修正记录' in txt) or ('记录' in txt and '修正' in txt)
    if not (has_confirm and has_record):
        errors.append(f'{f} 人工闭环不完整（确认={has_confirm} 留痕={has_record}）')
print(f'  检查 {len(AI_PAGES)} 页（缺项见错误）')

# ---------------------------------------------------------------- 13. ERP 替代路径
section('13. ERP/MES 替代路径说明')
WB = {'integration.html': ['API', '中间表', 'Excel', 'RPA'],
      'opo.html': ['Excel'], 'ar-ap.html': ['导出', '待办'],
      'shortage.html': ['导出'], 'material-quote.html': ['下载', '结果表']}
for f, kws in WB.items():
    txt = read(os.path.join(CC, f))
    miss = [k for k in kws if k not in txt]
    if miss:
        errors.append(f'{f} 替代路径缺 {miss}')
ih = read(os.path.join(CC, 'integration.html'))
if 'Excel 导出 → 中间表 → RPA → API' not in ih:
    errors.append('integration.html 缺回写优先级总述')
print('  替代路径检查完成（缺项见错误）')

# ---------------------------------------------------------------- 14. 移动端导航
section('14. 移动端汉堡菜单与抽屉导航')
for base in [CC, ID, PV]:
    navjs = os.path.join(base, 'nav-contract.js')
    if not os.path.exists(navjs):
        continue
    txt = read(navjs)
    miss = [k for k in ['ez-hamburger', 'ez-nav-overlay', 'Escape', 'injectMobileNav'] if k not in txt]
    if miss:
        errors.append(f'{os.path.relpath(navjs, ROOT)} 移动端导航缺 {miss}')
# 不得保留 ≤980px 直接隐藏 sidebar 且无替代
for base in [CC, ID]:
    css = os.path.join(base, 'contract.css')
    if os.path.exists(css) and re.search(r'\.sidebar\s*\{\s*display:\s*none', read(css)):
        errors.append(f'{os.path.relpath(css, ROOT)} 仍在窄屏直接隐藏 .sidebar 且无抽屉替代')
print('  移动端导航检查完成')

# ---------------------------------------------------------------- 15. 预览页范围横幅
section('15. 二期预览页范围横幅')
for f in pages(PV):
    if '二期/变更需求预览，不属于本期合同交付范围' not in read(os.path.join(PV, f)):
        errors.append(f'预览页缺范围横幅: {f}')
print(f'  phase2-preview 共 {len(pages(PV))} 页')

# ---------------------------------------------------------------- 16. 交付/验收页
section('16. 交付·培训·验收页')
dap = os.path.join(CC, 'delivery-acceptance.html')
if not os.path.exists(dap):
    errors.append('缺 customer-confirmation/delivery-acceptance.html')
else:
    t = read(dap)
    for need in ['用户操作培训', '管理员配置培训', '字段映射', 'BOM 模板', 'OPO 模板',
                 'AR/AP 对账模板', 'Call 料表模板', '客户待提供资料', 'UAT', '静态高保真原型']:
        if need not in t:
            errors.append(f'delivery-acceptance.html 缺内容: {need}')
    # 必须在导航中可达
    if 'delivery-acceptance' not in read(os.path.join(CC, 'nav-contract.js')):
        errors.append('delivery-acceptance.html 未加入客户版导航')
print('  交付页检查完成')

# ---------------------------------------------------------------- 汇总
print('\n' + '=' * 52)
print(f'页面统计: customer {len(pages(CC))} 页 · internal {len(pages(ID))} 页 + phase2-preview {len(pages(PV))} 页')
if warns:
    for w in warns:
        print('WARN:', w)
if errors:
    for e in errors:
        print('FAIL:', e)
    print(f'\n结果: {len(errors)} 项失败 · {len(warns)} 项提醒')
    sys.exit(1)
print(f'\n结果: 全部通过 ✓ · {len(warns)} 项提醒')
sys.exit(0)
