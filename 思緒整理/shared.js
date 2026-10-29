// 三張表共用：日期 + 市場狀況 + 儲存 / 歷史 / 匯出匯入 / 複製 Markdown
// 資料存在瀏覽器 localStorage，三個頁面共用同一份，市場狀況依日期共享
const KEY="reflection-sheets-v1";
const MARKET=[["twii","加權指數","如 23,450"],["us","美股","S&P / 那指"],["vix","VIX","如 16.2"],["y10","美 10 年債","如 4.25%"],["fx","美元/台幣","如 31.5"]];
const NAV=[["index.html","思緒整理"],["reflect.html","反思原則表"],["news.html","新聞觀察表"],["topics.html","議題筆記表"],["../index.html","← 回首頁"]];
const $=s=>document.querySelector(s);
const esc=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
let store={};
try{store=JSON.parse(localStorage.getItem(KEY)||"{}")}catch(e){}
const todayStr=()=>{const d=new Date();return new Date(d-d.getTimezoneOffset()*6e4).toISOString().slice(0,10)};
function day(date){
  const d=store[date||$("#date").value]||(store[date||$("#date").value]={});
  d.market=d.market||{};d.pains=d.pains||[];d.forces=d.forces||{};d.topics=d.topics||[];
  return d;
}
let t,page;
const nowStr=()=>todayStr()+" "+new Date().toTimeString().slice(0,5);
function save(){
  const d=day();d.upd=d.upd||{};d.upd[page.key]=nowStr();if(page.touch)page.touch(d);
  try{localStorage.setItem(KEY,JSON.stringify(store));$("#saved").textContent="✓ 已存檔 "+$("#date").value+" "+new Date().toTimeString().slice(0,8)}
  catch(e){$("#saved").textContent="⚠ 無法儲存(請用「匯出全部」備份)"}
  histList();
}
function mdHeader(date){
  const m=day(date).market;
  const parts=MARKET.filter(x=>m[x[0]]).map(x=>`${x[1]} ${m[x[0]]}`);
  return `# ${page.title} ${date}\n\n**市場狀況**:${parts.join("、")||"(未填)"}${m.note?"\n\n盤勢:"+m.note:""}\n\n`;
}
function histList(){
  const ds=Object.keys(store).filter(k=>page.filled(day(k))).sort().reverse();
  $("#hist").innerHTML=`<option value="">${ds.length?"已填寫 "+ds.length+" 天":"尚無紀錄"}</option>`+ds.map(k=>`<option>${k}</option>`).join("");
  const rows=ds.map(k=>{
    const d=day(k),m=d.market.twii?"加權 "+esc(d.market.twii):"",up=(d.upd||{})[page.key]||"—";
    return page.items(d).map((it,i)=>`<tr data-d="${k}" data-id="${esc(it.id||"")}"${(it.tags||[]).some(g=>g.red)?' class="rowred"':""}><td>${i?"":k}</td><td class="q">${i?"":m}</td><td>${esc(it.label||"(未命名)")}${(it.tags||[]).map(g=>` <span class="tg${g.red?" red":""}">${esc(g.t)}</span>`).join("")}</td><td class="q">${esc(it.ts||up)}</td></tr>`).join("");
  }).join("");
  $("#savedBox").innerHTML=`<summary>已儲存的內容(${ds.length} 天,點一列可開啟)</summary>${ds.length?`<table><thead><tr><th>日期</th><th>當天市場</th><th>${page.itemName}</th><th>更新時間</th></tr></thead><tbody>${rows}</tbody></table>`:'<p class="hint">還沒有存檔內容。</p>'}`;
}
function loadMarket(){
  const m=day().market;
  MARKET.forEach(x=>$("#m_"+x[0]).value=m[x[0]]||"");
  $("#m_note").value=m.note||"";
}
function init(cfg){
  page=cfg;
  const cur=location.pathname.split("/").pop()||"index.html";
  $("#nav").innerHTML=NAV.map(n=>`<a href="${n[0]}"${n[0]===cur?' class="on"':""}>${n[1]}</a>`).join("");
  $("#bar").innerHTML=`<div class="row"><label for="date">日期</label><input type="date" id="date">
    <label for="hist">歷史</label><select id="hist"></select><span class="sp"></span><span id="saved" title="填寫時會自動存檔,按「存檔」可手動再存一次"></span>
    <button id="save">存檔</button><button id="copy">複製 Markdown</button><button id="export" class="ghost">匯出全部</button>
    <button id="import" class="ghost">匯入</button><button id="print" class="ghost">列印</button><input type="file" id="file" accept=".json" hidden></div>
    <div class="row mk"><label>市場狀況</label>${MARKET.map(x=>`<input id="m_${x[0]}" data-m="${x[0]}" placeholder="${x[1]}:${x[2]}" title="${x[1]}">`).join("")}
    <input id="m_note" data-m="note" class="wide" placeholder="盤勢一句話(例:外資大賣、AI 股拉回)"></div>`;
  $("#bar").insertAdjacentHTML("afterend",'<details id="savedBox" class="bar" open></details>');
  $("#savedBox").onclick=e=>{
    const tr=e.target.closest("tr[data-d]");if(!tr)return;
    $("#date").value=tr.dataset.d;if(page.select)page.select(tr.dataset.id);redraw();window.scrollTo({top:0,behavior:"smooth"});
  };
  $("#date").value=todayStr();
  const redraw=()=>{loadMarket();page.render(day());histList()};
  $("#date").onchange=redraw;
  $("#hist").onchange=e=>{if(e.target.value){$("#date").value=e.target.value;redraw()}};
  document.addEventListener("input",e=>{
    const el=e.target;
    if(el.dataset.m){day().market[el.dataset.m]=el.value;save()}
    else if(page.onInput&&page.onInput(el,day())){save()}
  });
  document.addEventListener("click",e=>{if(page.onClick&&page.onClick(e,day())){save();page.render(day())}});
  $("#copy").onclick=async()=>{try{const d=$("#date").value;await navigator.clipboard.writeText(mdHeader(d)+page.md(day(d)));$("#saved").textContent="已複製"}catch(e){$("#saved").textContent="複製失敗"}};
  $("#save").onclick=save;
  $("#print").onclick=()=>print();
  $("#export").onclick=()=>{const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([JSON.stringify(store,null,1)],{type:"application/json"}));a.download="思緒整理_備份_"+todayStr()+".json";a.click()};
  $("#import").onclick=()=>$("#file").click();
  $("#file").onchange=e=>{const r=new FileReader();r.onload=()=>{try{Object.assign(store,JSON.parse(r.result));save();redraw()}catch(x){alert("檔案格式不正確")}};r.readAsText(e.target.files[0])};
  redraw();
}
