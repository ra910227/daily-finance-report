#!/usr/bin/env python3
"""同步本機報告到 daily-finance-report-site 並重建分類首頁。
用法：python3 sync_and_publish.py
（git add/commit/push 由呼叫者另外執行，本腳本只負責複製檔案+重建 index.html）
"""
import re
import html
import shutil
from pathlib import Path
from urllib.parse import quote

from inject_toolkit import inject_into_file

SRC = Path("/Users/vovo/Desktop/VOVO/財經投資")
SITE = Path("/Users/vovo/Desktop/VOVO/財經投資/daily-finance-report-site")

# 永遠置頂、不參與日期排序的報告（檔名關鍵字比對）
PINNED_FIRST = ["長期研究資料庫索引"]

# research/long-term 資料夾裡，屬於「金融筆記」(自己的筆記/書摘/回測)而非「研究摘要」(彙整他人研究)的檔名關鍵字
# 2026-09-10 使用者要求把這幾類從研究摘要拆出獨立成金融筆記分類
NOTES_KEYWORDS = [
    "長期多空判斷準則", "標普500歷次熊市", "美股熊市落底判別手冊", "LTCMA2026投資架構整合報告",
    "四配置科技成長組合回測比較", "基礎模式逢低加碼策略回測", "定期投資討論",
]

# 個股小狐分組標題用「代號+簡稱」顯示(如「2308台達電」)，2026-09-11使用者要求。
# 各報告HTML的<title>標籤格式不一致(有些含公司名、有些沒有，尤其美股)，無法穩定用程式解析，
# 改用這份手動維護的對照表；新增股票代號時記得順手補一筆，查無對照表的ticker會直接只顯示代號。
STOCK_SHORT_NAMES = {
    "000660": "SK海力士",
    "2308": "台達電",
    "2313": "華通",
    "2382": "廣達",
    "2383": "台光電",
    "3081": "聯亞光電",
    "3324": "雙鴻",
    "4585": "達明機器人",
    "6274": "台燿科技",
    "6944": "兆聯實業",
    "AVGO": "博通",
    "BABA": "阿里巴巴",
    "GLW": "康寧",
    "NOW": "ServiceNow",
    "NVDA": "輝達",
    "OKLO": "Oklo",
    "PLTR": "Palantir",
    "SMR": "NuScale",
    "VST": "Vistra",
}


def stock_group_label(ticker):
    name = STOCK_SHORT_NAMES.get(ticker, "")
    return f"{ticker} {name}" if name else ticker


def date_pretty(d):
    m = re.match(r'(\d{4})-(\d{2})-(\d{2})', d or "")
    if not m:
        return d or ""
    return f"{m.group(1)}年{m.group(2)}月{m.group(3)}日"


def extract_excerpt(path, length=76):
    """抓報告內文前幾字當摘要：去除script/style/標籤後取前段文字，供首頁卡片顯示。"""
    try:
        raw = path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return ""
    raw = re.sub(r'<(script|style|title)\b[^>]*>.*?</\1>', ' ', raw, flags=re.S | re.I)
    raw = re.sub(r'<!--.*?-->', ' ', raw, flags=re.S)
    raw = re.sub(r'<[^>]+>', ' ', raw)
    raw = html.unescape(raw)
    raw = re.sub(r'\s+', ' ', raw).strip()
    raw = re.sub(r'^(財經小狐|個股小狐|投資機構研究摘要|產業趨勢研究摘要)[｜:：\s]*', '', raw)
    if len(raw) <= length:
        return raw
    return raw[:length].rstrip() + "…"


def date_from_name(name):
    m = re.search(r'(\d{4})[-年](\d{2})[-月](\d{2})', name)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    m = re.search(r'(\d{4})(\d{2})(\d{2})', name)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    # 本機慣用短年份前綴：YYMMDD_ 或 YYMM_（西元20xx年，缺日補01）
    m = re.match(r'(\d{2})(\d{2})(\d{2})_', name)
    if m:
        return f"20{m.group(1)}-{m.group(2)}-{m.group(3)}"
    m = re.match(r'(\d{2})(\d{2})_', name)
    if m:
        return f"20{m.group(1)}-{m.group(2)}-01"
    return "0000-00-00"


