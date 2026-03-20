# PLA Intel Monitor — 部署說明

## 整體架構

```
GitHub Actions（每小時自動）
    ↓
scraper.py 抓取新聞並分類
    ↓
寫入 Google Sheets（3個工作表）
    ↑
src/App.jsx 讀取並顯示
    ↑
Vercel 託管網頁（免費）
```

---

## 步驟一：建立 Google Sheets

1. 開啟 [Google Sheets](https://sheets.google.com) 建立新試算表
2. 記下網址中的 Sheet ID：
   `https://docs.google.com/spreadsheets/d/【這裡就是 SHEET_ID】/edit`
3. 點右上角「共用」→「知道連結的人」→「檢視者」→ 儲存

---

## 步驟二：建立 Google Service Account（讓爬蟲有寫入權限）

1. 前往 [Google Cloud Console](https://console.cloud.google.com)
2. 建立新專案（或使用現有專案）
3. 啟用 **Google Sheets API** 和 **Google Drive API**
4. 前往「IAM 與管理」→「服務帳戶」→「建立服務帳戶」
5. 建立完成後點進去 →「金鑰」→「新增金鑰」→「JSON」→ 下載
6. 回到 Google Sheets，點「共用」，把服務帳戶的 email 加入（編輯者權限）

---

## 步驟三：上傳到 GitHub

1. 建立 [GitHub](https://github.com) 帳號（若無）
2. 新增 Repository，把以下檔案上傳：
   ```
   scraper.py
   .github/workflows/scrape.yml
   src/App.jsx
   ```
3. 前往 Repository →「Settings」→「Secrets and variables」→「Actions」
4. 新增以下 Secrets：
   - `GOOGLE_SHEET_ID`：你的 Sheet ID
   - `GOOGLE_CREDENTIALS_JSON`：剛才下載的 JSON 檔案**完整內容**（複製貼上）
   - `GEMINI_API_KEY`：Gemini API Key（選填）

---

## 步驟四：部署網頁到 Vercel

1. 前往 [vercel.com](https://vercel.com) 用 GitHub 帳號登入
2. 「New Project」→ 選你的 Repository
3. Framework 選「Create React App」或「Vite」
4. 在 `src/App.jsx` 第 8 行填入你的 Sheet ID：
   ```js
   const SHEET_ID = "你的Sheet ID貼在這裡";
   ```
5. Deploy！幾分鐘後會給你一個網址

---

## 完成後的使用方式

- **自動更新**：GitHub Actions 每小時自動爬蟲，資料寫入 Google Sheets
- **手動觸發**：GitHub → Actions → 「PLA Intel Scraper」→「Run workflow」
- **看介面**：開啟 Vercel 給你的網址，點「↻ 重新整理」讀取最新資料
- **AI 分析**：在網頁右上角輸入 Gemini API Key，對個別新聞點「AI分析」

---

## 免費額度說明

| 服務 | 免費額度 | 是否足夠 |
|------|---------|---------|
| GitHub Actions | 每月 2000 分鐘 | ✅ 每次約 1 分鐘，每天 24 次 = 720 分鐘/月 |
| Google Sheets | 無限 | ✅ |
| Vercel | 無限（個人） | ✅ |
| Gemini API | 每天 1500 次 | ✅ |
