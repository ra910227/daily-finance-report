#!/usr/bin/env python3
"""把 gsfox-annotate 共用工具(畫重點/筆記/星號評分)注入現有或新複製的報告HTML檔案。
用法(一次性補齊全站既有檔案)：python3 inject_toolkit.py
被 sync_and_publish.py import 後，每次複製新檔案時也會自動呼叫 inject_into_file()。
"""
from pathlib import Path

SITE = Path("/Users/vovo/Desktop/VOVO/財經投資/daily-finance-report-site")
MARKER = "<!-- gsfox-annotate:injected -->"


def rel_prefix(path: Path) -> str:
    """算出從這個檔案回到 site 根目錄的相對路徑前綴，例如 stocks/OKLO/x.html -> ../../"""
    depth = len(path.relative_to(SITE).parts) - 1
    return "../" * depth


def toolkit_tags(path: Path) -> str:
    prefix = rel_prefix(path)
    return (
        f'<link rel="stylesheet" href="{prefix}assets/gsfox-annotate.css">\n'
        f'<script src="{prefix}assets/gsfox-annotate.js" defer></script>\n'
        f'{MARKER}\n'
    )


def inject_into_file(path: Path) -> bool:
    """回傳 True 代表這次有實際修改檔案。已注入過的檔案(含MARKER)直接略過，可重複執行。

    有些報告是「無頭尾骨架」的片段檔(無<html>/<head>/<body>，只有 meta+title+style
    後直接接內容，常見於 artifact 系skill的輸出)，這類檔案退而求其次插在<body>之前，
    再退而求其次插在最後一個</style>之後——瀏覽器解析時仍會落在隱含的head範圍內。
    """
    try:
        text = path.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        return False
    if MARKER in text:
        return False

    tags = toolkit_tags(path)
    if "</head>" in text:
        new_text = text.replace("</head>", tags + "</head>", 1)
    elif "<body" in text:
        new_text = text.replace("<body", tags + "<body", 1)
    else:
        idx = text.rfind("</style>")
        if idx == -1:
            return False
        insert_at = idx + len("</style>")
        new_text = text[:insert_at] + "\n" + tags + text[insert_at:]

    path.write_text(new_text, encoding="utf-8")
    return True


def backfill_all():
    changed = 0
    for sub in ["reports", "stocks", "research", "lectures"]:
        base = SITE / sub
        if not base.is_dir():
            continue
        for f in base.rglob("*.html"):
            if inject_into_file(f):
                changed += 1
    return changed


if __name__ == "__main__":
    n = backfill_all()
    print(f"已為 {n} 個既有報告檔案注入 gsfox-annotate 工具列（已注入過的檔案自動略過）")
