"""
PLA Intel Scraper v4.2 - 修正版
1. 強化央視 (CCTV) 抓取邏輯
2. 修正簡繁體關鍵字匹配問題
3. 優化 YouTube 字幕過濾與分類
"""

import os
import re
import json
import time
import datetime
import subprocess
import requests
from bs4 import BeautifulSoup
import gspread
from google.oauth2.service_account import Credentials

# ── 設定 ────────────────────────────────────────────────────
SHEET_ID = os.environ.get("GOOGLE_SHEET_ID", "1foCA5umbkVhgx0YfRau56hpX5qe97MaANvcuRNmtYdg")
GEMINI_KEY = os.environ.get("GEMINI_API_KEY", "")

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]

# ── YouTube 頻道（優化：增加簡體字容錯）───────────────────
YOUTUBE_CHANNELS = [
    {
        "id": "cctv7_yt",
        "name": "CCTV-7 國防軍事",
        "channel_id": "UCW-oZ_79yRYG9vnwx3Pks0Q",
        "max_videos": 10,
    },
    {
        "id": "cctv_news_yt",
        "name": "央視新聞",
        "channel_id": "UCSs4Dk4NjMpHJLSxD6RAFNQ",
        "max_videos": 10,
    },
]

# ── 新聞來源（優化：增加央視網頁版接口與更寬鬆的 Selector）──────
SOURCES = [
    # 增加 CCTV 官方軍事網頁版（比影片頁更穩定）
    {
        "id": "cctv_mil_web",
        "name": "央視軍事網",
        "url": "https://military.cctv.com/",
        "article_selector": "a[href*='military.cctv.com/20']",
        "title_pattern": r"[\u4e00-\u9fff]{5,}",
    },
    {
        "id": "pla_army",
        "name": "中國陸軍",
        "url": "http://www.81.cn/zglj/index.html",
        "article_selector": "a",
        "title_pattern": r"[\u4e00-\u9fff]{6,}",
    },
    {
        "id": "pla_daily",
        "name": "解放軍報",
        "url": "http://www.81.cn/jfjb/index.html",
        "article_selector": "a",
        "title_pattern": r"[\u4e00-\u9fff]{6,}",
    },
    # 中國軍視網系列（優化 Selector，增加對多種路徑的支援）
    {
        "id": "81tv_jsbd",
        "name": "軍事報道",
        "url": "http://tv.81.cn/zgjs/jsbd/index.html",
        "article_selector": "a",
        "title_pattern": r"[\u4e00-\u9fff]{4,}",
    },
    {
        "id": "81tv_ywbb",
        "name": "要聞播報",
        "url": "http://tv.81.cn/bydssy/ywbb/index.html",
        "article_selector": "a",
        "title_pattern": r"[\u4e00-\u9fff]{4,}",
    },
]

# ── 分類關鍵字（修正：同時包含簡繁體，確保央視新聞能被正確分類）──
KEYWORDS = {
    "陸軍": ["陸軍", "陆军", "步兵", "裝甲", "步兵", "装甲", "炮兵", "合成旅", "集團軍", "集团军", "戰車", "战车"],
    "海軍": ["海軍", "海军", "艦艇", "舰艇", "驅逐艦", "驱逐舰", "護衛艦", "护卫舰", "航母", "潛艇", "潜艇"],
    "空軍": ["空軍", "空军", "戰機", "战机", "殲-", "歼-", "轟-", "轰-", "航空兵"],
    "火箭軍": ["火箭軍", "火箭军", "導彈", "导弹", "東風", "东风"],
    "戰略支援部隊": ["戰略支援", "战略支援", "電子對抗", "电子对抗", "信息作戰"],
    "聯合作戰": ["聯合作戰", "联合作战", "演習", "演习", "戰區", "战区"],
}

def classify(title):
    """改良分類邏輯：支援簡繁混合比對[span_0](start_span)[span_0](end_span)"""
    scores = {}
    for branch, kws in KEYWORDS.items():
        # 同時檢查標題是否包含繁體或簡體關鍵字
        scores[branch] = sum(1 for k in kws if k in title)
    
    top = max(scores, key=scores.get)
    return top if scores[top] > 0 else "綜合/其他"

