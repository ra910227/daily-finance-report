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

SRC = Path("/Users/vovo/Desktop/VOVO/財經投資")
SITE = Path("/Users/vovo/Desktop/VOVO/財經投資/daily-finance-report-site")


def date_from_name(name):
    m = re.search(r'(\d{4})[-年](\d{2})[-月](\d{2})', name)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    m = re.search(r'(\d{4})(\d{2})(\d{2})', name)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    return "0000-00-00"


def sync_files():
    """Copy new/updated source files into the site repo's categorized folders."""
    copied = []

    # 財經日報
    dst = SITE / "reports"
    dst.mkdir(parents=True, exist_ok=True)
    for f in (SRC / "財經日報").glob("*.html"):
        target = dst / re.sub(r'_財經日報', '', f.name).replace('財經日報_', '')
        # normalize to YYYY-MM-DD.html
        d = date_from_name(f.name)
        target = dst / f"{d}.html"
        if not target.exists() or target.stat().st_mtime < f.stat().st_mtime:
            shutil.copy2(f, target)
            copied.append(str(target))

    # 個股小狐
    for ticker_dir in (SRC / "個股小狐").iterdir():
        if not ticker_dir.is_dir():
            continue
        dst = SITE / "stocks" / ticker_dir.name
        dst.mkdir(parents=True, exist_ok=True)
        for f in ticker_dir.glob("*.html"):
            target = dst / f.name
            if not target.exists() or target.stat().st_mtime < f.stat().st_mtime:
                shutil.copy2(f, target)
                copied.append(str(target))

    # 投資機構研究摘要
    dst = SITE / "research/institutions"
    dst.mkdir(parents=True, exist_ok=True)
    for f in (SRC / "研究報告/投資機構研究摘要").glob("*.html"):
        target = dst / f.name
        if not target.exists() or target.stat().st_mtime < f.stat().st_mtime:
            shutil.copy2(f, target)
            copied.append(str(target))

    # 今日板塊流動報告
    dst = SITE / "research/sector-flow"
    dst.mkdir(parents=True, exist_ok=True)
    for f in (SRC / "研究報告/產業趨勢研究摘要").glob("今日板塊流動報告*.html"):
        target = dst / f.name
        if not target.exists() or target.stat().st_mtime < f.stat().st_mtime:
            shutil.copy2(f, target)
            copied.append(str(target))

    # 美股資金流雙軌週報/報告
    dst = SITE / "research/capital-flow"
    dst.mkdir(parents=True, exist_ok=True)
    for f in (SRC / "研究報告/產業趨勢研究摘要").glob("美股資金流雙軌*.html"):
        target = dst / f.name
        if not target.exists() or target.stat().st_mtime < f.stat().st_mtime:
            shutil.copy2(f, target)
            copied.append(str(target))

    return copied


def link(href, label, date):
    return f'<li><a href="{quote(href)}"><span class="d">{date}</span>{html.escape(label)}</a></li>'


