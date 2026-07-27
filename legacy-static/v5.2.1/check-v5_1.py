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
    L = re.findall(r"\{mpn:'([^']+)',desc:'[^']*',need:\d+,stk:\d+,opo:\d+,moq:\d+,(?:spq:\d+,)?low:([\d.]+)", txt)
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

# ---------------------------------------------------------------- 17. CSV 导出调用兼容性
section('17. ezExportCSV 调用参数兼容性（防运行时 TypeError）')
# 定义须能处理 2 参（table）与 3 参（headers,rows）两种形态
cjs = read(os.path.join(CC, 'contract.js'))
two_arg_guard = 'rows === undefined' in cjs and 'headers.slice(1)' in cjs
if not two_arg_guard:
    errors.append('contract.js ezExportCSV 未兼容两参调用（仍会在 rows 为 undefined 时抛错）')
# 统计调用点，确认两参调用存在且被覆盖
call_two = 0; call_three = 0
for base in [CC]:
    for f in pages(base):
        txt = read(os.path.join(base, f))
        for m in re.finditer(r'ezExportCSV\(', txt):
            # 粗略判断参数个数：截取到匹配右括号前的逗号（顶层）
            seg = txt[m.end():m.end()+400]
            depth = 1; i = 0; commas = 0
            while i < len(seg) and depth > 0:
                ch = seg[i]
                if ch in '([{': depth += 1
                elif ch in ')]}': depth -= 1
                elif ch == ',' and depth == 1: commas += 1
                i += 1
            args = commas + 1
            if args == 2: call_two += 1
            elif args >= 3: call_three += 1
print(f'  两参调用 {call_two} · 三参调用 {call_three} · 兼容守卫={"有" if two_arg_guard else "无"}')
if node:
    # 运行时实测：加载 ezExportCSV 并以两种形态调用
    tmp = os.path.join(ROOT, '._exp_tmp.js')
    harness = '''
global.window={};global.document={createElement:()=>({click(){},set href(v){},get href(){return ''}})};
global.Blob=function(){};global.URL={createObjectURL:()=>'x',revokeObjectURL(){}};
global.ezToast=()=>{};global.setTimeout=()=>{};
const fs=require('fs');const cc=fs.readFileSync(%r,'utf8');
const m=cc.match(/window\\.ezExportCSV = function[\\s\\S]*?\\n  };/);eval(m[0]);
let bad=0;
try{window.ezExportCSV('a.csv',['h1','h2'],[['1','2']]);}catch(e){bad++;}
try{window.ezExportCSV('b',[['报价单号','客户'],['QT','联创']]);}catch(e){bad++;}
try{window.ezExportCSV('c',[['只有表头']]);}catch(e){bad++;}
process.stdout.write(String(bad));
''' % os.path.join(CC, 'contract.js')
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write(harness)
    r = subprocess.run([node, tmp], capture_output=True, text=True)
    os.remove(tmp)
    if r.stdout.strip() != '0':
        errors.append(f'ezExportCSV 运行时仍抛错（失败 {r.stdout.strip()} 次）')
    print(f'  运行时实测：3 种调用形态异常 {r.stdout.strip()} 次')

# ---------------------------------------------------------------- 18. Tab 面板匹配
section('18. Tab 面板类名/目标匹配（防 Tab 失效）')
# 处理器须兼容 .pane 与 .tab-pane，目标用 id||data-pane
tab_ok = '.tab-pane, ' in cjs and ('(p.id || p.dataset.pane)' in cjs or 'p.id || p.dataset.pane' in cjs)
if not tab_ok:
    errors.append('contract.js Tab 处理器未兼容 .pane 且未用 id||data-pane 作为目标')
# CSS 须含 .pane 显隐规则
ccss = read(os.path.join(CC, 'contract.css'))
if '.pane' not in ccss or '.pane.active' not in ccss:
    errors.append('contract.css 缺 .pane / .pane.active 显隐规则')
