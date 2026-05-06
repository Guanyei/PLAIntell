import { useState, useEffect, useCallback } from "react";

// ══ 設定區 ══════════════════════════════════════════════════
// 請確保你的 Google Sheet 已設為「知道連結的人可以檢視」[span_0](start_span)[span_0](end_span)
const SHEET_ID = "1foCA5umbkVhgx0YfRau56hpX5qe97MaANvcuRNmtYdg";

// 加上 t= 時間參數，防止 Google 回傳舊的快取資料，確保網頁即時更新[span_1](start_span)[span_1](end_span)[span_2](start_span)[span_2](end_span)
const SHEET_URL = (tab) =>
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(tab)}&t=${new Date().getTime()}`;
// ════════════════════════════════════════════════════════════

const BRANCHES = [
  { id: "陸軍",         bg: "#1a2a10", accent: "#8fb85a", icon: "🪖" },
  { id: "海軍",         bg: "#0a1a2e", accent: "#4a9ad4", icon: "⚓" },
  { id: "空軍",         bg: "#0a1525", accent: "#6a9ae4", icon: "✈" },
  { id: "火箭軍",       bg: "#2a0e0a", accent: "#e46a4a", icon: "🚀" },
  { id: "戰略支援部隊", bg: "#1a0a2a", accent: "#a46ad4", icon: "🛰" },
  { id: "聯合作戰",     bg: "#1e1a08", accent: "#d4b44a", icon: "⚔" },
  { id: "綜合/其他",    bg: "#141414", accent: "#9a9a9a", icon: "📋" },
];

function getBr(label) {
  return BRANCHES.find(b => b.id === label) || BRANCHES[BRANCHES.length - 1];
}

// 解析 Google Sheets gviz JSON 格式[span_3](start_span)[span_3](end_span)
function parseSheetJson(raw) {
  try {
    const json = JSON.parse(raw.replace(/^[^(]+\(/, "").replace(/\);?\s*$/, ""));
    const cols = json.table.cols.map(c => c.label || "");
    const rows = (json.table.rows || []).map(r =>
      Object.fromEntries(cols.map((col, i) => [col, r.c[i]?.v ?? ""]))
    );
    return rows;
  } catch (e) {
    console.error("解析失敗:", e);
    return [];
  }
}

async function fetchSheet(tabName) {
  try {
    const res = await fetch(SHEET_URL(tabName));
    if (!res.ok) throw new Error("網路請求失敗");
    const text = await res.text();
    return parseSheetJson(text);
  } catch (err) {
    console.error(`讀取分頁 ${tabName} 失敗:`, err);
    return [];
  }
}

const P_COLS = ["部隊單位","職稱/職務","姓名","軍種","備註","新聞標題","來源"];
const E_COLS = ["武器/裝備型號","類型","使用單位","軍種","備註","新聞標題","來源"];

export default function App() {
  const [news, setNews]         = useState([]);
  const [pDb, setPDb]           = useState([]);
  const [eDb, setEDb]           = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState("");
  const [tab, setTab]           = useState("news");
  const [branch, setBranch]     = useState("all");
  const [nSearch, setNSearch]   = useState("");
  const [dbSearch, setDbSearch] = useState("");
  const [updated, setUpdated]   = useState(null);
  const [apiKey, setApiKey]     = useState("");
  const [analyzingId, setAnalyzingId] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      if (SHEET_ID === "YOUR_GOOGLE_SHEET_ID") {
        setError("請填入試算表代碼");
        setLoading(false);
        return;
      }
      
      const [newsData, perData, eqData] = await Promise.all([
        fetchSheet("新聞列表"),
        fetchSheet("人資資料表"),
        fetchSheet("裝備資料表"),
      ]);

      // ══ 修改處：將資料陣列反轉 (reverse)，讓最新抓取的資料出現在最上方 ══[span_4](start_span)[span_4](end_span)
      setNews([...newsData].reverse());
      setPDb([...perData].reverse());
      setEDb([...eqData].reverse());
      // ══════════════════════════════════════════════════════════════

      setUpdated(new Date());
    } catch (e) {
      setError("讀取資料失敗，請確認 Sheet 權限與代碼設定");
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleAnalyze = useCallback(async (article) => {
    if (!apiKey.trim()) { alert("請輸入 Gemini API Key"); return; }
    setAnalyzingId(article["標題"]);
    try {
      const prompt = `你是解放軍情報分析師。分析以下軍事新聞標題，只回傳純JSON，不要Markdown格式，欄位：