def build_index():
    sections = []

    items = []
    for f in sorted((SITE / "reports").glob("*.html")):
        d = date_from_name(f.name)
        items.append((d, link(f"reports/{f.name}", f"{d} 財經日報", d)))
    items.sort(key=lambda x: x[0], reverse=True)
    sections.append(("daily", "📰 財經日報", "每日8來源交叉比對國際財經重點、產業報告、今日焦點解讀、LWP組合觀察", items))

    items = []
    for ticker_dir in sorted((SITE / "stocks").iterdir()):
        if not ticker_dir.is_dir():
            continue
        ticker = ticker_dir.name
        for f in sorted(ticker_dir.glob("*.html")):
            d = date_from_name(f.name)
            m = re.search(r'個股小狐_(.+?)_' + re.escape(ticker), f.name)
            rtype = m.group(1) if m else "報告"
            items.append((d, link(f"stocks/{ticker}/{f.name}", f"{ticker}｜{rtype}", d)))
    items.sort(key=lambda x: x[0], reverse=True)
    sections.append(("stocks", "🦊 個股小狐", "個別股票深度研究、財報解析、財務健檢報告", items))

    items = []
    for f in sorted((SITE / "research/sector-flow").glob("*.html")):
        d = date_from_name(f.name)
        items.append((d, link(f"research/sector-flow/{f.name}", f"{d} 今日板塊流動報告", d)))
    for f in sorted((SITE / "research/capital-flow").glob("*.html")):
        d = date_from_name(f.name)
        label = f.stem.split("—")[0].strip() + f"（{d}）"
        items.append((d, link(f"research/capital-flow/{f.name}", label, d)))
    items.sort(key=lambda x: x[0], reverse=True)
    sections.append(("flow", "📊 板塊與資金流", "每日板塊流動報告（四層漏斗+潛力雷達）與美股資金流雙軌週報", items))

    items = []
    for f in sorted((SITE / "research/institutions").glob("*.html")):
        d = date_from_name(f.name)
        items.append((d, link(f"research/institutions/{f.name}", f"{d} 投資機構研究摘要", d)))
    items.sort(key=lambda x: x[0], reverse=True)
    sections.append(("institutions", "📚 機構研究摘要", "六大機構（JPM/GS/UBS/BlackRock/Apollo/Allianz）觀點彙整", items))

    all_dates = [it[0] for _, _, _, its in sections for it in its]
    latest = max(all_dates) if all_dates else "—"

    nav_html = "\n".join(
        f'<a href="#{key}" class="navlink">{title} <span class="count">{len(its)}</span></a>'
        for key, title, _, its in sections
    )

    section_html = ""
    for key, title, desc, items in sections:
        lis = "\n".join(i for _, i in items) if items else '<li class="empty">尚無報告</li>'
        section_html += f'''
<section id="{key}">
<h2>{title} <span class="count">· {len(items)} 篇</span></h2>
<div class="desc">{desc}</div>
<ul class="list">
{lis}
</ul>
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
body{{background:var(--bg); color:var(--text); font-family:-apple-system,BlinkMacSystemFont,"PingFang TC","Noto Sans TC",sans-serif; margin:0; padding:32px 16px 64px; line-height:1.6;}}
.wrap{{max-width:760px; margin:0 auto;}}
h1{{font-size:1.7rem; margin:0 0 6px;}}
.sub{{color:var(--sub); font-size:0.92rem; margin-bottom:8px;}}
.updated{{color:var(--sub); font-size:0.85rem; margin-bottom:24px;}}
.updated b{{color:var(--accent);}}
nav{{display:flex; flex-wrap:wrap; gap:8px; margin-bottom:32px; position:sticky; top:0; background:var(--bg); padding:10px 0; z-index:10;}}
.navlink{{font-size:0.85rem; color:var(--text); text-decoration:none; border:1px solid var(--border); background:var(--card); padding:6px 12px; border-radius:16px; display:inline-flex; align-items:center; gap:6px;}}
.navlink:hover{{border-color:var(--accent); color:var(--accent);}}
.navlink .count{{color:var(--sub); font-size:0.78rem;}}
section{{margin-bottom:40px;}}
h2{{font-size:1.15rem; margin:0 0 4px; padding-bottom:8px; border-bottom:2px solid var(--accent); color:var(--accent); display:flex; align-items:baseline; gap:8px;}}
h2 .count{{font-size:0.8rem; color:var(--sub); font-weight:400;}}
.desc{{color:var(--sub); font-size:0.85rem; margin:8px 0 14px;}}
.list{{list-style:none; padding:0; margin:0;}}
.list li{{margin-bottom:8px;}}
.list a{{display:flex; align-items:center; gap:10px; background:var(--card); border:1px solid var(--border); border-radius:10px; padding:11px 16px; text-decoration:none; color:var(--text); font-weight:600; font-size:0.92rem; transition:border-color .15s;}}
.list a:hover{{border-color:var(--accent);}}
.list .d{{color:var(--sub); font-weight:400; font-size:0.8rem; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; flex-shrink:0;}}
.list .empty{{color:var(--sub); font-size:0.88rem; font-style:italic;}}
</style>
</head>
<body>
<div class="wrap">
<h1>財經小狐｜投資研究專欄</h1>
<div class="sub">國際財經重點 · 個股深度研究 · 板塊資金流 · 機構研究摘要</div>
<div class="updated">最新 <b>{latest}</b> 更新於 {latest}</div>
<nav>
{nav_html}
</nav>
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
