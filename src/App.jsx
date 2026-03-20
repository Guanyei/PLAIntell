import { useState, useEffect, useCallback } from "react";

// ══ 設定區 ══════════════════════════════════════════════════
// 把你的 Google Sheet ID 填在這裡
const SHEET_ID = "1foCA5umbkVhgx0YfRau56hpX5qe97MaANvcuRNmtYdg";

// 用 CSV 格式讀取，最穩定
const SHEET_CSV_URL = (tab) =>
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&sheet=${encodeURIComponent(tab)}`;
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

// 解析 CSV
function parseCsv(text) {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.replace(/^"|"$/g, "").trim());
  return lines.slice(1).map(line => {
    // 處理欄位內有逗號的情況
    const cols = [];
    let cur = "", inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === "," && !inQ) { cols.push(cur.trim()); cur = ""; }
      else { cur += ch; }
    }
    cols.push(cur.trim());
    return Object.fromEntries(headers.map((h, i) => [h, (cols[i] || "").replace(/^"|"$/g, "")]));
  });
}

async function fetchSheet(tabName) {
  try {
    const res = await fetch(SHEET_CSV_URL(tabName));
    const text = await res.text();
    return parseCsv(text);
  } catch {
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
        setError("請先在程式碼中填入你的 Google Sheet ID");
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
      const prompt = `你是解放軍情報分析師。分析以下軍事新聞標題，只回傳純JSON，欄位：