summary(50字內摘要), implication(30字內戰略意涵), tags(3個關鍵字陣列)
新聞：「${article["標題"]}」`;
      
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey.trim()}`,
        { 
          method:"POST", 
          headers:{"Content-Type":"application/json"},
          body: JSON.stringify({ 
            contents:[{parts:[{text:prompt}]}], 
            generationConfig:{temperature:0.1, maxOutputTokens:400} 
          }) 
        }
      );
      
      const data = await res.json();
      const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      let p;
      try { 
        p = JSON.parse(raw.replace(/```json|```/g,"").trim()); 
      } catch { 
        p = {summary:raw.slice(0,80), tags:[], implication:""}; 
      }

      setNews(prev => prev.map(a => 
        a["標題"] === article["標題"] ? 
        {...a, _summary:p.summary, _implication:p.implication, _tags:p.tags, _analyzed:true} : a
      ));
    } catch (err) { 
      alert(`分析失敗：${err.message}`); 
    }
    setAnalyzingId(null);
  }, [apiKey]);

  const stats = {};
  BRANCHES.forEach(b => { stats[b.id] = news.filter(a => a["軍種"] === b.id).length; });

  const fNews = news.filter(a =>
    (branch === "all" || a["軍種"] === branch) &&
    (!nSearch || (a["標題"]?.toString().includes(nSearch)) || (a["來源"]?.toString().includes(nSearch)))
  );
  const fPers = pDb.filter(r => !dbSearch || Object.values(r).some(v => v?.toString().includes(dbSearch)));
  const fEqp  = eDb.filter(r => !dbSearch || Object.values(r).some(v => v?.toString().includes(dbSearch)));

  return (
    <div style={{minHeight:"100vh", background:"#080c10", color:"#c8d8e8", fontFamily:"monospace"}}>
      <div style={{position:"fixed", inset:0, pointerEvents:"none", zIndex:99, backgroundImage:"repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,20,40,0.05) 2px,rgba(0,20,40,0.05) 4px)"}} />
      
      <div style={{position:"relative", zIndex:1, maxWidth:1400, margin:"0 auto", padding:"20px"}}>

        {/* 控制面板 */}
        <header style={{borderBottom:"2px solid #1a3a5a", paddingBottom:"15px", marginBottom:"20px", display:"flex", justifyContent:"space-between", alignItems:"center"}}>
          <div>
            <h1 style={{margin:0, fontSize:"22px", color:"#e8f4ff"}}>PLA INTEL MONITOR // 情資系統[span_5](start_span)[span_5](end_span)</h1>
            {updated && <span style={{fontSize:"11px", color:"#4a8ab4"}}>資料同步時間：{updated.toLocaleString("zh-TW")}</span>}
          </div>
          <div style={{display:"flex", gap:"10px"}}>
            <input type="password" value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder="Gemini Key" style={{background:"#040608", border:"1px solid #1a3a5a", color:"#7ad49a", padding:"5px", outline:"none"}} />
            <button onClick={loadData} disabled={loading} style={{background:"#1a3a5a", color:"#7ac8ff", border:"none", padding:"5px 15px", cursor:"pointer", transition:"0.2s"}}>
              {loading ? "連線中..." : "↻ 強制更新"}
            </button>
          </div>
        </header>

        {/* 錯誤顯示 */}
        {error && <div style={{background:"rgba(80,20,20,0.8)", border:"1px solid #ff4a4a", color:"#ff4a4a", padding:"10px", marginBottom:"15px"}}>{error}</div>}

        {/* 軍種過濾面板[span_6](start_span)[span_6](end_span) */}
        <div style={{display:"flex", gap:"5px", marginBottom:"15px", overflowX:"auto", paddingBottom:"10px"}}>
          {BRANCHES.map(b => (
            <div key={b.id} onClick={()=>setBranch(branch===b.id?"all":b.id)} 
              style={{padding:"12px", background:branch===b.id?b.bg:"#0a141e", border:`1px solid ${branch===b.id?b.accent:"#1a3a5a"}`, borderLeft:`4px solid ${branch===b.id?b.accent:"transparent"}`, cursor:"pointer", minWidth:"110px", transition:"0.3s"}}>
              <div style={{fontSize:"24px", marginBottom:"4px"}}>{b.icon}</div>
              <div style={{fontSize:"13px", fontWeight:"bold", color:branch===b.id?b.accent:"#c8d8e8"}}>{b.id}</div>
              <div style={{fontSize:"18px", color:branch===b.id?"#fff":"#4a8ab4"}}>{stats[b.id]||0}</div>
            </div>
          ))}
          <div onClick={()=>setBranch("all")} style={{padding:"12px", background:branch==="all"?"#1a3a5a":"#0a141e", border:"1px solid #4a8ab4", cursor:"pointer", minWidth:"110px"}}>
            <div style={{fontSize:"24px", marginBottom:"4px"}}>📊</div>
            <div style={{fontSize:"13px", fontWeight:"bold"}}>總計</div>
            <div style={{fontSize:"18px"}}>{news.length}</div>
          </div>
        </div>

        {/* 功能分頁切換 */}
        <div style={{display:"flex", borderBottom:"1px solid #1a3a5a", marginBottom:"10px"}}>
          {[["news","📡 新聞列表"], ["personnel","🪖 人資資料"], ["equipment","⚙ 裝備資料"]].map(([id, label])=>(
            <button key={id} onClick={()=>setTab(id)} style={{padding:"12px 24px", background:tab===id?"#1a3a5a":"transparent", border:"none", color:tab===id?"#7ac8ff":"#4a6a8a", cursor:"pointer", borderBottom:tab===id?"2px solid #7ac8ff":"none", transition:"0.2s"}}>
              {label}
            </button>
          ))}
        </div>

        {/* 內容顯示區[span_7](start_span)[span_7](end_span) */}
        {loading ? (
          <div style={{textAlign:"center", color:"#4a8ab4", padding:"100px", fontSize:"14px", letterSpacing:"2px"}}>>>> 正在從安全鏈接下載最新數據...</div>
        ) : tab === "news" ? (
          <div style={{display:"flex", flexDirection:"column", gap:"8px"}}>
            {fNews.map((art, i) => {
              const br = getBr(art["軍種"]);
              return (
                <div key={i} style={{background:"rgba(15,25,35,0.8)", padding:"15px", borderLeft:`5px solid ${br.accent}`, boxShadow:"2px 2px 10px rgba(0,0,0,0.5)"}}>
                  <div style={{display:"flex", justifyContent:"space-between", fontSize:"11px", color:"#4a8ab4", marginBottom:"8px"}}>
                    <span>{art["時間"]} | {art["來源"]}</span>
                    <span style={{color:br.accent, fontWeight:"bold"}}>[{art["軍種"] || "綜合"}]</span>
                  </div>
                  <a href={art["連結"]} target="_blank" rel="noreferrer" style={{color:"#e8f4ff", textDecoration:"none", fontSize:"16px", fontWeight:"bold", lineHeight:"1.4", display:"block", marginBottom:"10px"}}>
                    {art["標題"]}
                  </a>
                  {art._summary && (
                    <div style={{marginTop:"10px", padding:"12px", background:"#040608", border:"1px solid #1a3a5a", fontSize:"13px", lineHeight:"1.6"}}>
                      <div style={{color:"#8fb85a", marginBottom:"4px"}}>● 內容摘要：{art._summary}</div>
                      {art._implication && <div style={{color:"#e46a4a"}}>● 戰略研判：{art._implication}</div>}
                    </div>
                  )}
                  <button onClick={()=>handleAnalyze(art)} disabled={analyzingId === art["標題"] || art._analyzed}
                    style={{marginTop:"12px", background:art._analyzed?"#1a2a10":"#0a1a2e", color:art._analyzed?"#8fb85a":"#4a9ad4", border:`1px solid ${art._analyzed?"#8fb85a":"#4a9ad4"}`, padding:"4px 12px", fontSize:"12px", cursor:art._analyzed?"default":"pointer", transition:"0.2s"}}>
                    {analyzingId === art["標題"] ? "分析中..." : art._analyzed ? "✓ 已完成 AI 研判" : "執行 AI 情報分析"}
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{overflowX:"auto", background:"rgba(10,20,30,0.6)"}}>
            <table style={{width:"100%", borderCollapse:"collapse", minWidth:"1000px"}}>
              <thead style={{background:"#1a3a5a"}}>
                <tr>{(tab==="personnel"?P_COLS:E_COLS).map(c=><th key={c} style={{padding:"12px", textAlign:"left", fontSize:"12px", color:"#7ac8ff"}}>{c}</th>)}</tr>
              </thead>
              <tbody>
                {(tab==="personnel"?fPers:fEqp).map((r,i)=>(
                  <tr key={i} style={{borderBottom:"1px solid #1a3a5a", transition:"0.2s"}} onMouseOver={e=>e.currentTarget.style.background="rgba(30,50,80,0.3)"} onMouseOut={e=>e.currentTarget.style.background="transparent"}>
                    {Object.values(r).map((v,idx)=><td key={idx} style={{padding:"12px", fontSize:"12px", color:"#c8d8e8"}}>{v||"—"}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <style>{`
        button:hover:not(:disabled) { opacity: 0.8; filter: brightness(1.2); }
        a:hover { color: #7ac8ff !important; text-decoration: underline !important; }
        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-track { background: #080c10; }
        ::-webkit-scrollbar-thumb { background: #1a3a5a; border-radius: 4px; }
      `}</style>
    </div>
  );
}