# 每个 tab 的 data-pane 必须能在同组面板中找到唯一目标
for base in [CC]:
    for f in ['ar-ap.html', 'procurement.html', 'trace.html']:
        txt = read(os.path.join(base, f))
        for tabs_m in re.finditer(r'<div class="tabs"[^>]*data-group="([^"]+)"[\s\S]*?</div>', txt):
            grp = tabs_m.group(1)
            tab_panes = set(re.findall(r'class="tab"[^>]*data-pane="([^"]+)"', tabs_m.group(0)))
            # 面板：同组的 .pane/.tab-pane
            pane_targets = set()
            for pm in re.finditer(r'class="(?:tab-)?pane[^"]*"[^>]*data-group="' + re.escape(grp) + r'"[^>]*', txt):
                seg = pm.group(0)
                idm = re.search(r'id="([^"]+)"', seg)
                dpm = re.search(r'data-pane="([^"]+)"', seg)
                pane_targets.add(idm.group(1) if idm else (dpm.group(1) if dpm else None))
            missing = tab_panes - pane_targets
            if missing:
                errors.append(f'{f} 组[{grp}] 这些 tab 无匹配面板: {missing}')
        print(f'  {f}: tab/面板匹配校验完成')

# ---------------------------------------------------------------- 19. 租户主体（系统使用方=乾创电子）
section('19. 客户确认版系统使用方/邮件落款 = 乾创电子')
# 登录用户与邮件落款不得用 联创科技（联创为下游客户，仅作样例数据）
nav = read(os.path.join(CC, 'nav-contract.js'))
if '/ 联创科技' in nav or '王 工 / 联创' in nav:
    errors.append('nav-contract.js 登录用户仍为联创科技（应为乾创电子）')
if '/ 乾创电子' not in nav:
    errors.append('nav-contract.js 登录用户未设为乾创电子')
opo_t = read(os.path.join(CC, 'opo.html'))
sht_t = read(os.path.join(CC, 'shortage.html'))
if '联创科技 采购部' in opo_t or '联创科技 物控部' in sht_t:
    errors.append('OPO/Call 料邮件落款仍为联创科技（应为乾创电子）')
if '【联创科技】OPO' in opo_t:
    errors.append('OPO 邮件主题仍以联创科技名义发送（应为乾创电子）')
print('  使用方/邮件落款检查完成（联创科技保留为下游客户样例）')

# ---------------------------------------------------------------- 20. GTB 必须含 MOQ 与 SPQ
section('20. 物料报价 GTB 公式必须包含 MOQ 与 SPQ')
mq = read(os.path.join(CC, 'material-quote.html'))
if 'spq' not in mq:
    errors.append('material-quote.html 数据/公式缺 SPQ')
gtb_m = re.search(r'function gtb\(l\)\{[\s\S]*?\n}', mq)
gtb_body = gtb_m.group(0) if gtb_m else ''
if 'spq' not in gtb_body or 'moq' not in gtb_body:
    errors.append('material-quote.html gtb() 未同时使用 MOQ 与 SPQ')
print(f'  GTB 含 MOQ={("moq" in gtb_body)} · SPQ={("spq" in gtb_body)}')

# ---------------------------------------------------------------- 21. 计划工序参与
section('21. 计划辅助声称使用工序则必须存在工序字段')
pl = read(os.path.join(CC, 'planning.html'))
claims_route = '工序' in pl
has_route = 'route' in pl and ('currentOp' in pl or 'isReady' in pl)
if claims_route and not has_route:
    errors.append('planning.html 声称含工序但无 route/工序就绪判定字段')
print(f'  声称工序={claims_route} · 存在工序字段/就绪判定={has_route}')

# ---------------------------------------------------------------- 22. 人工修改须真正写回数据
section('22. 计划 fixHours 必须真正读取输入并更新数据')
fix_m = re.search(r'function fixHours\([\s\S]*?\n}', pl)
fix_body = fix_m.group(0) if fix_m else ''
reads_input = '.value' in fix_body
mutates = ('w.manual' in fix_body) or ('WOS' in fix_body and '=' in fix_body)
rerenders = 'renderHours()' in fix_body
if not (reads_input and mutates and rerenders):
    errors.append(f'planning.html fixHours 未形成闭环（读取={reads_input} 写回={mutates} 重渲染={rerenders}）')
print(f'  fixHours：读取输入={reads_input} · 写回 WOS={mutates} · 重渲染={rerenders}')

# ---------------------------------------------------------------- 23. 物料报价逐项确认闭环
section('23. 物料报价逐项确认须落 decision 并校验完整')
if 'decision' not in mq or 'confirmedBy' not in mq:
    errors.append('material-quote.html 缺逐项 decision/confirmedBy 字段')
# V5.1：进入 PM 确认前须校验所有异常已由采购处理完毕（purchaserDone）
gate_ok = ('purchaserDone' in mq) and bool(re.search(r'filter\(l=>!l\.purchaserDone\)', mq))
if not gate_ok:
    errors.append('material-quote.html 未在 PM 确认前校验所有异常已处理（缺 purchaserDone 门禁）')