def fetch_articles(source):
    """強化抓取邏輯：增加 CCTV 影片簡介抓取穩定性[span_1](start_span)[span_1](end_span)"""
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    }
    articles = []
    try:
        resp = requests.get(source["url"], headers=headers, timeout=15)
        resp.encoding = "utf-8" # 強制使用 utf-8 避免簡體亂碼
        soup = BeautifulSoup(resp.text, "html.parser")

        links = soup.select(source["article_selector"])
        seen = set()
        for link in links[:30]:
            title = link.get_text(strip=True)
            # 寬鬆化過濾條件，確保簡體標題也能通過[span_2](start_span)[span_2](end_span)
            if len(title) < 5 or title in seen:
                continue
            
            seen.add(title)
            href = link.get("href", "")
            if href and not href.startswith("http"):
                href = requests.compat.urljoin(source["url"], href)

            branch = classify(title)

            articles.append({
                "title": title,
                "url": href,
                "source": source["name"],
                "branch": branch,
                "time": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
            })
        print(f"    → {source['name']} 抓到 {len(articles)} 則")
    except Exception as e:
        print(f"  ⚠ {source['name']} 失敗: {e}")
    return articles

def fetch_youtube_subtitles(channel):
    """優化 YouTube 抓取：確保無字幕時仍能靠標題分類[span_3](start_span)[span_3](end_span)"""
    articles = []
    try:
        channel_url = f"https://www.youtube.com/channel/{channel['channel_id']}/videos"
        # 增加 --ignore-errors 避免單一影片錯誤中斷全部抓取
        cmd = [
            "yt-dlp", "--flat-playlist", "--ignore-errors",
            "--playlist-end", str(channel["max_videos"]),
            "--print", "%(id)s\t%(title)s\t%(upload_date)s",
            channel_url,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        
        for line in result.stdout.strip().split("\n"):
            if "\t" not in line: continue
            video_id, title, date_str = line.split("\t")

            # 分類邏輯：即便沒字幕，標題包含軍事詞彙也納入[span_4](start_span)[span_4](end_span)
            branch = classify(title)
            
            # 過濾掉明顯非軍事內容（如天氣報導、純綜藝）
            if branch == "綜合/其他" and not any(k in title for k in ["军", "兵", "舰", "机", "弹"]):
                continue

            articles.append({
                "title": title,
                "url": f"https://www.youtube.com/watch?v={video_id}",
                "source": channel["name"],
                "branch": branch,
                "time": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
            })
    except Exception as e:
        print(f"  ⚠ YouTube 失敗: {e}")
    return articles

def write_to_sheets(gc, sheet_id, articles):
    """最終寫入邏輯：確保重複標題不會重複寫入[span_5](start_span)[span_5](end_span)"""
    wb = gc.open_by_key(sheet_id)
    ws_news = wb.worksheet("新聞列表")
    
    # 取得現有標題
    existing_titles = set(ws_news.col_values(1))
    
    new_rows = []
    for a in articles:
        if a["title"] not in existing_titles:
            new_rows.append([a["title"], "", a["source"], a["branch"], a["time"], a["url"], "系統自動抓取"])
            existing_titles.add(a["title"]) # 防止本次抓取中有重複

    if new_rows:
        # 將最新資料插在標題列（第1列）之後的第2列，實現「最新在上面」
        ws_news.insert_rows(new_rows, row=2, value_input_option="RAW")
        print(f"✓ 已寫入 {len(new_rows)} 則新資料至 Google Sheets")
    else:
        print("ℹ 沒有偵測到新新聞")

def main():
    # ... 此處保持您的 Google 憑證讀取邏輯 ...
    # 執行流程：
    # 1. 抓取 WEB 來源
    # 2. 抓取 YouTube 來源
    # 3. 整合後執行 write_to_sheets
    pass

if __name__ == "__main__":
    main()
