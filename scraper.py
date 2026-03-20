"""
PLA Intel Scraper
自動抓取解放軍相關新聞，分類後寫入 Google Sheets
"""

import os
import re
import json
import time
import datetime
import requests
from bs4 import BeautifulSoup
import gspread
from google.oauth2.service_account import Credentials

# ── 設定 ────────────────────────────────────────────────────
SHEET_ID = os.environ.get("GOOGLE_SHEET_ID", "")  # 從 GitHub Secrets 取得
GEMINI_KEY = os.environ.get("GEMINI_API_KEY", "")  # 選填，用於 AI 分類

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]

# ── 新聞來源 ─────────────────────────────────────────────────
SOURCES = [
    {
        "id": "pla_daily",
        "name": "解放軍報",
        "url": "http://www.81.cn/jfjb/index.html",
        "article_selector": "a",
        "title_pattern": r"[\u4e00-\u9fff]{8,}",
    },
    {
        "id": "mod_gov",
        "name": "國防部",
        "url": "http://www.mod.gov.cn/gfbw/qwfb/index.html",
        "article_selector": ".arti-title a, .news-list a",
        "title_pattern": r"[\u4e00-\u9fff]{8,}",
    },
    {
        "id": "chinamil",
        "name": "中國軍網",
        "url": "http://www.chinamil.com.cn/",
        "article_selector": ".news-list a, h3 a, h4 a",
        "title_pattern": r"[\u4e00-\u9fff]{8,}",
    },
    {
        "id": "xinhua_mil",
        "name": "新華軍事",
        "url": "http://military.news.cn/",
        "article_selector": "a",
        "title_pattern": r"[\u4e00-\u9fff]{8,}",
    },
    {
        "id": "guofang_bao",
        "name": "國防報",
        "url": "http://www.81.cn/gfb/index.html",
        "article_selector": "a",
        "title_pattern": r"[\u4e00-\u9fff]{8,}",
    },
]

# ── 分類關鍵字 ───────────────────────────────────────────────
KEYWORDS = {
    "陸軍":         ["陸軍","步兵","裝甲","炮兵","山地","特種作戰","兩棲","機械化","合成旅"],
    "海軍":         ["海軍","艦艇","驅逐艦","護衛艦","航母","潛艇","水面艦","海上","渡海","反潛"],
    "空軍":         ["空軍","戰機","殲-","轟-","運-","直升機","飛行員","航空","制空"],
    "火箭軍":       ["火箭軍","導彈","彈道","洲際","巡航導彈","精確打擊"],
    "戰略支援部隊": ["戰略支援","衛星","太空","網絡","電磁","電子對抗","偵察"],
    "聯合作戰":     ["聯合","戰區","多軍種","協同","聯演"],
}

EQ_PATTERNS = [
    (r"殲-?(\d+[A-Z]*)", "戰機",     lambda m: "殲-"+m.group(1)),
    (r"轟-?(\d+[A-Z]*)", "轟炸機",   lambda m: "轟-"+m.group(1)),
    (r"運-?(\d+[A-Z]*)", "運輸機",   lambda m: "運-"+m.group(1)),
    (r"直-?(\d+[A-Z]*)", "直升機",   lambda m: "直-"+m.group(1)),
    (r"(\d+)型(驅逐艦|護衛艦|潛艇|護衛艦)", None, lambda m: m.group(1)+"型"+m.group(2)),
    (r"東風-?(\d+[A-Z]*)", "彈道導彈", lambda m: "東風-"+m.group(1)),
    (r"紅旗-?(\d+[A-Z]*)", "防空導彈", lambda m: "紅旗-"+m.group(1)),
    (r"航母|航空母艦", "航母",  lambda m: "航母"),
    (r"驅逐艦",      "驅逐艦", lambda m: "驅逐艦"),
    (r"護衛艦",      "護衛艦", lambda m: "護衛艦"),
    (r"潛艇",        "潛艇",   lambda m: "潛艇"),
    (r"巡航導彈",    "巡航導彈", lambda m: "巡航導彈"),
    (r"衛星",        "衛星",   lambda m: "衛星"),
    (r"北斗",        "導航系統", lambda m: "北斗"),
]

UNIT_PATTERNS = [
    r"([東西南北中]+部戰區)",
    r"([^\s，。、]{2,6}軍(?:區|團|旅|師|營|連|排))",
    r"([^\s，。、]{2,8}(?:艦隊|基地|部隊|分隊|大隊|中隊|支隊))",
    r"([^\s，。、]{2,6}旅)",
    r"(維和(?:部隊)?)",
]

TITLE_PATTERNS = [
    (r"司令(?:員)?", "司令員"),
    (r"政治委員|政委", "政治委員"),
    (r"參謀長", "參謀長"),
    (r"旅長", "旅長"),
    (r"艦長", "艦長"),
    (r"飛行員", "飛行員"),
    (r"士兵|戰士", "士兵"),
    (r"指揮員", "指揮員"),
    (r"維和(?:士兵|人員)?", "維和人員"),
]


def classify(title):
    scores = {}
    for branch, kws in KEYWORDS.items():
        scores[branch] = sum(1 for k in kws if k in title)
    top = max(scores, key=scores.get)
    return top if scores[top] > 0 else "綜合/其他"


def find_unit(title):
    for pat in UNIT_PATTERNS:
        m = re.search(pat, title)
        if m:
            return m.group(1) if m.lastindex else m.group(0)
    return ""


