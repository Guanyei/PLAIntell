import { useState, useEffect, useCallback } from "react";

// ══ 設定區 ══════════════════════════════════════════════════
const SHEET_ID = "1foCA5umbkVhgx0YfRau56hpX5qe97MaANvcuRNmtYdg";

// 解決更新問題的核心：加上 t=${new Date().getTime()} 繞過 Google 的快取機制[span_2](start_span)[span_2](end_span)[span_3](start_span)[span_3](end_span)
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

// 解析 Google Sheets gviz JSON[span_4](start_span)[span_4](end_span)
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
        setError("請在 SHEET_ID 處填入試算表代碼");
        setLoading(false);
        return;
      }
      
      const [newsData, perData, eqData] = await Promise.all([
        fetchSheet("新聞列表"),
        fetchSheet("人資資料表"),
        fetchSheet("裝備資料表"),
      ]);

      setNews(newsData);
      setPDb(perData);
      setEDb(eqData);
      setUpdated(new Date());
    } catch (e) {
      setError("讀取資料失敗，請確認 Sheet ID 正確且已設為公開");
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleAnalyze = useCallback(async (article) => {
    if (!apiKey.trim()) { alert("請輸入 Gemini API Key"); return; }
    setAnalyzingId(article["標題"]);
    try {
      const prompt = `你是解放軍情報分析師。分析以下新聞標題，只回傳純JSON，不要Markdown格式，欄位：
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
    <div style={{minHeight:"100vh", background:"#080c10", color:"#c8d8e8", fontFamily:"monospace", position:"relative"}}>
      <div style={{position:"fixed", inset:0, pointerEvents:"none", zIndex:99, backgroundImage:"repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,20,40,0.05) 2px,rgba(0,20,40,0.05) 4px)"}} />
      
      <div style={{position:"relative", zIndex:1, maxWidth:1400, margin:"0 auto", padding:"20px"}}>
        
        {/* 控制面板 */}
        <header style={{borderBottom:"2px solid #1a3a5a", paddingBottom:"15px", marginBottom:"20px", display:"flex", justifyContent:"space-between", alignItems:"center"}}>
          <div>
            <h1 style={{margin:0, fontSize:"22px", color:"#e8f4ff"}}>PLA INTEL MONITOR // 情資系統[span_5](start_span)[span_5](end_span)</h1>
            {updated && <span style={{fontSize:"11px", color:"#4a8ab4"}}>最後更新：{updated.toLocaleString("zh-TW")}</span>}
          </div>
          <div style={{display:"flex", gap:"10px"}}>
            <input type="password" value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder="Gemini Key" style={{background:"#040608", border:"1px solid #1a3a5a", color:"#7ad49a", padding:"5px"}} />
            <button onClick={loadData} disabled={loading} style={{background:"#1a3a5a", color:"#7ac8ff", border:"none", padding:"5px 15px", cursor:"pointer"}}>
              {loading ? "更新中..." : "強制重新抓取"}
            </button>
          </div>
        </header>

        {/* 軍種過濾[span_6](start_span)[span_6](end_span) */}
        <div style={{display:"flex", gap:"5px", marginBottom:"15px", overflowX:"auto"}}>
          {BRANCHES.map(b => (
            <div key={b.id} onClick={()=>setBranch(branch===b.id?"all":b.id)} 
              style={{padding:"10px", background:branch===b.id?b.bg:"#0a141e", border:`1px solid ${branch===b.id?b.accent:"#1a3a5a"}`, cursor:"pointer", minWidth:"100px"}}>
              <div style={{fontSize:"20px"}}>{b.icon}</div>
              <div style={{fontSize:"12px", color:b.accent}}>{b.id} ({stats[b.id]||0})</div>
            </div>
          ))}
        </div>

        {/* 主要內容區 */}
        <div style={{display:"flex", borderBottom:"1px solid #1a3a5a", marginBottom:"10px"}}>
          <button onClick={()=>setTab("news")} style={{padding:"10px 20px", background:tab==="news"?"#1a3a5a":"transparent", border:"none", color:"#7ac8ff"}}>📡 新聞 ({news.length})</button>
          <button onClick={()=>setTab("personnel")} style={{padding:"10px 20px", background:tab==="personnel"?"#1a3a5a":"transparent", border:"none", color:"#7ac8ff"}}>🪖 人資 ({pDb.length})</button>
          <button onClick={()=>setTab("equipment")} style={{padding:"10px 20px", background:tab==="equipment"?"#1a3a5a":"transparent", border:"none", color:"#7ac8ff"}}>⚙ 裝備 ({eDb.length})</button>
        </div>

        {tab === "news" ? (
          <div style={{display:"flex", flexDirection:"column", gap:"5px"}}>
            {fNews.map((art, i) => (
              <div key={i} style={{background:"rgba(15,25,35,0.8)", padding:"15px", borderLeft:`4px solid ${getBr(art["軍種"]).accent}`}}>
                <div style={{fontSize:"11px", color:"#4a8ab4", marginBottom:"5px"}}>{art["時間"]} | {art["來源"]} | {art["軍種"]}</div>
                <a href={art["連結"]} target="_blank" style={{color:"#e8f4ff", textDecoration:"none", fontSize:"15px", fontWeight:"bold"}}>{art["標題"]}</a>
                {art._summary && (
                  <div style={{marginTop:"10px", padding:"10px", background:"#040608", border:"1px solid #1a3a5a", fontSize:"13px"}}>
                    <div style={{color:"#8fb85a"}}>摘要：{art._summary}</div>
                    {art._implication && <div style={{color:"#e46a4a", marginTop:"5px"}}>研判：{art._implication}</div>}
                  </div>
                )}
                <button onClick={()=>handleAnalyze(art)} style={{marginTop:"10px", background:"#0a1a2e", color:"#4a9ad4", border:"1px solid #4a9ad4", padding:"3px 8px", fontSize:"11px", cursor:"pointer"}}>
                  {analyzingId === art["標題"] ? "分析中..." : art._analyzed ? "✓ 已分析" : "AI 分析"}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%", borderCollapse:"collapse"}}>
              <thead style={{background:"#1a3a5a"}}>
                <tr>{(tab==="personnel"?P_COLS:E_COLS).map(c=><th key={c} style={{padding:"10px", textAlign:"left", fontSize:"12px"}}>{c}</th>)}</tr>
              </thead>
              <tbody>
                {(tab==="personnel"?fPers:fEqp).map((r,i)=>(
                  <tr key={i} style={{borderBottom:"1px solid #1a3a5a"}}>
                    {Object.values(r).map((v,idx)=><td key={idx} style={{padding:"10px", fontSize:"12px"}}>{v||"—"}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