summary(50字內摘要), implication(30字內戰略意涵), tags(3個關鍵字陣列)
新聞：「${article["標題"]}」`;
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey.trim()}`,
        { method:"POST", headers:{"Content-Type":"application/json"},
          body: JSON.stringify({ contents:[{parts:[{text:prompt}]}], generationConfig:{temperature:0.1,maxOutputTokens:400} }) }
      );
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      let p;
      try { p = JSON.parse(raw.replace(/```json|```/g,"").trim()); } catch { p = {summary:raw.slice(0,80),tags:[],implication:""}; }
      setNews(prev => prev.map(a => a["標題"] === article["標題"] ? {...a, _summary:p.summary, _implication:p.implication, _tags:p.tags, _analyzed:true} : a));
    } catch (err) { alert(`分析失敗：${err.message}`); }
    setAnalyzingId(null);
  }, [apiKey]);

  const stats = {};
  BRANCHES.forEach(b => { stats[b.id] = news.filter(a => a["軍種"] === b.id).length; });

  const fNews = news.filter(a =>
    (branch === "all" || a["軍種"] === branch) &&
    (!nSearch || a["標題"]?.includes(nSearch) || a["來源"]?.includes(nSearch))
  );
  const fPers = pDb.filter(r => !dbSearch || Object.values(r).some(v => v?.toString().includes(dbSearch)));
  const fEqp  = eDb.filter(r => !dbSearch || Object.values(r).some(v => v?.toString().includes(dbSearch)));

  const badge = (text, bg, accent) =>
    <span style={{padding:"2px 6px",background:bg+"cc",border:`1px solid ${accent}55`,color:accent,fontSize:10}}>{text||"—"}</span>;

  const cell = (v, s={}) =>
    <td style={{padding:"6px 10px",fontSize:12,borderBottom:"1px solid #0e2030",color:"#c8d8e8",...s}}>{v||"—"}</td>;

  return (
    <div style={{minHeight:"100vh",background:"#080c10",color:"#c8d8e8",fontFamily:"'Courier New','Noto Sans TC',monospace"}}>
      <div style={{position:"fixed",inset:0,pointerEvents:"none",zIndex:99,backgroundImage:"repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,20,40,0.09) 2px,rgba(0,20,40,0.09) 4px)"}} />
      <div style={{position:"fixed",inset:0,pointerEvents:"none",backgroundImage:"linear-gradient(rgba(30,80,120,0.05) 1px,transparent 1px),linear-gradient(90deg,rgba(30,80,120,0.05) 1px,transparent 1px)",backgroundSize:"40px 40px"}} />

      <div style={{position:"relative",zIndex:1,maxWidth:1400,margin:"0 auto",padding:"0 16px 40px"}}>

        {/* Header */}
        <header style={{borderBottom:"1px solid #1a3a5a",padding:"16px 0 14px",marginBottom:16}}>
          <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",flexWrap:"wrap",gap:10}}>
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <div style={{width:42,height:42,border:"2px solid #2a6a9a",display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(20,50,80,0.6)",fontSize:18}}>⭐</div>
              <div>
                <div style={{fontSize:10,letterSpacing:3,color:"#4a8ab4",marginBottom:2}}>PLA INTEL MONITOR // 解放軍情資監控系統</div>
                <h1 style={{margin:0,fontSize:18,fontWeight:700,color:"#e8f4ff"}}>軍事新聞自動蒐集與分類系統</h1>
              </div>
            </div>
            <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:7}}>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <div style={{display:"flex",alignItems:"center",border:"1px solid #1a4a6a",background:"rgba(8,20,35,0.9)"}}>
                  <span style={{padding:"6px 8px",fontSize:10,color:"#4a7a9a",borderRight:"1px solid #1a4a6a",whiteSpace:"nowrap"}}>🔑 Gemini Key</span>
                  <input type="password" value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder="輸入 Key 啟用 AI 分析（免費）"
                    style={{padding:"6px 8px",background:"transparent",border:"none",color:apiKey?"#7ad49a":"#4a6a8a",fontSize:11,fontFamily:"inherit",outline:"none",width:210}} />
                  {apiKey && <span style={{padding:"6px 7px",fontSize:11,color:"#4a9a6a"}}>✓</span>}
                </div>
                <button onClick={loadData} disabled={loading}
                  style={{padding:"6px 16px",background:loading?"rgba(20,50,30,0.8)":"rgba(20,80,40,0.8)",border:`1px solid ${loading?"#2a6a3a":"#3a9a5a"}`,color:loading?"#5a9a6a":"#7ad49a",fontSize:12,letterSpacing:2,cursor:loading?"default":"pointer",fontFamily:"inherit",minWidth:100}}>
                  {loading ? "載入中..." : "↻ 重新整理"}
                </button>
              </div>
              {updated && <div style={{fontSize:10,color:"#2a5a7a"}}>最後更新 {updated.toLocaleTimeString("zh-TW")}</div>}
            </div>
          </div>
        </header>

        {/* Error */}
        {error && (
          <div style={{padding:"12px 16px",background:"rgba(60,10,10,0.8)",border:"1px solid #6a2a2a",color:"#e46a4a",fontSize:13,marginBottom:14}}>
            ⚠ {error}
            <div style={{fontSize:11,color:"#8a4a4a",marginTop:6}}>
              請確認：1) Sheet ID 正確填入  2) Google Sheet 已設為「知道連結的人可以檢視」
            </div>
          </div>
        )}

        {/* Stats */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(90px,1fr))",gap:5,marginBottom:14}}>
          {BRANCHES.map(b => (
            <div key={b.id} onClick={()=>setBranch(branch===b.id?"all":b.id)}
              style={{padding:"8px 10px",background:branch===b.id?`${b.bg}dd`:"rgba(10,20,30,0.8)",border:`1px solid ${branch===b.id?b.accent:"#1a3a5a"}`,borderLeft:`3px solid ${branch===b.id?b.accent:"transparent"}`,cursor:"pointer"}}>
              <div style={{fontSize:13,marginBottom:2}}>{b.icon}</div>
              <div style={{fontSize:16,fontWeight:700,color:branch===b.id?b.accent:"#c8d8e8"}}>{stats[b.id]||0}</div>
              <div style={{fontSize:10,color:branch===b.id?b.accent:"#4a6a8a"}}>{b.id}</div>
            </div>
          ))}
          <div onClick={()=>setBranch("all")} style={{padding:"8px 10px",background:branch==="all"?"rgba(20,40,60,0.9)":"rgba(10,20,30,0.8)",border:`1px solid ${branch==="all"?"#4a8ab4":"#1a3a5a"}`,borderLeft:`3px solid ${branch==="all"?"#4a8ab4":"transparent"}`,cursor:"pointer"}}>
            <div style={{fontSize:13,marginBottom:2}}>📊</div>
            <div style={{fontSize:16,fontWeight:700,color:branch==="all"?"#4a8ab4":"#c8d8e8"}}>{news.length}</div>
            <div style={{fontSize:10,color:branch==="all"?"#4a8ab4":"#4a6a8a"}}>全部</div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{display:"flex",borderBottom:"1px solid #1a3a5a",marginBottom:12}}>
          {[["news","📡 新聞列表",news.length],["personnel","🪖 人資資料表",pDb.length],["equipment","⚙ 裝備資料表",eDb.length]].map(([id,label,count])=>(
            <button key={id} onClick={()=>setTab(id)} style={{padding:"8px 14px",fontFamily:"inherit",fontSize:12,letterSpacing:1,background:tab===id?"rgba(20,50,80,0.9)":"transparent",border:"none",borderBottom:tab===id?"2px solid #4a8ab4":"2px solid transparent",color:tab===id?"#7ac8ff":"#4a6a8a",cursor:"pointer",display:"flex",alignItems:"center",gap:6}}>
              {label} <span style={{padding:"1px 5px",fontSize:10,background:tab===id?"rgba(74,138,180,0.3)":"rgba(30,60,90,0.4)",color:tab===id?"#7ac8ff":"#3a5a7a",border:"1px solid currentColor"}}>{count}</span>
            </button>
          ))}
        </div>

        {/* Search */}
        <div style={{marginBottom:11,position:"relative"}}>
          <input value={tab==="news"?nSearch:dbSearch} onChange={e=>tab==="news"?setNSearch(e.target.value):setDbSearch(e.target.value)}
            placeholder={tab==="news"?"搜尋新聞標題或來源...":"搜尋資料表..."}
            style={{width:"100%",padding:"8px 13px",background:"rgba(10,25,40,0.9)",border:"1px solid #1a3a5a",color:"#c8d8e8",fontSize:13,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}} />
          <span style={{position:"absolute",right:11,top:"50%",transform:"translateY(-50%)",color:"#2a5a7a"}}>⌕</span>
        </div>

        {/* Loading */}
        {loading && <div style={{textAlign:"center",color:"#4a8ab4",padding:60,fontSize:13}}>⟳ 從 Google Sheets 載入資料中...</div>}

        {/* NEWS */}
        {!loading && tab==="news" && (
          <div style={{display:"flex",flexDirection:"column",gap:4}}>
            {fNews.length===0 && <div style={{textAlign:"center",color:"#2a4a6a",padding:60}}>無符合條件的新聞</div>}
            {fNews.map((art,idx) => {
              const br = getBr(art["軍種"]);
              const busy = analyzingId === art["標題"];
              return (
                <div key={idx} style={{background:"rgba(8,18,28,0.9)",border:"1px solid #142030",borderLeft:`3px solid ${br.accent}`}}>
                  <div style={{padding:"10px 12px",display:"flex",alignItems:"flex-start",gap:9}}>
                    <div style={{width:30,height:30,minWidth:30,background:`${br.bg}cc`,border:`1px solid ${br.accent}44`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13}}>{br.icon}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:3,flexWrap:"wrap"}}>
                        <span style={{fontSize:10,padding:"1px 5px",background:`${br.bg}cc`,border:`1px solid ${br.accent}55`,color:br.accent}}>{art["軍種"]||"綜合"}</span>
                        <span style={{fontSize:10,color:"#3a6a9a"}}>{art["來源"]}</span>
                        <span style={{fontSize:10,color:"#2a4a6a",marginLeft:"auto"}}>{art["時間"]}</span>
                      </div>
                      <div style={{fontSize:13,lineHeight:1.5,marginBottom:art._summary?5:0}}>
                        <a href={art["連結"]} target="_blank" rel="noopener noreferrer"
                          style={{color:"#d4e8f8",textDecoration:"none",borderBottom:"1px solid rgba(100,180,255,0.18)"}}
                          onMouseEnter={e=>{e.currentTarget.style.color="#7ac8ff";}}
                          onMouseLeave={e=>{e.currentTarget.style.color="#d4e8f8";}}>
                          {art["標題"]}
                        </a>
                      </div>
                      {art._summary && (
                        <div style={{fontSize:11,color:"#6a9ab4",padding:"4px 8px",background:"rgba(10,30,50,0.5)",borderLeft:`2px solid ${br.accent}44`,lineHeight:1.5}}>
                          {art._summary}
                          {art._implication && <div style={{marginTop:2,color:"#8a6a4a"}}>▸ {art._implication}</div>}
                          {art._tags?.length>0 && <div style={{marginTop:4,display:"flex",gap:3}}>{art._tags.map((t,i)=><span key={i} style={{fontSize:10,padding:"1px 4px",background:"rgba(20,50,80,0.6)",border:"1px solid #1a3a5a",color:"#4a8ab4"}}>#{t}</span>)}</div>}
                        </div>
                      )}
                    </div>
                    <button onClick={()=>handleAnalyze(art)} disabled={busy||art._analyzed}
                      style={{padding:"5px 9px",fontSize:11,fontFamily:"inherit",cursor:busy||art._analyzed?"default":"pointer",background:art._analyzed?"rgba(10,30,20,0.6)":"rgba(10,30,50,0.8)",border:`1px solid ${art._analyzed?"#2a5a3a":"#1a4a6a"}`,color:art._analyzed?"#4a9a6a":busy?"#6a9ab4":"#4a8ab4",minWidth:60,whiteSpace:"nowrap"}}>
                      {busy?"分析中":art._analyzed?"✓完成":"AI分析"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* PERSONNEL */}
        {!loading && tab==="personnel" && (
          <div>
            <div style={{marginBottom:9,fontSize:11,color:"#4a6a8a"}}>共 {fPers.length} 筆（由爬蟲自動抽取）</div>
            {!fPers.length ? <div style={{textAlign:"center",color:"#2a4a6a",padding:50,border:"1px dashed #1a3a5a"}}>尚無資料</div> : (
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse"}}>
                  <thead><tr style={{background:"rgba(10,30,50,0.9)",borderBottom:"1px solid #1a4a6a"}}>
                    {P_COLS.map(c=><th key={c} style={{padding:"7px 10px",textAlign:"left",color:"#4a8ab4",fontSize:12,fontWeight:600,whiteSpace:"nowrap"}}>{c}</th>)}
                  </tr></thead>
                  <tbody>{fPers.map((r,i)=>{
                    const b=getBr(r["軍種"]);
                    return <tr key={i} style={{background:i%2===0?"rgba(8,18,28,0.8)":"rgba(12,24,36,0.6)"}}>
                      {cell(r["部隊單位"],{color:"#e8f4ff",fontWeight:600})}
                      {cell(r["職稱/職務"])}
                      {cell(r["姓名"],{color:"#a8c8e8"})}
                      <td style={{padding:"6px 10px",borderBottom:"1px solid #0e2030"}}>{badge(r["軍種"],b.bg,b.accent)}</td>
                      {cell(r["備註"],{color:"#6a8a9a"})}
                      <td style={{padding:"6px 10px",maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",borderBottom:"1px solid #0e2030",fontSize:12,color:"#c8d8e8"}}>{r["新聞標題"]||"—"}</td>
                      {cell(r["來源"],{color:"#4a6a8a"})}
                    </tr>;
                  })}</tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* EQUIPMENT */}
        {!loading && tab==="equipment" && (
          <div>
            <div style={{marginBottom:9,fontSize:11,color:"#4a6a8a"}}>共 {fEqp.length} 筆（由爬蟲自動抽取）</div>
            {!fEqp.length ? <div style={{textAlign:"center",color:"#2a4a6a",padding:50,border:"1px dashed #1a3a5a"}}>尚無資料</div> : (
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse"}}>
                  <thead><tr style={{background:"rgba(10,30,50,0.9)",borderBottom:"1px solid #1a4a6a"}}>
                    {E_COLS.map(c=><th key={c} style={{padding:"7px 10px",textAlign:"left",color:"#4a8ab4",fontSize:12,fontWeight:600,whiteSpace:"nowrap"}}>{c}</th>)}
                  </tr></thead>
                  <tbody>{fEqp.map((r,i)=>{
                    const b=getBr(r["軍種"]);
                    return <tr key={i} style={{background:i%2===0?"rgba(8,18,28,0.8)":"rgba(12,24,36,0.6)"}}>
                      {cell(r["武器/裝備型號"],{color:"#e8f4ff",fontWeight:600})}
                      <td style={{padding:"6px 10px",borderBottom:"1px solid #0e2030"}}>{badge(r["類型"],"rgba(20,40,60,0.6)","#6ab4d4")}</td>
                      {cell(r["使用單位"])}
                      <td style={{padding:"6px 10px",borderBottom:"1px solid #0e2030"}}>{badge(r["軍種"],b.bg,b.accent)}</td>
                      {cell(r["備註"],{color:"#6a8a9a"})}
                      <td style={{padding:"6px 10px",maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",borderBottom:"1px solid #0e2030",fontSize:12,color:"#c8d8e8"}}>{r["新聞標題"]||"—"}</td>
                      {cell(r["來源"],{color:"#4a6a8a"})}
                    </tr>;
                  })}</tbody>
                </table>
              </div>
            )}
          </div>
        )}

        <div style={{marginTop:24,borderTop:"1px solid #0e2030",paddingTop:9,display:"flex",justifyContent:"space-between",flexWrap:"wrap",gap:6}}>
          <span style={{fontSize:10,color:"#1e4060",letterSpacing:2}}>PLA INTEL MONITOR v4.0 // 本系統僅供學術研究與公開情資分析使用</span>
          <span style={{fontSize:10,color:"#1e4060"}}>資料來源：Google Sheets ← GitHub Actions ← 公開軍事新聞</span>
        </div>
      </div>

      <style>{`*{box-sizing:border-box;}button:hover:not(:disabled){opacity:.8;}a:hover{opacity:.75;}input:focus{border-color:#2a5a8a!important;}::-webkit-scrollbar{width:5px;height:5px;}::-webkit-scrollbar-track{background:#080c10;}::-webkit-scrollbar-thumb{background:#1a3a5a;}`}</style>
    </div>
  );
}