def extract_equipment(title, branch):
    results = []
    for pat, eq_type, name_fn in EQ_PATTERNS:
        for m in re.finditer(pat, title):
            model = name_fn(m)
            t = eq_type or (m.group(2) if m.lastindex and m.lastindex >= 2 else "裝備")
            if model and not any(r["model"] == model for r in results):
                results.append({"model": model, "type": t, "unit": find_unit(title), "branch": branch})
    return results


def extract_personnel(title, branch):
    results = []
    for pat, title_name in TITLE_PATTERNS:
        if re.search(pat, title) and not any(r["title"] == title_name for r in results):
            results.append({"unit": find_unit(title), "title": title_name, "name": "", "branch": branch})
    if not results:
        unit = find_unit(title)
        if unit:
            results.append({"unit": unit, "title": "—", "name": "", "branch": branch})
    return results


def fetch_articles(source):
    """抓取單一來源的新聞列表"""
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "zh-TW,zh;q=0.9",
    }
    articles = []
    try:
        resp = requests.get(source["url"], headers=headers, timeout=15)
        resp.encoding = resp.apparent_encoding
        soup = BeautifulSoup(resp.text, "html.parser")
        links = soup.select(source["article_selector"])
        seen = set()
        for link in links[:30]:
            title = link.get_text(strip=True)
            if not re.search(source["title_pattern"], title):
                continue
            if len(title) < 8 or title in seen:
                continue
            seen.add(title)
            href = link.get("href", "")
            if href and not href.startswith("http"):
                base = "/".join(source["url"].split("/")[:3])
                href = base + "/" + href.lstrip("/")
            branch = classify(title)
            article = {
                "title": title,
                "url": href or source["url"],
                "source": source["name"],
                "branch": branch,
                "time": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
            }
            articles.append(article)
    except Exception as e:
        print(f"  ⚠ 抓取 {source['name']} 失敗：{e}")
    return articles


def write_to_sheets(gc, sheet_id, articles):
    """寫入 Google Sheets，分三個工作表"""
    wb = gc.open_by_key(sheet_id)

    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")

    # ── 新聞列表 ──
    try:
        ws_news = wb.worksheet("新聞列表")
    except gspread.exceptions.WorksheetNotFound:
        ws_news = wb.add_worksheet("新聞列表", rows=1000, cols=6)
        ws_news.append_row(["標題", "來源", "軍種", "時間", "連結", "更新時間"])

    news_rows = [[a["title"], a["source"], a["branch"], a["time"], a["url"], now] for a in articles]
    if news_rows:
        ws_news.append_rows(news_rows, value_input_option="RAW")

    # ── 人資資料表 ──
    try:
        ws_per = wb.worksheet("人資資料表")
    except gspread.exceptions.WorksheetNotFound:
        ws_per = wb.add_worksheet("人資資料表", rows=1000, cols=7)
        ws_per.append_row(["部隊單位", "職稱/職務", "姓名", "軍種", "備註", "新聞標題", "來源"])

    per_rows = []
    for a in articles:
        for p in extract_personnel(a["title"], a["branch"]):
            per_rows.append([p["unit"], p["title"], p["name"], p["branch"], a["title"][:30], a["title"], a["source"]])
    if per_rows:
        ws_per.append_rows(per_rows, value_input_option="RAW")

    # ── 裝備資料表 ──
    try:
        ws_eq = wb.worksheet("裝備資料表")
    except gspread.exceptions.WorksheetNotFound:
        ws_eq = wb.add_worksheet("裝備資料表", rows=1000, cols=7)
        ws_eq.append_row(["武器/裝備型號", "類型", "使用單位", "軍種", "備註", "新聞標題", "來源"])

    eq_rows = []
    for a in articles:
        for e in extract_equipment(a["title"], a["branch"]):
            eq_rows.append([e["model"], e["type"], e["unit"], e["branch"], "", a["title"], a["source"]])
    if eq_rows:
        ws_eq.append_rows(eq_rows, value_input_option="RAW")

    print(f"✓ 寫入 {len(news_rows)} 則新聞、{len(per_rows)} 筆人資、{len(eq_rows)} 筆裝備")


def main():
    print(f"=== PLA Intel Scraper 啟動 {datetime.datetime.now()} ===")

    # 讀取 Google 憑證（從環境變數）
    creds_json = os.environ.get("GOOGLE_CREDENTIALS_JSON", "")
    if not creds_json:
        print("❌ 未設定 GOOGLE_CREDENTIALS_JSON")
        return
    if not SHEET_ID:
        print("❌ 未設定 GOOGLE_SHEET_ID")
        return

    creds_dict = json.loads(creds_json)
    creds = Credentials.from_service_account_info(creds_dict, scopes=SCOPES)
    gc = gspread.authorize(creds)

    # 抓取各來源
    all_articles = []
    for src in SOURCES:
        print(f"  抓取 {src['name']}...")
        arts = fetch_articles(src)
        print(f"    → {len(arts)} 則")
        all_articles.extend(arts)
        time.sleep(2)  # 避免太快

    print(f"\n共抓到 {len(all_articles)} 則新聞")

    if all_articles:
        write_to_sheets(gc, SHEET_ID, all_articles)

    print("=== 完成 ===")


if __name__ == "__main__":
    main()