def clean_report_filename(name):
    """把本機短年份/自整理/六大機構等標籤轉成網站用的乾淨檔名：YYYYMMDD_標題.html"""
    stem = name[:-5] if name.lower().endswith(".html") else name
    yyyymmdd = date_from_name(name).replace("-", "")
    title = re.sub(r'^\d{2,8}_', '', stem)
    title = title.replace("自整理_", "").replace("六大機構_", "")
    return f"{yyyymmdd}_{title}.html"


def _copy_new(src_glob_dir, pattern, dst, rename=False):
    copied = []
    dst.mkdir(parents=True, exist_ok=True)
    for f in src_glob_dir.glob(pattern):
        target_name = clean_report_filename(f.name) if rename else f.name
        target = dst / target_name
        if not target.exists() or target.stat().st_mtime < f.stat().st_mtime:
            shutil.copy2(f, target)
            inject_into_file(target)
            copied.append(str(target))
    return copied


def sync_files():
    """Copy new/updated source files into the site repo's categorized folders."""
    copied = []

    # 財經日報 (normalize filenames to YYYY-MM-DD.html)
    dst = SITE / "reports"
    dst.mkdir(parents=True, exist_ok=True)
    for f in (SRC / "財經日報").glob("*.html"):
        d = date_from_name(f.name)
        target = dst / f"{d}.html"
        if not target.exists() or target.stat().st_mtime < f.stat().st_mtime:
            shutil.copy2(f, target)
            inject_into_file(target)
            copied.append(str(target))

    # 個股小狐（每個ticker一個子資料夾，原樣保留）
    for ticker_dir in (SRC / "個股小狐").iterdir():
        if not ticker_dir.is_dir():
            continue
        dst = SITE / "stocks" / ticker_dir.name
        copied += _copy_new(ticker_dir, "*.html", dst)

    # 研究摘要：投資機構研究摘要(六大機構週報，現存於 總體經濟/) + 產業趨勢研究摘要(現存於 產業研究/產業趨勢研究摘要/)
    #           + 長期研究(元大投顧研究報告摘要/投行研究摘要/長期多空判斷準則/LTCMA架構報告 現存於 總體經濟/；
    #             標普500歷次熊市/美股熊市落底判別手冊 現存於 財經書籍知識/；長期研究資料庫索引 現存於 研究報告/ 根目錄)
    # 2026-07-31資料夾重整後，六大類已無專屬子資料夾，改用檔名關鍵字從新分類資料夾中篩選
    copied += _copy_new(SRC / "研究報告/總體經濟", "*六大機構_投資機構研究摘要*.html", SITE / "research/institutions", rename=True)
    copied += _copy_new(SRC / "研究報告/產業研究/產業趨勢研究摘要", "*.html", SITE / "research/industry-trends")

    # 注意：不額外同步「研究報告/產業研究/」底下其他子資料夾(先進封裝/光通訊/電力產業等，多為PDF原始素材)。
    # 完成的個別產業深度報告一律走 paper-to-academic-report skill 產出、存到「研究報告/專題講義/{主題}/」，
    # 由下方「專題報告」的同步邏輯處理，不建立獨立的 research/industry/ 路徑（2026-09-10使用者裁示不需要這個資料夾）。

    for pattern in ["*元大投顧研究報告摘要*.html", "*投行研究摘要*.html",
                    "*長期多空判斷準則*.html", "*LTCMA2026投資架構整合報告*.html"]:
        copied += _copy_new(SRC / "研究報告/總體經濟", pattern, SITE / "research/long-term", rename=True)
    for pattern in ["*標普500歷次熊市*.html", "*美股熊市落底判別手冊*.html"]:
        copied += _copy_new(SRC / "研究報告/財經書籍知識", pattern, SITE / "research/long-term", rename=True)
    copied += _copy_new(SRC / "研究報告", "長期研究資料庫索引*.html", SITE / "research/long-term")

    # 策略回測與模擬（配置比較/加碼策略/定期投資討論等，現存於 市場分析/）
    for pattern in ["*四配置科技成長組合回測比較*.html", "*基礎模式逢低加碼策略回測*.html", "*定期投資討論*.html"]:
        copied += _copy_new(SRC / "研究報告/市場分析", pattern, SITE / "research/long-term", rename=True)

    # 今日板塊流動報告 / 美股資金流雙軌週報（現存於 市場分析/，一週內在頂層，較舊的在 歷史板塊資金報告/ 子資料夾）
    for base in [SRC / "研究報告/市場分析", SRC / "研究報告/市場分析/歷史板塊資金報告"]:
        copied += _copy_new(base, "今日板塊流動報告*.html", SITE / "research/sector-flow")
        copied += _copy_new(base, "美股資金流雙軌*.html", SITE / "research/capital-flow")

    # 市場診斷（模式一風險診斷＋模式四三池策略合併報告，現存於 市場分析/）
    copied += _copy_new(SRC / "研究報告/市場分析", "*市場診斷*.html", SITE / "research/market-diagnosis")

    # 專題講義（多堂課系列，每個子資料夾是一套課程，檔名以「01_」「02_」...開頭排序，不依日期）
    lectures_root = SRC / "研究報告/專題講義"
    if lectures_root.is_dir():
        for course_dir in lectures_root.iterdir():
            if not course_dir.is_dir():
                continue
            dst = SITE / "lectures" / course_dir.name
            copied += _copy_new(course_dir, "*.html", dst)

    return copied