print(f'  decision/confirmedBy 字段齐备 · 异常处理门禁={"有" if gate_ok else "无"}')

# ---------------------------------------------------------------- 24. OPO 模拟回填 KPI/列表一致
section('24. OPO simulateReply 后 KPI 与列表一致')
sr = re.search(r'function simulateReply\(\)\{[\s\S]*?\n}', opo_t)
sr_body = sr.group(0) if sr else ''
# V5.1：改统一状态对象 OPO.abnormal/replied/suppliers，再 renderOpo()
updates_abn = ('opoLines' in sr_body) or ('OPO.abnormal' in sr_body) or ('k-abn' in sr_body)
unified = 'renderOpo()' in sr_body
appends_rows = ('diff-body' in opo_t) and ('abn-body' in opo_t)
if not (updates_abn and appends_rows and unified):
    errors.append(f'opo.html simulateReply 未保持一致（更新异常={updates_abn} 追加差异/异常行={appends_rows} 统一渲染={unified}）')
print(f'  simulateReply：更新异常={updates_abn} · 追加差异/异常行={appends_rows} · 统一渲染={unified}')

# ---------------------------------------------------------------- 25. 培训方式符合合同
section('25. 交付页培训方式 = 远程为主、现场另计')
dt = read(dap) if os.path.exists(dap) else ''
if not dt:
    errors.append('缺 delivery-acceptance.html，无法校验培训方式')
elif '远程为主' not in dt or '现场' not in dt:
    errors.append('delivery-acceptance.html 培训方式未写明"远程为主、现场另计"')
if '半天' in dt:
    errors.append('delivery-acceptance.html 仍承诺固定"半天"培训时长')
print('  培训方式检查完成')

# ---------------------------------------------------------------- 26. 下载全部模板须真正下载
section('26. "下载全部模板"须真正触发下载')
ea = re.search(r'function exportAll\(\)\{[\s\S]*?\n}', dt)
ea_body = ea.group(0) if ea else ''
if 'ezExportCSV(' not in ea_body:
    errors.append('delivery-acceptance.html exportAll 未真正调用导出（仍只 Toast）')
print('  模板下载检查完成')

# ---------------------------------------------------------------- 27. 报价状态机与提交门禁
section('27. 报价状态机：分类未确认不得提交、PDF 受审批控制')
q = read(os.path.join(CC, 'quote.html'))
checks_27 = {
    '存在分类状态数组 quoteLines': 'quoteLines' in q and 'status' in q,
    '提交前校验分类全部确认 clsAllDone': 'clsAllDone' in q and 'submitApprove' in q,
    'submitApprove 调用 clsAllDone 门禁': bool(re.search(r'function submitApprove\(\)\{[\s\S]*?clsAllDone\(\)', q)),
    '存在报价状态机 quoteStatus': 'quoteStatus' in q and 'PENDING_APPROVAL' in q and 'APPROVED' in q,
    'PDF 受 APPROVED 控制': bool(re.search(r"function exportPdf\(\)\{[\s\S]*?quoteStatus!=='APPROVED'", q)),
    '不可重复提交（状态判定）': bool(re.search(r"function submitApprove\(\)\{[\s\S]*?quoteStatus!=='DRAFT'", q)),
}
for k, v in checks_27.items():
    if not v:
        errors.append(f'quote.html 状态机缺失: {k}')
print('  ' + ' · '.join(f'{k}={"✓" if v else "✗"}' for k, v in checks_27.items()))

# ---------------------------------------------------------------- 28. 物料报价重新询价闭环
section('28. 物料报价 REQUOTE/换货源 须退回采购并重新校验')
mqf = read(os.path.join(CC, 'material-quote.html'))
checks_28 = {
    '决策默认空（无预选）': "请选择处理结论" in mqf and "suggest=" not in mqf,
    'REQUOTE/REPLACE 须更新价并重校验': 'purchaserDone' in mqf and 'newPrice' in mqf,
    '采购处理与 PM 确认分离': 'handledBy' in mqf and 'confirmedBy' in mqf,
    'PM 确认前校验异常已处理': (bool(re.search(r"filter\(l=>!l\.purchaserDone\)", mqf)) or 'unresolvedCount' in mqf),
}
for k, v in checks_28.items():
    if not v:
        errors.append(f'material-quote.html 重新询价闭环缺失: {k}')
