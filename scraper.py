"""
PLA Intel Scraper
自動抓取解放軍相關新聞與 YouTube 字幕，分類後寫入 Google Sheets
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
SHEET_ID = os.environ.get("GOOGLE_SHEET_ID", "")
GEMINI_KEY = os.environ.get("GEMINI_API_KEY", "")

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]

# ── YouTube 頻道（只抓字幕，不下載影片）───────────────────
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

# ── 新聞來源 ─────────────────────────────────────────────────
SOURCES = [
    # ── 陸軍專屬來源（最重要）──────────────────────────────
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
    {
        "id": "mod_gov",
        "name": "國防部",
        "url": "http://www.mod.gov.cn/gfbw/qwfb/index.html",
        "article_selector": ".arti-title a, .news-list a",
        "title_pattern": r"[\u4e00-\u9fff]{6,}",
    },
    {
        "id": "chinamil",
        "name": "中國軍網",
        "url": "http://www.chinamil.com.cn/",
        "article_selector": ".news-list a, h3 a, h4 a",
        "title_pattern": r"[\u4e00-\u9fff]{6,}",
    },
    {
        "id": "xinhua_mil",
        "name": "新華軍事",
        "url": "http://military.news.cn/",
        "article_selector": "a",
        "title_pattern": r"[\u4e00-\u9fff]{6,}",
    },
    {
        "id": "guofang_bao",
        "name": "國防報",
        "url": "http://www.81.cn/gfb/index.html",
        "article_selector": "a",
        "title_pattern": r"[\u4e00-\u9fff]{6,}",
    },
    # ── 中國軍視網（tv.81.cn）— 有實際內容，靜態 HTML ────────
    {
        "id": "81tv_jsbd",
        "name": "軍事報道",
        "url": "http://tv.81.cn/zgjs/jsbd/index.html",
        "article_selector": "a[href*='.html']",
        "title_pattern": r"[\u4e00-\u9fff]{4,}|军事报道",
    },
    {
        "id": "81tv_jsjs",
        "name": "軍事紀實",
        "url": "http://tv.81.cn/zgjs/jsjs/index.html",
        "article_selector": "a[href*='.html']",
        "title_pattern": r"[\u4e00-\u9fff]{4,}",
    },
    {
        "id": "81tv_jwt",
        "name": "講武堂",
        "url": "http://tv.81.cn/zgjs/jwt/index.html",
        "article_selector": "a[href*='.html']",
        "title_pattern": r"[\u4e00-\u9fff]{4,}",
    },
    {
        "id": "81tv_fwxgc",
        "name": "防務新觀察",
        "url": "http://tv.81.cn/zgjs/fwxgc/index.html",
        "article_selector": "a[href*='.html']",
        "title_pattern": r"[\u4e00-\u9fff]{4,}",
    },
    {
        "id": "81tv_jskj",
        "name": "軍事科技",
        "url": "http://tv.81.cn/zgjs/jskj/index.html",
        "article_selector": "a[href*='.html']",
        "title_pattern": r"[\u4e00-\u9fff]{4,}",
    },
    {
        "id": "81tv_bzjd",
        "name": "百戰經典",
        "url": "http://tv.81.cn/zgjs/bzjd/index.html",
        "article_selector": "a[href*='.html']",
        "title_pattern": r"[\u4e00-\u9fff]{4,}",
    },
    {
        "id": "81tv_jmxtx",
        "name": "軍迷行天下",
        "url": "http://tv.81.cn/zgjs/jmxtx/index.html",
        "article_selector": "a[href*='.html']",
        "title_pattern": r"[\u4e00-\u9fff]{4,}",
    },
    {
        "id": "81tv_ywbb",
        "name": "要聞播報",
        "url": "http://tv.81.cn/bydssy/ywbb/index.html",
        "article_selector": "a[href*='.html']",
        "title_pattern": r"[\u4e00-\u9fff]{4,}",
    },
    {
        "id": "81tv_jszqy",
        "name": "軍事最前沿",
        "url": "http://tv.81.cn/jszqy/index.html",
        "article_selector": "a[href*='.html']",
        "title_pattern": r"[\u4e00-\u9fff]{4,}",
    },
]

# ── 分類關鍵字 ───────────────────────────────────────────────
KEYWORDS = {
    "陸軍":         ["陸軍","步兵","裝甲","炮兵","山地","特種作戰","兩棲","機械化","合成旅",
                    "集團軍","某旅","某團","某師","某營","陸戰","地面部隊","輕步兵",
                    "75集團軍","74集團軍","73集團軍","72集團軍","71集團軍",
                    "82集團軍","83集團軍","78集團軍","79集團軍","80集團軍","81集團軍",
                    "戰車","裝甲兵","炮兵","工兵","防空旅"],
    "海軍":         ["海軍","艦艇","驅逐艦","護衛艦","航母","潛艇","水面艦","渡海","反潛",
                    "艦隊","登陸艦","兩棲攻擊","海上補給","艦載機","水兵"],
    "空軍":         ["空軍","戰機","殲-","轟-","飛行員","制空","空中作戰","空降",
                    "航空兵","轟炸機","運輸機","預警機","加油機"],
    "火箭軍":       ["火箭軍","彈道導彈","洲際","巡航導彈","精確打擊","核反擊","東風"],
    "戰略支援部隊": ["戰略支援","電子對抗","網絡攻防","信息作戰","偵察衛星"],
    "航天":         ["飛船","載人航天","航天員","神舟","天宮","天舟","空間站","長征火箭"],
    "聯合作戰":     ["聯合作戰","聯合演習","戰區","多軍種","協同作戰"],
}

# 優先分類：航天詞彙出現時直接歸為航天，不再誤判為其他軍種
PRIORITY_KEYWORDS = {
    "航天": ["飛船","載人航天","航天員","神舟","天宮","天舟","空間站","長征火箭"],
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
    # 優先判斷：航天詞彙直接歸類，避免被誤判為海軍或其他
    for branch, kws in PRIORITY_KEYWORDS.items():
        if any(k in title for k in kws):
            return branch
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
            # 只寫有具體型號的裝備（含數字或是特定具名裝備）
            has_number = bool(re.search(r'\d', model))
            is_named = model in ["航母", "北斗"]
            if model and (has_number or is_named) and not any(r["model"] == model for r in results):
                results.append({"model": model, "type": t, "unit": find_unit(title), "branch": branch})
    return results


NAME_PATTERN = r'[\u4e00-\u9fff]{2,4}(?=(?:司令|政委|參謀長|旅長|艦長|飛行員|士兵|指揮員|維和))'

def extract_name(title, title_name):
    """從職稱前面嘗試抽取姓名（2-4個中文字）"""
    pat = rf'([\u4e00-\u9fff]{{2,4}}){re.escape(title_name)}'
    m = re.search(pat, title)
    return m.group(1) if m else ""

def extract_personnel(title, branch):
    results = []
    for pat, title_name in TITLE_PATTERNS:
        if re.search(pat, title) and not any(r["title"] == title_name for r in results):
            unit = find_unit(title)
            name = extract_name(title, title_name)
            # 只有找到姓名才寫入人資
            if name:
                results.append({"unit": unit, "title": title_name, "name": name, "branch": branch})
    return results


def fetch_video_detail(url, headers):
    """進入影片頁面抓取簡介文字"""
    try:
        resp = requests.get(url, headers=headers, timeout=10)
        resp.encoding = resp.apparent_encoding
        soup = BeautifulSoup(resp.text, "html.parser")
        # 央視影片頁的簡介選擇器
        for sel in [".video_intro", ".description", ".info_brief", "p.brief", ".episode-info p"]:
            el = soup.select_one(sel)
            if el:
                text = el.get_text(strip=True)
                if len(text) > 10:
                    return text
        # fallback：抓所有 <p> 裡最長的一段
        paras = [p.get_text(strip=True) for p in soup.find_all("p") if len(p.get_text(strip=True)) > 20]
        return max(paras, key=len) if paras else ""
    except Exception:
        return ""


def fetch_articles(source):
    """抓取單一來源的新聞列表"""
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "Referer": "https://www.baidu.com/",
    }
    articles = []
    is_cctv_video = "tv.81.cn" in source["url"] or "tv.cctv.com/lm" in source["url"]
    try:
        resp = requests.get(source["url"], headers=headers, timeout=15)
        resp.encoding = resp.apparent_encoding
        soup = BeautifulSoup(resp.text, "html.parser")

        links = soup.select(source["article_selector"])
        if not links:
            links = soup.find_all("a")

        seen = set()
        for link in links[:20]:
            title = link.get_text(strip=True)
            if not re.search(source["title_pattern"], title):
                continue
            if len(title) < 6 or len(title) > 80 or title in seen:
                continue
            seen.add(title)

            href = link.get("href", "")
            if href and not href.startswith("http"):
                base = "/".join(source["url"].split("/")[:3])
                href = base + "/" + href.lstrip("/")

            # 央視影片頁：進去抓簡介
            detail = ""
            if is_cctv_video and href and ("tv.81.cn" in href or "tv.cctv.com/20" in href):
                detail = fetch_video_detail(href, headers)
                time.sleep(0.5)

            full_text = title + detail
            branch = classify(full_text)

            articles.append({
                "title": title,
                "url": href or source["url"],
                "source": source["name"],
                "branch": branch,
                "time": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"),
                "detail": detail[:200] if detail else "",
            })
        print(f"    → 抓到 {len(articles)} 則")
    except Exception as e:
        print(f"  ⚠ 抓取 {source['name']} 失敗：{e}")
    return articles


def write_to_sheets(gc, sheet_id, articles):
    """寫入 Google Sheets，分三個工作表（每次清空重寫，避免重複）"""
    wb = gc.open_by_key(sheet_id)
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")

    # ── 新聞列表 ──
    try:
        ws_news = wb.worksheet("新聞列表")
    except gspread.exceptions.WorksheetNotFound:
        ws_news = wb.add_worksheet("新聞列表", rows=2000, cols=6)
    ws_news.clear()
    ws_news.append_row(["標題", "簡介", "來源", "軍種", "時間", "連結", "更新時間"])
    news_rows = [[a["title"], a.get("detail",""), a["source"], a["branch"], a["time"], a["url"], now] for a in articles]
    if news_rows:
        ws_news.append_rows(news_rows, value_input_option="RAW")

    # ── 人資資料表（只寫有明確職稱的資料）──
    try:
        ws_per = wb.worksheet("人資資料表")
    except gspread.exceptions.WorksheetNotFound:
        ws_per = wb.add_worksheet("人資資料表", rows=2000, cols=6)
    ws_per.clear()
    ws_per.append_row(["姓名", "職稱/職務", "部隊單位", "軍種", "新聞標題", "來源", "時間"])
    per_rows = []
    for a in articles:
        for p in extract_personnel(a["title"], a["branch"]):
            if p["name"]:  # 有姓名才寫入
                per_rows.append([p["name"], p["title"], p["unit"], p["branch"], a["title"], a["source"], a["time"]])
    if per_rows:
        ws_per.append_rows(per_rows, value_input_option="RAW")

    # ── 裝備資料表（只寫有明確型號的資料）──
    try:
        ws_eq = wb.worksheet("裝備資料表")
    except gspread.exceptions.WorksheetNotFound:
        ws_eq = wb.add_worksheet("裝備資料表", rows=2000, cols=6)
    ws_eq.clear()
    ws_eq.append_row(["武器/裝備型號", "類型", "使用單位", "軍種", "新聞標題", "來源"])
    eq_rows = []
    for a in articles:
        for e in extract_equipment(a["title"], a["branch"]):
            # 只有型號不為空才寫入
            if e["model"] and e["model"].strip():
                eq_rows.append([e["model"], e["type"], e["unit"], e["branch"], a["title"], a["source"]])
    if eq_rows:
        ws_eq.append_rows(eq_rows, value_input_option="RAW")

    print(f"✓ 寫入 {len(news_rows)} 則新聞、{len(per_rows)} 筆人資、{len(eq_rows)} 筆裝備")


def fetch_youtube_subtitles(channel):
    """用 yt-dlp 抓取 YouTube 頻道最新影片的字幕（不下載影片）"""
    articles = []
    try:
        channel_url = f"https://www.youtube.com/channel/{channel['channel_id']}/videos"
        # 只抓字幕和元數據，不下載影片
        cmd = [
            "yt-dlp",
            "--flat-playlist",
            "--playlist-end", str(channel["max_videos"]),
            "--print", "%(id)s\t%(title)s\t%(upload_date)s",
            channel_url,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        if result.returncode != 0:
            print(f"  ⚠ {channel['name']} playlist 失敗：{result.stderr[:200]}")
            return articles

        for line in result.stdout.strip().split("\n"):
            if not line.strip():
                continue
            parts = line.split("\t")
            if len(parts) < 2:
                continue
            video_id, title = parts[0], parts[1]
            date_str = parts[2] if len(parts) > 2 else ""

            # 格式化日期
            try:
                dt = datetime.datetime.strptime(date_str, "%Y%m%d")
                time_str = dt.strftime("%Y-%m-%d %H:%M")
            except Exception:
                time_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")

            # 嘗試抓自動字幕
            subtitle_text = ""
            sub_cmd = [
                "yt-dlp",
                "--skip-download",
                "--write-auto-subs",
                "--sub-lang", "zh-Hans",
                "--sub-format", "vtt",
                "-o", f"/tmp/sub_{video_id}",
                f"https://www.youtube.com/watch?v={video_id}",
            ]
            sub_result = subprocess.run(sub_cmd, capture_output=True, text=True, timeout=30)
            sub_file = f"/tmp/sub_{video_id}.zh-Hans.vtt"
            if os.path.exists(sub_file):
                with open(sub_file, "r", encoding="utf-8") as f:
                    raw = f.read()
                # 去掉 VTT 標記，只留純文字
                lines = [l.strip() for l in raw.split("\n")
                         if l.strip() and not l.startswith("WEBVTT")
                         and not re.match(r'^\d+:\d+', l)
                         and not re.match(r'^<', l)
                         and "-->" not in l]
                subtitle_text = "".join(dict.fromkeys(lines))  # 去重
                os.remove(sub_file)

            # 用標題+字幕內容分類
            full_text = title + subtitle_text
            branch = classify(full_text)

            # 只保留跟軍事有關的（非綜合/其他）
            if branch == "綜合/其他" and not any(k in full_text for k in ["军事","國防","解放軍","部队","武器","导弹"]):
                continue

            articles.append({
                "title": title,
                "url": f"https://www.youtube.com/watch?v={video_id}",
                "source": channel["name"],
                "branch": branch,
                "time": time_str,
                "content": subtitle_text[:500] if subtitle_text else "",  # 字幕前500字
            })
            print(f"    ✓ {title[:30]}... [{branch}]")
            time.sleep(1)

    except Exception as e:
        print(f"  ⚠ {channel['name']} YouTube 抓取失敗：{e}")
    return articles


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

    # 抓取各網頁來源
    all_articles = []
    for src in SOURCES:
        print(f"  抓取 {src['name']}...")
        arts = fetch_articles(src)
        all_articles.extend(arts)
        time.sleep(2)

    # 抓取 YouTube 字幕
    print("\n── YouTube 字幕抓取 ──")
    for ch in YOUTUBE_CHANNELS:
        print(f"  抓取 {ch['name']}...")
        yt_arts = fetch_youtube_subtitles(ch)
        print(f"    → {len(yt_arts)} 則軍事相關")
        all_articles.extend(yt_arts)
        time.sleep(3)

    print(f"\n共抓到 {len(all_articles)} 則")

    if all_articles:
        write_to_sheets(gc, SHEET_ID, all_articles)

    print("=== 完成 ===")


if __name__ == "__main__":
    main()