def badges_row(href):
    """已閱讀比例／筆記數／星號評分，三者都是純前端從localStorage算出來顯示，
    這裡只輸出佔位符markup，實際數字由 gsfox-annotate.js 的 initReadNoteBadges() 填入。"""
    key = html.escape(href, quote=True)
    stars = "".join(f'<span class="gsfox-star" data-i="{i}">☆</span>' for i in (1, 2, 3))
    return (f'<span class="gsfox-badges" data-badges-key="{key}">'
            f'<span class="gsfox-read-badge" title="已閱讀比例">📖<span class="gsfox-read-pct"></span></span>'
            f'<span class="gsfox-note-badge" title="筆記數">📝<span class="gsfox-note-count"></span></span>'
            f'<span class="gsfox-star-row" data-star-key="{key}">{stars}</span>'
            f'</span>')


def card(href, tag, title, date, excerpt):
    """卡片式條目：分類tag／標題／內文摘要／日期，右上角疊加已閱讀比例/筆記數/星號評分。"""
    return (f'<div class="card-wrap">'
            f'<a class="article-card" href="{quote(href)}">'
            f'<span class="tag">{html.escape(tag)}</span>'
            f'<span class="title">{html.escape(title)}</span>'
            f'<span class="excerpt">{html.escape(excerpt)}</span>'
            f'<span class="date">{date_pretty(date)}</span>'
            f'</a>{badges_row(href)}</div>')