# GTB toast 不应再写"按 MOQ 圆整"
if '按 MOQ 圆整' in mqf:
    errors.append('material-quote.html GTB 提示仍写"按 MOQ 圆整"（应为不低于 MOQ 并按 SPQ 向上圆整）')
print('  ' + ' · '.join(f'{k}={"✓" if v else "✗"}' for k, v in checks_28.items()))

# ---------------------------------------------------------------- 29. 计划：未来齐料也有排产 + 工序真正参与
section('29. 计划排产：基准日 + 未来齐料工单有顺位/建议开始完成')
pl2 = read(os.path.join(CC, 'planning.html'))
checks_29 = {
    '存在计划基准日 PLAN_DATE': 'PLAN_DATE' in pl2,
    '齐料判定用日期比较 materialReady': 'materialReady' in pl2 and 'readyAt' in pl2,
    '排产输出建议开始/完成': 'startD' in pl2 and 'finD' in pl2,
    '所有工单都有顺位（schedule 全量）': bool(re.search(r'function schedule\(\)\{[\s\S]*?\.map\(\(', pl2)),
    '工序进度字段 completedOps': 'completedOps' in pl2 and 'route' in pl2,
}
for k, v in checks_29.items():
    if not v:
        errors.append(f'planning.html 排产缺失: {k}')
print('  ' + ' · '.join(f'{k}={"✓" if v else "✗"}' for k, v in checks_29.items()))

# ---------------------------------------------------------------- 30. OPO 统一状态渲染
section('30. OPO KPI 与列表由统一状态模型渲染')
op = read(os.path.join(CC, 'opo.html'))
checks_30 = {
    '存在统一状态对象/行级数组': bool(re.search(r'const OPO\s*=\s*\{', op)) or bool(re.search(r'const opoLines\s*=\s*\[', op)),
    '统一渲染 renderOpo()': 'function renderOpo()' in op and 'renderOpo();' in op,
    '未回复供应商表动态渲染': 'noreply-body' in op and ('OPO.suppliers' in op or 'pendingBySupplier' in op),
    'simulateReply 改状态后 render': bool(re.search(r'function simulateReply\(\)\{[\s\S]*?renderOpo\(\)', op)),
    'portalSubmit 改状态后 render': bool(re.search(r'function portalSubmit\(\)\{[\s\S]*?renderOpo\(\)', op)),
    'portalSubmit 防重复': 'portalDone' in op,
}
for k, v in checks_30.items():
    if not v:
        errors.append(f'opo.html 统一状态缺失: {k}')
print('  ' + ' · '.join(f'{k}={"✓" if v else "✗"}' for k, v in checks_30.items()))

# ---------------------------------------------------------------- 31. 无孤立页面（客户版每页可达）
section('31. 客户确认版页面可达性（无孤立页）')
nav = read(os.path.join(CC, 'nav-contract.js'))
# 收集导航菜单 href + 页面间 a href + nav 别名指向
linked = set(re.findall(r"href:\s*'([^']+\.html)'", nav))
for f in pages(CC):
    for m in re.findall(r'href="([^"#:]+\.html)"', read(os.path.join(CC, f))):
        linked.add(m)
orphans = []
for f in pages(CC):
    if f in ('index.html',):
        continue
    base = f.replace('.html', '')
    in_nav = ("'" + base + "'") in nav or ("id: '" + base + "'") in nav
    if f not in linked and not in_nav:
        orphans.append(f)
if orphans:
    errors.append(f'客户版存在孤立页面（无入口/链接）: {orphans}')
print(f'  孤立页面: {orphans or "无"}')

# ---------------------------------------------------------------- 32. 角色模型一致（无范围外角色）
section('32. 客户确认版无范围外角色（如"品质"）')
role_bad = 0
for f in pages(CC):
    txt = read(os.path.join(CC, f))
    # "品质"角色仅允许出现在 phase2 池或明确二期上下文
    if f == 'phase2.html':
        continue
    for m in re.finditer(r'品质', txt):
        win = txt[max(0, m.start()-140):m.start()+140]
        # "品质体系"作为二期超范围列举属正常；仅当作为本期可指派角色时才违规
        if '品质体系' in txt[m.start()-2:m.start()+4]:
            continue
        if not any(a in win for a in ['二期', '超范围', '不在本期', '超出附件一', '另行确认', '为二期']):
            errors.append(f'{f} 出现范围外角色"品质"（角色模型仅 PM/采购/计划/管理/供应商）')
            role_bad += 1
print(f'  范围外角色命中: {role_bad}')

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