def build_index():
    # ---------- 蒐集五大分類的完整條目資料 ----------
    # 每個item: {date, tag, title, href, excerpt}
    market_items, stock_groups, research_pinned, research_items, lecture_groups, notes_items = [], [], [], [], [], []

    # 市場分析 = 財經日報 + 市場診斷 + 板塊與資金流（2026-09-10合併為一類）
    for f in sorted((SITE / "reports").glob("*.html")):
        d = date_from_name(f.name)
        market_items.append({"date": d, "tag": "市場分析", "title": "財經日報", "href": f"reports/{f.name}",
                              "excerpt": extract_excerpt(f)})
    for f in sorted((SITE / "research/market-diagnosis").glob("*.html")):
        d = date_from_name(f.name)
        market_items.append({"date": d, "tag": "市場分析", "title": "市場診斷＋三池策略",
                              "href": f"research/market-diagnosis/{f.name}", "excerpt": extract_excerpt(f)})
    for f in sorted((SITE / "research/sector-flow").glob("*.html")):
        d = date_from_name(f.name)
        market_items.append({"date": d, "tag": "市場分析", "title": "今日板塊流動報告",
                              "href": f"research/sector-flow/{f.name}", "excerpt": extract_excerpt(f)})
    for f in sorted((SITE / "research/capital-flow").glob("*.html")):
        d = date_from_name(f.name)
        label = f.stem.split("—")[0].strip()
        market_items.append({"date": d, "tag": "市場分析", "title": label,
                              "href": f"research/capital-flow/{f.name}", "excerpt": extract_excerpt(f)})
    market_items.sort(key=lambda x: x["date"], reverse=True)

    # 個股小狐（依公司分組，組內依日期新到舊）
    for ticker_dir in sorted((SITE / "stocks").iterdir()):
        if not ticker_dir.is_dir():
            continue
        ticker = ticker_dir.name
        t_items = []
        for f in sorted(ticker_dir.glob("*.html")):
            d = date_from_name(f.name)
            m = re.search(r'個股小狐_(.+?)_' + re.escape(ticker), f.name)
            rtype = m.group(1) if m else "報告"
            t_items.append({"date": d, "tag": "個股小狐", "title": f"{stock_group_label(ticker)}　{rtype}",
                             "href": f"stocks/{ticker}/{f.name}", "excerpt": extract_excerpt(f)})
        if not t_items:
            continue
        t_items.sort(key=lambda x: x["date"], reverse=True)
        stock_groups.append((stock_group_label(ticker), t_items))

    # 研究摘要 = 投資機構研究摘要 + 產業趨勢研究摘要 + (research/long-term 扣除金融筆記後剩下的元大/投行摘要與長期索引)
    for f in sorted((SITE / "research/institutions").glob("*.html")):
        d = date_from_name(f.name)
        research_items.append({"date": d, "tag": "研究摘要", "title": "投資機構研究摘要",
                                "href": f"research/institutions/{f.name}", "excerpt": extract_excerpt(f)})
    for f in sorted((SITE / "research/industry-trends").glob("*.html")):
        d = date_from_name(f.name)
        research_items.append({"date": d, "tag": "研究摘要", "title": "產業趨勢研究摘要",
                                "href": f"research/industry-trends/{f.name}", "excerpt": extract_excerpt(f)})
    for f in sorted((SITE / "research/long-term").glob("*.html")):
        d = date_from_name(f.name)
        title = re.sub(r'^\d{8}_|_\d{8}$|_\d{4}[-年]\d{2}[-月]\d{2}日?$', '', f.stem)
        href = f"research/long-term/{f.name}"
        is_note = any(k in f.name for k in NOTES_KEYWORDS)
        is_pinned = any(k in f.name for k in PINNED_FIRST)
        item = {"date": d, "tag": "金融筆記" if is_note else "研究摘要",
                "title": f"⭐ {title}" if is_pinned else title, "href": href, "excerpt": extract_excerpt(f)}
        if is_note:
            notes_items.append(item)
        elif is_pinned:
            research_pinned.append(item)
        else:
            research_items.append(item)
    research_items.sort(key=lambda x: x["date"], reverse=True)
    notes_items.sort(key=lambda x: x["date"], reverse=True)

    # 專題報告（原「專題講義」，依課程/主題分組）。
    # 檔名有兩種可能：多堂課系列用1-2位數堂數前綴(如「01_殖利率曲線」→第1堂，不顯示日期)；
    # 單篇深度報告(paper-to-academic-report產出)用6-8位數日期前綴(如「260909_能源_核能新時代學術報告」)，
    # 這種前綴是發表日期不是堂數，標題只去掉日期本身、保留後面的「產業領域_報告名稱」，並正常顯示/參與日期排序。
    lectures_dir = SITE / "lectures"
    if lectures_dir.is_dir():
        for course_dir in sorted(lectures_dir.iterdir()):
            if not course_dir.is_dir():
                continue
            course = course_dir.name
            l_items = []
            for f in sorted(course_dir.glob("*.html")):
                m_lecture = re.match(r'(\d{1,2})_(.+)\.html$', f.name)
                m_dated = re.match(r'(\d{6,8})_(.+)\.html$', f.name)
                if m_lecture and not m_dated:
                    num, title = m_lecture.group(1), m_lecture.group(2)
                    l_items.append({"sort": f.name, "date": "", "tag": "專題報告",
                                     "title": f"第{int(num)}堂　{title}",
                                     "href": f"lectures/{course}/{f.name}", "excerpt": extract_excerpt(f)})
                elif m_dated:
                    d = date_from_name(f.name)
                    l_items.append({"sort": f.name, "date": d, "tag": "專題報告", "title": m_dated.group(2),
                                     "href": f"lectures/{course}/{f.name}", "excerpt": extract_excerpt(f)})
                else:
                    l_items.append({"sort": f.name, "date": "", "tag": "專題報告", "title": f.stem,
                                     "href": f"lectures/{course}/{f.name}", "excerpt": extract_excerpt(f)})
            if not l_items:
                continue
            l_items.sort(key=lambda x: x["sort"])
            lecture_groups.append((course, l_items))

    # ---------- 首頁最上方「最新文章」：跨五大分類合併，依日期新到舊取前15篇 ----------
    all_dated = [it for it in (market_items + research_items + notes_items) if it["date"] != "0000-00-00"]
    for _, items in stock_groups:
        all_dated += [it for it in items if it["date"] != "0000-00-00"]
    for _, items in lecture_groups:
        all_dated += [it for it in items if it["date"] not in ("", "0000-00-00")]
    all_dated.sort(key=lambda x: x["date"], reverse=True)
    latest_items = all_dated[:15]
    latest = all_dated[0]["date"] if all_dated else "—"

    def grid(items):
        return '<div class="card-grid">' + "\n".join(
            card(it["href"], it["tag"], it["title"], it["date"], it["excerpt"]) for it in items
        ) + '</div>' if items else '<p class="empty">尚無報告</p>'

    def grouped_grid(groups):
        blocks = []
        for name, items in groups:
            blocks.append(f'<h3>{html.escape(name)}</h3>\n' + grid(items))
        return "\n".join(blocks) if blocks else '<p class="empty">尚無報告</p>'

    stock_count = sum(len(items) for _, items in stock_groups)
    lecture_count = sum(len(items) for _, items in lecture_groups)
    research_count = len(research_pinned) + len(research_items)

    sections = [
        ("market", "🧭 市場分析", "每日財經重點、21項指標市場診斷、板塊資金流與美股資金流雙軌週報",
         grid(market_items), len(market_items)),
        ("stocks", "🦊 個股小狐", "個別股票深度研究、財報解析、財務健檢報告，依公司分類",
         grouped_grid(stock_groups), stock_count),
        ("research", "📚 研究摘要", "六大機構觀點彙整、產業趨勢摘要、長期研究資料庫索引、券商投顧報告",
         grid(research_pinned + research_items), research_count),
        ("lectures", "📜 專題報告", "系統性主題課程講義與個別產業深度分析報告，依主題/堂數分類",
         grouped_grid(lecture_groups), lecture_count),
        ("notes", "🗒️ 金融筆記", "自己整理的閱讀筆記、書籍重點與投資組合回測分析",
         grid(notes_items), len(notes_items)),
    ]

    nav_html = "\n".join(
        f'<a href="{href}" class="navlink">{title}</a>'
        for href, title in [
            ("#top", "首頁"), ("#market", "市場分析"), ("#stocks", "個股小狐"),
            ("#research", "研究摘要"), ("#lectures", "專題報告"), ("#notes", "金融筆記"),
        ]
    )

    latest_html = grid(latest_items)

    section_html = ""
    for key, title, desc, body_html, count in sections:
        section_html += f'''
<section id="{key}">
<h2>{title} <span class="count">· {count} 篇</span></h2>
<div class="desc">{desc}</div>
{body_html}
</section>
'''

    page = f'''<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>財經小狐｜投資研究專欄</title>
<style>
:root{{
  --bg:#f5f6f8; --card:#ffffff; --text:#1a1d23; --sub:#5b6270; --border:#e2e5ea; --accent:#1a56db;
}}
@media (prefers-color-scheme: dark){{
  :root{{ --bg:#14161a; --card:#1e2128; --text:#e5e7eb; --sub:#9aa1ad; --border:#2d313a; --accent:#5b9dff; }}
}}
*{{box-sizing:border-box;}}
body{{background:var(--bg); color:var(--text); font-family:-apple-system,BlinkMacSystemFont,"PingFang TC","Noto Sans TC",sans-serif; margin:0; padding:32px 20px 64px; line-height:1.6;}}
.wrap{{max-width:1120px; margin:0 auto;}}
h1{{font-size:1.7rem; margin:0 0 6px;}}
.header-row{{display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px 16px; margin-bottom:8px;}}
.sub{{color:var(--sub); font-size:0.92rem;}}
.updated{{color:var(--sub); font-size:0.85rem; margin-bottom:24px;}}
.updated b{{color:var(--accent);}}
nav{{display:flex; flex-wrap:wrap; gap:4px 22px; margin-bottom:36px; position:sticky; top:0; background:var(--bg); padding:14px 0; z-index:10; border-bottom:1px solid var(--border);}}
.navlink{{font-size:0.9rem; color:var(--sub); text-decoration:none; letter-spacing:0.02em;}}
.navlink:hover{{color:var(--accent);}}
section{{margin-bottom:52px; scroll-margin-top:64px;}}
h2{{font-size:1.3rem; margin:0 0 4px; padding-bottom:10px; border-bottom:2px solid var(--accent); color:var(--text); display:flex; align-items:baseline; gap:8px;}}
h2 .count{{font-size:0.78rem; color:var(--sub); font-weight:400;}}
h3{{font-size:0.95rem; margin:22px 0 12px; color:var(--sub); font-weight:600;}}
.desc{{color:var(--sub); font-size:0.85rem; margin:10px 0 20px;}}
.empty{{color:var(--sub); font-size:0.88rem; font-style:italic;}}

/* ---- 卡片式文章列表 ---- */
.card-grid{{display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:28px 24px;}}
.card-wrap{{position:relative;}}
.article-card{{display:flex; flex-direction:column; gap:6px; text-decoration:none; color:inherit; height:100%;}}
.article-card .tag{{font-size:0.72rem; letter-spacing:0.06em; color:var(--accent); font-weight:600; text-transform:uppercase; padding-right:132px;}}
.article-card .title{{font-size:1.05rem; font-weight:700; color:var(--text); line-height:1.4; padding-right:132px;}}
.article-card:hover .title{{color:var(--accent);}}
.article-card .excerpt{{font-size:0.86rem; color:var(--sub); line-height:1.65; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden;}}
.article-card .date{{font-size:0.78rem; color:var(--sub); font-weight:700; margin-top:4px;}}
</style>
<link rel="stylesheet" href="assets/gsfox-annotate.css">
<script src="assets/gsfox-annotate.js" defer></script>
<!-- gsfox-annotate:injected -->
</head>
<body class="gsfox-index">
<div class="wrap" id="top">
<h1>財經小狐｜投資研究專欄</h1>
<div class="header-row">
  <div class="sub">國際財經重點 · 個股深度研究 · 板塊資金流 · 研究摘要</div>
  <div class="gsfox-sync-box">
    <span class="gsfox-sync-label">☁️ 雲端同步：</span>
    <input type="text" data-role="sync-code-input" placeholder="輸入你自己的同步碼">
    <button data-act="sync-connect">連接</button>
    <button data-act="sync-disconnect" class="gsfox-ghost" hidden>中斷連接</button>
    <span class="gsfox-sync-status" data-role="sync-status"></span>
  </div>
</div>
<div class="updated">最新 <b>{date_pretty(latest)}</b></div>
<nav>
{nav_html}
</nav>

<section id="latest">
<h2>🆕 最新文章</h2>
<div class="desc">跨所有分類，依日期新到舊排列</div>
{latest_html}
</section>
{section_html}
</div>
</body>
</html>
'''
    (SITE / "index.html").write_text(page, encoding="utf-8")
    return latest


if __name__ == "__main__":
    copied = sync_files()
    latest = build_index()
    print(f"Copied {len(copied)} new/updated file(s):")
    for c in copied:
        print(" -", c)
    print(f"index.html rebuilt, latest date = {latest}")
