/* 財經小狐｜畫重點・筆記・星號評分 共用腳本（gsfox-annotate）
   - 文章頁：選取文字→浮動工具列→點黃/紅/藍任一色畫重點，套色後自動彈出筆記撰寫視窗(可留空)；
     點擊文章裡既有的畫重點會導向📓筆記面板對應的卡片(不會刪除)，所有刪除/移除動作都在面板裡進行
   - 筆記與畫重點是同一份紀錄：顏色本身即代表重要度分類，筆記面板可一鍵下載成Markdown檔，卡片可按住拖曳排序
   - 首頁(index.html，body帶 class="gsfox-index")：條目旁的星號評分(最多三顆)
   - 全部資料存在瀏覽器 localStorage；若使用者在首頁設定「同步碼」，會另外透過 Cloudflare Worker+KV
     把資料同步到雲端，讓不同瀏覽器/裝置能看到同一份畫重點/筆記/星號評分（2026-09-10新增） */
(function(){
  "use strict";
  var LS_HL = "gsfox_hl:" + location.pathname;
  var LS_STAR_PREFIX = "gsfox_star:";
  var LS_READ_PREFIX = "gsfox_read:";
  var COLOR_LABEL = { yellow: "黃", red: "紅", blue: "藍" };

  function isGsfoxDataKey(k){
    return k.indexOf("gsfox_hl:") === 0 || k.indexOf("gsfox_star:") === 0 || k.indexOf(LS_READ_PREFIX) === 0
      || k === "gsfox_notebook_order";
  }

  /* ============ 雲端同步（Cloudflare Worker + KV） ============ */
  var WORKER_URL = "https://gsfox-sync.yingbangbang2026.workers.dev";
  var LS_SYNC_CODE = "gsfox_sync_code";

  function getSyncCode(){ try{ return localStorage.getItem(LS_SYNC_CODE) || ""; }catch(e){ return ""; } }
  function setSyncCode(code){ try{ localStorage.setItem(LS_SYNC_CODE, code); }catch(e){} }
  function clearSyncCode(){ try{ localStorage.removeItem(LS_SYNC_CODE); }catch(e){} }
  function cloudUrl(code){ return WORKER_URL + "/sync/" + encodeURIComponent(code); }

  function pullFromCloud(code){
    return fetch(cloudUrl(code)).then(function(r){ return r.json(); }).then(function(json){
      var data = json && json.data && typeof json.data === "object" ? json.data : null;
      if (data){
        Object.keys(data).forEach(function(k){
          if (isGsfoxDataKey(k)){
            try{ localStorage.setItem(k, data[k]); }catch(e){}
          }
        });
      }
      return true;
    }).catch(function(){ return false; });
  }

  function pushToCloudNow(code){
    var payload = { app: "gsfox-annotate", exportedAt: new Date().toISOString(), data: collectBackupData() };
    return fetch(cloudUrl(code), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).then(function(r){ return r.ok; }).catch(function(){ return false; });
  }

  var pushTimer = null;
  function scheduleCloudPush(){
    var code = getSyncCode();
    if (!code) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(function(){
      setSyncStatus("上傳中…");
      pushToCloudNow(code).then(function(ok){ setSyncStatus(ok ? "上傳已完成" : "上傳失敗，稍後會再試一次"); });
    }, 2000);
  }

  var syncStatusEl = null;
  function setSyncStatus(text){ if (syncStatusEl) syncStatusEl.textContent = text; }

  // e.target 理論上在真實使用者互動中一定是Element，但為避免極端情況(例如事件target是純文字節點)拋錯，一律用這個安全版closest
  function closestSafe(node, sel){
    var el = node && node.nodeType === 1 ? node : (node && node.parentElement ? node.parentElement : null);
    return el ? el.closest(sel) : null;
  }

  function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,8); }
  function loadJSON(key, fallback){ try{ var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }catch(e){ return fallback; } }
  function saveJSON(key, val){ try{ localStorage.setItem(key, JSON.stringify(val)); }catch(e){} }

  /* ============ 共用：文字節點全域座標對照 ============ */
  function buildTextNodeMap(root){
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function(node){
        var p = node.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        if (p.closest("script,style,noscript,textarea,.gsfox-ui")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var ranges = [], pos = 0, node;
    while ((node = walker.nextNode())){
      var len = node.nodeValue.length;
      ranges.push({node: node, start: pos, end: pos + len});
      pos += len;
    }
    return {ranges: ranges, length: pos};
  }

  function globalOffset(map, node, offset){
    for (var i=0; i<map.ranges.length; i++){
      if (map.ranges[i].node === node) return map.ranges[i].start + offset;
    }
    return -1;
  }

  function rangeToGlobal(range){
    var map = buildTextNodeMap(document.body);
    return { gStart: globalOffset(map, range.startContainer, range.startOffset),
             gEnd: globalOffset(map, range.endContainer, range.endOffset) };
  }

  function segmentsForGlobalRange(gStart, gEnd){
    var map = buildTextNodeMap(document.body);
    var segs = [];
    for (var i=0; i<map.ranges.length; i++){
      var r = map.ranges[i];
      var s = Math.max(gStart, r.start), e = Math.min(gEnd, r.end);
      if (s < e) segs.push({ node: r.node, start: s - r.start, end: e - r.start });
    }
    return segs;
  }

  function wrapSegments(segs, makeEl){
    segs.forEach(function(seg){
      var r = document.createRange();
      r.setStart(seg.node, seg.start);
      r.setEnd(seg.node, seg.end);
      try{ r.surroundContents(makeEl()); }catch(e){ /* 極少數跨界情形略過該段 */ }
    });
  }

  function unwrapByAttr(attr, id){
    var els = document.querySelectorAll("[" + attr + '="' + id + '"]');
    els.forEach(function(el){
      var parent = el.parentNode;
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
      parent.normalize();
    });
  }

  /* ============ 畫重點＋筆記（同一份紀錄） ============ */
  function applyHighlight(rec){
    var segs = segmentsForGlobalRange(rec.gStart, rec.gEnd);
    wrapSegments(segs, function(){
      var m = document.createElement("mark");
      m.className = "gsfox-hl";
      m.setAttribute("data-color", rec.color);
      m.setAttribute("data-hid", rec.id);
      m.title = rec.note ? "點擊可到📓筆記面板查看/編輯這則筆記" : "點擊可到📓筆記面板查看，並可在那裡移除";
      return m;
    });
  }

  function addHighlight(range, color){
    var g = rangeToGlobal(range);
    if (g.gStart < 0 || g.gEnd < 0 || g.gStart === g.gEnd) return null;
    var rec = { id: uid(), color: color, gStart: Math.min(g.gStart,g.gEnd), gEnd: Math.max(g.gStart,g.gEnd),
                text: range.toString(), note: "", ts: new Date().toISOString() };
    var list = loadJSON(LS_HL, []);
    list.push(rec);
    saveJSON(LS_HL, list);
    applyHighlight(rec);
    scheduleCloudPush();
    return rec;
  }

  function removeHighlight(id){
    unwrapByAttr("data-hid", id);
    var list = loadJSON(LS_HL, []).filter(function(r){ return r.id !== id; });
    saveJSON(LS_HL, list);
    scheduleCloudPush();
  }

  function updateNoteText(id, newText){
    var list = loadJSON(LS_HL, []);
    list.forEach(function(r){ if (r.id === id) r.note = newText; });
    saveJSON(LS_HL, list);
    var title = newText ? "點擊可到📓筆記面板查看/編輯這則筆記" : "點擊可到📓筆記面板查看，並可在那裡移除";
    document.querySelectorAll('[data-hid="'+id+'"]').forEach(function(m){ m.title = title; });
    scheduleCloudPush();
  }

  function restoreHighlights(){
    loadJSON(LS_HL, []).forEach(applyHighlight);
  }

  /* ============ UI：浮動工具列 + 筆記撰寫彈窗 ============ */
  var uiRoot, toolbar, composer, notesFab, notesPanel, notesBody, notesBadge;

  function fmtTime(iso){
    // 早期(合併畫重點/筆記之前)建立的紀錄沒有ts欄位；new Date(undefined)不會拋錯而是變成Invalid Date，
    // 直接呼叫getFullYear()等會得到NaN，所以要額外檢查，不能只靠try/catch
    if (!iso) return "";
    try{
      var d = new Date(iso);
      if (isNaN(d.getTime())) return "";
      var p = function(n){ return (n<10?"0":"")+n; };
      return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate())+" "+p(d.getHours())+":"+p(d.getMinutes());
    }catch(e){ return ""; }
  }

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, function(c){
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
    });
  }

  function hideToolbar(){ toolbar.style.display = "none"; }
  function hideComposer(){ composer.style.display = "none"; composer._hid = null; }

  function positionAt(el, rect){
    var top = rect.top + window.scrollY;
    var left = rect.left + window.scrollX + rect.width/2;
    el.style.top = top + "px";
    el.style.left = left + "px";
    el.style.display = "block";
  }

  function showToolbarForSelection(range){
    var rect = range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) return;
    positionAt(toolbar, rect);
    toolbar._range = range.cloneRange();
  }

  function updateBadge(){
    var list = loadJSON(LS_HL, []);
    notesBadge.setAttribute("data-count", list.length);
    notesBadge.textContent = list.length;
  }

  function renderNotesPanel(){
    var list = loadJSON(LS_HL, []);
    updateBadge();
    if (!list.length){
      notesBody.innerHTML = '<div class="gsfox-notes-empty">這篇文章還沒有畫重點或筆記<br>選取文字後點顏色即可新增</div>';
      return;
    }
    notesBody.innerHTML = list.map(function(r){
      return '<div class="gsfox-note-card" data-color="'+r.color+'" data-note-id="'+r.id+'">'
        + '<span class="gsfox-drag-handle" title="按住拖曳可調整順序">⠿</span>'
        + '<div class="gsfox-quote" title="點擊跳到文章裡的引用處">「'+escapeHtml(r.text)+'」</div>'
        + '<div class="gsfox-note-text" data-note-text="'+r.id+'">'+escapeHtml(r.note||"")+'</div>'
        + '<div class="gsfox-note-row">'
        +   '<span class="gsfox-note-time">'+fmtTime(r.ts)+'</span>'
        +   '<span class="gsfox-note-btns"><button data-act="edit" data-id="'+r.id+'">編輯</button><button data-act="del" data-id="'+r.id+'">清空備注</button><button data-act="del-highlight" class="gsfox-del" data-id="'+r.id+'">移除畫重點</button></span>'
        + '</div></div>';
    }).join("");
  }

  /* ============ 筆記卡片拖曳排序 ============ */
  var dragState = null;

  function getDragAfterElement(container, y){
    var els = Array.prototype.slice.call(container.querySelectorAll(".gsfox-note-card:not(.gsfox-dragging)"));
    var closest = { offset: -Infinity, element: null };
    els.forEach(function(child){
      var box = child.getBoundingClientRect();
      var offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) closest = { offset: offset, element: child };
    });
    return closest.element;
  }

  function persistNoteOrder(){
    var ids = Array.prototype.slice.call(notesBody.querySelectorAll(".gsfox-note-card")).map(function(c){ return c.dataset.noteId; });
    var list = loadJSON(LS_HL, []);
    var byId = {};
    list.forEach(function(r){ byId[r.id] = r; });
    var reordered = ids.map(function(id){ return byId[id]; }).filter(Boolean);
    saveJSON(LS_HL, reordered);
    scheduleCloudPush();
  }

  function initNoteDragReorder(){
    notesBody.addEventListener("pointerdown", function(e){
      var handle = closestSafe(e.target, ".gsfox-drag-handle");
      if (!handle) return;
      var card = closestSafe(e.target, ".gsfox-note-card");
      if (!card) return;
      e.preventDefault();
      dragState = { card: card, pointerId: e.pointerId };
      card.classList.add("gsfox-dragging");
      try{ handle.setPointerCapture(e.pointerId); }catch(err){}
    });

    notesBody.addEventListener("pointermove", function(e){
      if (!dragState) return;
      var after = getDragAfterElement(notesBody, e.clientY);
      if (after == null) notesBody.appendChild(dragState.card);
      else notesBody.insertBefore(dragState.card, after);
    });

    function endDrag(){
      if (!dragState) return;
      dragState.card.classList.remove("gsfox-dragging");
      dragState = null;
      persistNoteOrder();
    }
    notesBody.addEventListener("pointerup", endDrag);
    notesBody.addEventListener("pointercancel", endDrag);
  }

  function openNotesPanel(){ notesPanel.hidden = false; renderNotesPanel(); }
  function toggleNotesPanel(){ notesPanel.hidden = !notesPanel.hidden; if (!notesPanel.hidden) renderNotesPanel(); }

  function jumpToHighlight(id){
    var marks = document.querySelectorAll('[data-hid="'+id+'"]');
    if (!marks.length){ alert("這段畫重點目前不在頁面上（可能已被移除）。"); return; }
    marks[0].scrollIntoView({behavior:"smooth", block:"center"});
    marks.forEach(function(m){
      m.classList.add("gsfox-flash");
      setTimeout(function(){ m.classList.remove("gsfox-flash"); }, 1600);
    });
  }

  function jumpToNoteCard(id){
    openNotesPanel();
    var card = notesBody.querySelector('[data-note-id="'+id+'"]');
    if (!card) return;
    card.scrollIntoView({behavior:"smooth", block:"center"});
    card.classList.add("gsfox-flash-card");
    setTimeout(function(){ card.classList.remove("gsfox-flash-card"); }, 1600);
  }

  function sanitizeFilename(s){
    return String(s).replace(/[\\/:*?"<>|]/g, "").trim().slice(0, 60) || "筆記";
  }

  function downloadNotes(){
    var list = loadJSON(LS_HL, []).slice().sort(function(a,b){ return (a.gStart||0)-(b.gStart||0); });
    if (!list.length){ alert("這篇文章目前還沒有畫重點或筆記可以下載。"); return; }
    var title = document.title || location.pathname;
    var lines = [
      "# 筆記匯出：" + title,
      "",
      "來源：" + location.href,
      "匯出時間：" + fmtTime(new Date().toISOString()),
      "", "---", ""
    ];
    list.forEach(function(r){
      lines.push("## [" + (COLOR_LABEL[r.color] || r.color) + "] " + fmtTime(r.ts));
      lines.push("");
      lines.push("*「" + r.text + "」*");
      lines.push("");
      if (r.note) lines.push(r.note);
      else lines.push("_（尚未輸入備注）_");
      lines.push("");
      lines.push("---");
      lines.push("");
    });
    var blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "筆記_" + sanitizeFilename(title) + ".md";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
  }

  function buildUI(){
    uiRoot = document.createElement("div");
    uiRoot.className = "gsfox-ui";

    toolbar = document.createElement("div");
    toolbar.className = "gsfox-toolbar";
    toolbar.style.display = "none";
    toolbar.innerHTML =
      '<button data-hl="yellow" title="黃色螢光筆"><span class="gsfox-dot yellow"></span></button>'
      + '<button data-hl="red" title="紅色螢光筆"><span class="gsfox-dot red"></span></button>'
      + '<button data-hl="blue" title="藍色螢光筆"><span class="gsfox-dot blue"></span></button>';
    toolbar.addEventListener("mousedown", function(e){ e.preventDefault(); }); // 不搶走選取狀態
    toolbar.addEventListener("click", function(e){
      var btn = closestSafe(e.target, "button");
      if (!btn || !toolbar._range || !btn.dataset.hl) return;
      var range = toolbar._range;
      var rec = addHighlight(range, btn.dataset.hl);
      hideToolbar();
      if (rec) openComposer(range, rec);
    });

    composer = document.createElement("div");
    composer.className = "gsfox-composer";
    composer.style.display = "none";
    composer.innerHTML =
      '<div class="gsfox-composer-head"><span class="gsfox-dot" data-role="colordot"></span><span data-role="colorlabel"></span></div>'
      + '<div class="gsfox-quote" data-role="quote"></div>'
      + '<textarea placeholder="輸入這段的備注(可留空)..."></textarea>'
      + '<div class="gsfox-actions">'
      +   '<button class="gsfox-btn ghost" data-act="cancel">先不寫，關閉</button>'
      +   '<button class="gsfox-btn primary" data-act="save">存入筆記區</button>'
      + '</div>';
    composer.addEventListener("mousedown", function(e){ e.stopPropagation(); });
    composer.addEventListener("click", function(e){
      var btn = closestSafe(e.target, "button");
      if (!btn) return;
      if (btn.dataset.act === "cancel"){ hideComposer(); window.getSelection().removeAllRanges(); }
      if (btn.dataset.act === "save"){
        var ta = composer.querySelector("textarea");
        if (composer._hid) updateNoteText(composer._hid, ta.value.trim());
        hideComposer();
        window.getSelection().removeAllRanges();
        if (!notesPanel.hidden) renderNotesPanel(); else updateBadge();
      }
    });

    notesFab = document.createElement("button");
    notesFab.className = "gsfox-notes-fab";
    notesFab.title = "筆記區";
    notesFab.innerHTML = '📓<span class="gsfox-badge" data-count="0">0</span>';
    notesFab.addEventListener("click", toggleNotesPanel);
    notesBadge = notesFab.querySelector(".gsfox-badge");

    notesPanel = document.createElement("div");
    notesPanel.className = "gsfox-notes-panel";
    notesPanel.hidden = true;
    notesPanel.innerHTML =
      '<div class="gsfox-notes-head"><b>📓 這篇文章的畫重點／筆記</b>'
      + '<span class="gsfox-notes-head-btns"><button data-act="download" title="下載成Markdown檔">⬇︎</button><button data-act="close">✕</button></span></div>'
      + '<div class="gsfox-notes-body"></div>';
    notesBody = notesPanel.querySelector(".gsfox-notes-body");
    notesPanel.addEventListener("click", function(e){
      var closeBtn = closestSafe(e.target, '[data-act="close"]');
      if (closeBtn){ notesPanel.hidden = true; return; }
      var downloadBtn = closestSafe(e.target, '[data-act="download"]');
      if (downloadBtn){ downloadNotes(); return; }
      var card = closestSafe(e.target, ".gsfox-note-card");
      if (!card) return;
      var id = card.dataset.noteId;
      var quoteEl = closestSafe(e.target, ".gsfox-quote");
      if (quoteEl){ jumpToHighlight(id); return; }
      var btn = closestSafe(e.target, "button");
      if (!btn) return;
      if (btn.dataset.act === "del"){
        // 只清空筆記文字，畫重點本身(顏色標記)保留在文章裡不受影響
        if (confirm("確定清空這則筆記的備注內容？（畫重點本身不會被移除）")){ updateNoteText(id, ""); renderNotesPanel(); }
      } else if (btn.dataset.act === "del-highlight"){
        // 完整移除：畫重點的顏色標記從文章裡拿掉，這筆紀錄(含筆記)也一起刪除
        // 文章裡點擊畫重點本身不會觸發刪除，一律要從這個面板操作
        if (confirm("確定移除這段畫重點？文章裡的顏色標記與這則筆記都會一併刪除。")){ removeHighlight(id); renderNotesPanel(); }
      } else if (btn.dataset.act === "edit"){
        var textEl = card.querySelector('[data-note-text="'+id+'"]');
        var cur = textEl.textContent;
        var ta = document.createElement("textarea");
        ta.value = cur;
        ta.style.width = "100%"; ta.style.minHeight = "56px"; ta.style.font = "inherit"; ta.style.fontSize = "0.86rem";
        ta.style.border = "1px solid var(--gsfox-border)"; ta.style.borderRadius = "8px"; ta.style.padding = "6px 8px";
        ta.style.boxSizing = "border-box"; ta.style.background = "var(--gsfox-surface)"; ta.style.color = "var(--gsfox-ink)";
        textEl.replaceWith(ta);
        ta.focus();
        var commit = function(){ updateNoteText(id, ta.value.trim()); renderNotesPanel(); };
        ta.addEventListener("blur", commit);
        ta.addEventListener("keydown", function(ev){ if (ev.key === "Enter" && (ev.metaKey||ev.ctrlKey)){ ta.blur(); } });
      }
    });

    uiRoot.appendChild(toolbar);
    uiRoot.appendChild(composer);
    uiRoot.appendChild(notesFab);
    uiRoot.appendChild(notesPanel);
    document.body.appendChild(uiRoot);
  }

  function openComposer(range, rec){
    var rect = range.getBoundingClientRect();
    composer.querySelector('[data-role="quote"]').textContent = "「" + rec.text + "」";
    composer.querySelector('[data-role="colordot"]').className = "gsfox-dot " + rec.color;
    composer.querySelector('[data-role="colorlabel"]').textContent = (COLOR_LABEL[rec.color] || rec.color) + "色重點";
    composer.querySelector("textarea").value = "";
    positionAt(composer, rect);
    composer._hid = rec.id;
    setTimeout(function(){ composer.querySelector("textarea").focus(); }, 0);
  }

  /* ============ 文章頁：已閱讀比例追蹤（記錄本頁曾經捲到過的最深比例） ============ */
  function readKey(){ return LS_READ_PREFIX + location.pathname; }

  function currentScrollPct(){
    var doc = document.documentElement;
    var scrollable = doc.scrollHeight - doc.clientHeight;
    if (scrollable <= 0) return 100; // 整頁一屏就顯示完，視同已讀完
    var pct = Math.round(((window.scrollY || doc.scrollTop) + doc.clientHeight) / doc.scrollHeight * 100);
    return Math.max(0, Math.min(100, pct));
  }

  var readSaveTimer = null;
  function trackReadProgress(){
    var pct = currentScrollPct();
    var prev = parseInt(localStorage.getItem(readKey()) || "0", 10);
    if (pct <= prev) return;
    if (readSaveTimer) clearTimeout(readSaveTimer);
    readSaveTimer = setTimeout(function(){
      try{ localStorage.setItem(readKey(), String(pct)); }catch(e){}
      scheduleCloudPush();
    }, 400);
  }

  function initReadTracking(){
    trackReadProgress();
    window.addEventListener("scroll", trackReadProgress, {passive:true});
  }

  function initAnnotation(){
    buildUI();
    initNoteDragReorder();
    var code = getSyncCode();
    if (code){
      pullFromCloud(code).then(function(){ restoreHighlights(); renderNotesPanel(); initReadTracking(); });
    } else {
      restoreHighlights();
      renderNotesPanel();
      initReadTracking();
    }

    document.addEventListener("mousedown", function(e){
      if (closestSafe(e.target, ".gsfox-ui")) return;
      hideToolbar();
      hideComposer();
    });

    document.addEventListener("mouseup", function(e){
      if (closestSafe(e.target, ".gsfox-ui")) return;
      var sel = window.getSelection();

      if (sel && sel.isCollapsed){
        // 點擊文章裡既有的畫重點不會刪除它(刪除只能在📓筆記面板裡做)，而是導向面板裡對應的那張筆記卡片
        var hl = closestSafe(e.target, "mark.gsfox-hl");
        if (hl){ jumpToNoteCard(hl.getAttribute("data-hid")); return; }
        hideToolbar();
        return;
      }

      if (!sel || sel.rangeCount === 0) { hideToolbar(); return; }
      var text = sel.toString();
      if (!text || !text.trim()) { hideToolbar(); return; }
      var range = sel.getRangeAt(0);
      if (!document.body.contains(range.commonAncestorContainer)) { hideToolbar(); return; }
      showToolbarForSelection(range);
    });

    window.addEventListener("scroll", hideToolbar, {passive:true});
    window.addEventListener("resize", function(){ hideToolbar(); hideComposer(); });
  }

  /* ============ 首頁：已閱讀比例／筆記數徽章 ============ */
  // 注意：星號評分的key直接用href原始字串(只在首頁讀寫，不需要對到文章頁的location.pathname)，
  // 但畫重點/筆記與已閱讀進度是在「文章頁」用location.pathname當key存的(含GitHub Pages的repo子路徑)，
  // 首頁要反查同一篇文章的資料時，必須把href解析成同一個絕對pathname格式，兩者字串才會對得上。
  function resolvePathname(href){
    try{ return new URL(href, location.href).pathname; }catch(e){ return href; }
  }

  function renderReadNoteBadge(box){
    var href = box.getAttribute("data-badges-key");
    var pathname = resolvePathname(href);
    var pct = parseInt(localStorage.getItem(LS_READ_PREFIX + pathname) || "0", 10);
    var hlList = loadJSON("gsfox_hl:" + pathname, []);
    var pctEl = box.querySelector(".gsfox-read-pct");
    var countEl = box.querySelector(".gsfox-note-count");
    if (pctEl) pctEl.textContent = pct + "%";
    if (countEl) countEl.textContent = String(hlList.length);
  }

  function initReadNoteBadges(){
    document.querySelectorAll(".gsfox-badges").forEach(renderReadNoteBadge);
  }

  /* ============ 首頁：星號評分 ============ */
  function starKey(href){ return LS_STAR_PREFIX + href; }

  function renderStars(row){
    var key = row.getAttribute("data-star-key");
    var val = parseInt(localStorage.getItem(starKey(key)) || "0", 10);
    var spans = row.querySelectorAll(".gsfox-star");
    spans.forEach(function(s){
      var i = parseInt(s.getAttribute("data-i"), 10);
      s.classList.toggle("on", i <= val);
      s.textContent = i <= val ? "★" : "☆";
    });
  }

  function initStarWidgets(){
    document.querySelectorAll(".gsfox-star-row").forEach(function(row){
      renderStars(row);
      row.addEventListener("click", function(e){
        e.preventDefault(); e.stopPropagation();
        var star = closestSafe(e.target, ".gsfox-star");
        if (!star) return;
        var key = row.getAttribute("data-star-key");
        var i = parseInt(star.getAttribute("data-i"), 10);
        var cur = parseInt(localStorage.getItem(starKey(key)) || "0", 10);
        var next = (cur === i) ? 0 : i;
        try{ localStorage.setItem(starKey(key), String(next)); }catch(err){}
        renderStars(row);
        scheduleCloudPush();
      });
      row.addEventListener("mousedown", function(e){ e.preventDefault(); e.stopPropagation(); });
    });
  }

  /* ============ 雲端同步用：蒐集本機所有畫重點/筆記/星號評分/已閱讀進度 ============ */
  function collectBackupData(){
    var data = {};
    for (var i = 0; i < localStorage.length; i++){
      var key = localStorage.key(i);
      if (isGsfoxDataKey(key)){
        data[key] = localStorage.getItem(key);
      }
    }
    return data;
  }

  function initSyncWidget(){
    var box = document.querySelector(".gsfox-sync-box");
    if (!box) return;
    var input = box.querySelector('[data-role="sync-code-input"]');
    var connectBtn = box.querySelector('[data-act="sync-connect"]');
    var disconnectBtn = box.querySelector('[data-act="sync-disconnect"]');
    syncStatusEl = box.querySelector('[data-role="sync-status"]');

    function render(){
      var code = getSyncCode();
      if (code){
        input.value = code;
        input.disabled = true;
        connectBtn.hidden = true;
        disconnectBtn.hidden = false;
        setSyncStatus("已連接雲端同步");
      } else {
        input.value = "";
        input.disabled = false;
        connectBtn.hidden = false;
        disconnectBtn.hidden = true;
        setSyncStatus("尚未連接雲端同步");
      }
    }

    connectBtn.addEventListener("click", function(){
      var code = input.value.trim();
      if (!code){ alert("請先輸入一組同步碼。"); return; }
      setSyncCode(code);
      render();
      setSyncStatus("連接中…讀取雲端資料");
      pullFromCloud(code).then(function(){
        setSyncStatus("上傳中…");
        return pushToCloudNow(code);
      }).then(function(ok){
        setSyncStatus(ok ? "上傳已完成" : "上傳失敗，稍後會再試一次");
        if (document.body.classList.contains("gsfox-index")){ initStarWidgets(); initReadNoteBadges(); }
      });
    });

    disconnectBtn.addEventListener("click", function(){
      if (!confirm("中斷雲端同步？這個瀏覽器裡目前的資料不會被刪除，只是不會再自動同步。")) return;
      clearSyncCode();
      render();
    });

    render();
  }

  /* ============ 首頁：筆記本（跨文章彙整所有畫重點／筆記，可分類/標籤/撰寫/重新整理） ============ */
  var LS_NB_ORDER = "gsfox_notebook_order";
  var titleCache = loadJSON("gsfox_title_cache", {});
  var notebookOverlay, notebookBody, notebookFilterCat, notebookFilterTag;
  var nbDragState = null;

  function loadHlFor(pathname){ return loadJSON("gsfox_hl:" + pathname, []); }
  function saveHlFor(pathname, list){ saveJSON("gsfox_hl:" + pathname, list); }

  function collectAllNotes(){
    var out = [];
    for (var i=0; i<localStorage.length; i++){
      var key = localStorage.key(i);
      if (!key || key.indexOf("gsfox_hl:") !== 0) continue;
      var pathname = key.slice("gsfox_hl:".length);
      loadJSON(key, []).forEach(function(r){
        out.push({
          pathname: pathname, id: r.id, color: r.color, text: r.text || "",
          note: r.note || "", ts: r.ts || "",
          category: r.category || "", tags: Array.isArray(r.tags) ? r.tags : []
        });
      });
    }
    return out;
  }

  function updateNoteFieldFor(pathname, id, patch){
    var list = loadHlFor(pathname);
    list.forEach(function(r){ if (r.id === id){ Object.keys(patch).forEach(function(k){ r[k] = patch[k]; }); } });
    saveHlFor(pathname, list);
    scheduleCloudPush();
  }

  function removeNoteFor(pathname, id){
    saveHlFor(pathname, loadHlFor(pathname).filter(function(r){ return r.id !== id; }));
    scheduleCloudPush();
  }

  function nbKey(r){ return r.pathname + "::" + r.id; }

  function articleFallbackLabel(pathname){
    var seg = pathname.split("/").filter(Boolean).pop() || pathname;
    try{ seg = decodeURIComponent(seg); }catch(e){}
    return seg.replace(/\.html$/i, "");
  }

  function getArticleTitle(pathname, cb){
    if (titleCache[pathname]){ cb(titleCache[pathname]); return; }
    // 注意：404頁面也會resolve(不會reject)，一定要檢查r.ok，
    // 否則伺服器404頁的<title>(例如Python http.server的"Error response")會被誤當成文章標題
    fetch(pathname).then(function(r){
      if (!r.ok) throw new Error("not ok");
      return r.text();
    }).then(function(html){
      var m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
      var title = m ? m[1].trim() : articleFallbackLabel(pathname);
      titleCache[pathname] = title;
      saveJSON("gsfox_title_cache", titleCache);
      cb(title);
    }).catch(function(){ cb(articleFallbackLabel(pathname)); });
  }

  function getNotebookOrder(){ return loadJSON(LS_NB_ORDER, []); }
  function setNotebookOrder(keys){ saveJSON(LS_NB_ORDER, keys); scheduleCloudPush(); }

  function applyNotebookOrder(list){
    var order = getNotebookOrder();
    var pos = {};
    order.forEach(function(k,i){ pos[k] = i; });
    var withIdx = list.map(function(r){
      var p = pos[nbKey(r)];
      return { r:r, idx: (p != null ? p : (1e9 + (new Date(r.ts||0).getTime()||0))) };
    });
    withIdx.sort(function(a,b){ return a.idx - b.idx; });
    return withIdx.map(function(w){ return w.r; });
  }

  function distinctSorted(arr){
    var seen = {}, out = [];
    arr.forEach(function(v){ v = (v||"").trim(); if (v && !seen[v]){ seen[v]=1; out.push(v); } });
    out.sort(function(a,b){ return a.localeCompare(b, "zh-Hant"); });
    return out;
  }

  function notebookTagChipsHtml(r){
    return (r.tags||[]).map(function(t){
      return '<span class="gsfox-nb-tag">'+escapeHtml(t)+'<button type="button" data-act="nb-tag-del" data-tag="'+escapeHtml(t)+'">×</button></span>';
    }).join("");
  }

  function notebookCardHtml(r){
    var dateStr = fmtTime(r.ts);
    return '<div class="gsfox-nb-card" data-color="'+(r.color||"")+'" data-pathname="'+escapeHtml(r.pathname)+'" data-id="'+r.id+'">'
      + '<span class="gsfox-drag-handle gsfox-nb-drag" title="按住拖曳可調整順序(僅在未篩選時可用)">⠿</span>'
      + '<div class="gsfox-nb-row1">'
      +   '<input class="gsfox-nb-cat" list="gsfox-nb-catlist" placeholder="未分類">'
      +   '<a class="gsfox-nb-source" href="'+escapeHtml(r.pathname)+'" target="_blank" rel="noopener">🔗 <span data-role="source-title">'+escapeHtml(articleFallbackLabel(r.pathname))+'</span></a>'
      + '</div>'
      + '<div class="gsfox-quote">「'+escapeHtml(r.text)+'」</div>'
      + '<div class="gsfox-nb-time">'+(dateStr ? "摘取於 "+dateStr : "")+'</div>'
      + '<textarea class="gsfox-nb-note" placeholder="撰寫這則筆記的想法...">'+escapeHtml(r.note||"")+'</textarea>'
      + '<div class="gsfox-nb-tags">'+notebookTagChipsHtml(r)+'<input class="gsfox-nb-tag-input" placeholder="+ 標籤(Enter新增)"></div>'
      + '<div class="gsfox-nb-footer"><button class="gsfox-del" data-act="nb-del">移除這則筆記</button></div>'
      + '</div>';
  }

  function renderNotebookFilters(all){
    var curCat = notebookFilterCat.value, curTag = notebookFilterTag.value;
    var cats = distinctSorted(all.map(function(r){ return r.category; }));
    var tags = distinctSorted([].concat.apply([], all.map(function(r){ return r.tags; })));
    notebookFilterCat.innerHTML = '<option value="">全部分類</option><option value="__none__">未分類</option>'
      + cats.map(function(c){ return '<option value="'+escapeHtml(c)+'">'+escapeHtml(c)+'</option>'; }).join("");
    notebookFilterTag.innerHTML = '<option value="">全部標籤</option>'
      + tags.map(function(t){ return '<option value="'+escapeHtml(t)+'">'+escapeHtml(t)+'</option>'; }).join("");
    notebookFilterCat.value = curCat;
    notebookFilterTag.value = curTag;
    var dl = document.getElementById("gsfox-nb-catlist");
    if (dl) dl.innerHTML = cats.map(function(c){ return '<option value="'+escapeHtml(c)+'">'; }).join("");
  }

  function renderNotebook(){
    var all = collectAllNotes();
    renderNotebookFilters(all);
    var fc = notebookFilterCat.value, ft = notebookFilterTag.value;
    var filtering = !!(fc || ft);
    var list = all.filter(function(r){
      if (fc === "__none__" && r.category) return false;
      if (fc && fc !== "__none__" && r.category !== fc) return false;
      if (ft && (r.tags||[]).indexOf(ft) === -1) return false;
      return true;
    });
    list = filtering
      ? list.sort(function(a,b){ return (new Date(b.ts||0)) - (new Date(a.ts||0)); })
      : applyNotebookOrder(list);
    notebookBody.classList.toggle("gsfox-nb-nodrag", filtering);
    if (!list.length){
      notebookBody.innerHTML = '<div class="gsfox-notes-empty">目前沒有符合條件的筆記<br>先到文章裡選取文字、點顏色畫重點，就會自動收進這裡</div>';
      return;
    }
    notebookBody.innerHTML = list.map(notebookCardHtml).join("");
    list.forEach(function(r){
      var card = notebookBody.querySelector('.gsfox-nb-card[data-pathname="'+r.pathname+'"][data-id="'+r.id+'"]');
      if (!card) return;
      var catInput = card.querySelector(".gsfox-nb-cat");
      if (catInput) catInput.value = r.category || "";
      getArticleTitle(r.pathname, function(title){
        var t = card.querySelector('[data-role="source-title"]');
        if (t) t.textContent = title;
      });
    });
  }

  function nbGetDragAfterElement(container, y){
    var els = Array.prototype.slice.call(container.querySelectorAll(".gsfox-nb-card:not(.gsfox-dragging)"));
    var closest = { offset: -Infinity, element: null };
    els.forEach(function(child){
      var box = child.getBoundingClientRect();
      var offset = y - box.top - box.height/2;
      if (offset < 0 && offset > closest.offset) closest = { offset: offset, element: child };
    });
    return closest.element;
  }

  function persistNotebookOrder(){
    if (notebookBody.classList.contains("gsfox-nb-nodrag")) return;
    var cards = Array.prototype.slice.call(notebookBody.querySelectorAll(".gsfox-nb-card"));
    setNotebookOrder(cards.map(function(c){ return c.dataset.pathname + "::" + c.dataset.id; }));
  }

  function initNotebookDrag(){
    notebookBody.addEventListener("pointerdown", function(e){
      if (notebookBody.classList.contains("gsfox-nb-nodrag")) return;
      var handle = closestSafe(e.target, ".gsfox-nb-drag");
      if (!handle) return;
      var card = closestSafe(e.target, ".gsfox-nb-card");
      if (!card) return;
      e.preventDefault();
      nbDragState = { card: card };
      card.classList.add("gsfox-dragging");
      try{ handle.setPointerCapture(e.pointerId); }catch(err){}
    });
    notebookBody.addEventListener("pointermove", function(e){
      if (!nbDragState) return;
      var after = nbGetDragAfterElement(notebookBody, e.clientY);
      if (after == null) notebookBody.appendChild(nbDragState.card);
      else notebookBody.insertBefore(nbDragState.card, after);
    });
    function endDrag(){
      if (!nbDragState) return;
      nbDragState.card.classList.remove("gsfox-dragging");
      nbDragState = null;
      persistNotebookOrder();
    }
    notebookBody.addEventListener("pointerup", endDrag);
    notebookBody.addEventListener("pointercancel", endDrag);
  }

  function initNotebookEvents(){
    notebookBody.addEventListener("change", function(e){
      var card = closestSafe(e.target, ".gsfox-nb-card");
      if (!card) return;
      if (e.target.classList.contains("gsfox-nb-cat")){
        updateNoteFieldFor(card.dataset.pathname, card.dataset.id, { category: e.target.value.trim() });
        renderNotebook();
      }
    });

    notebookBody.addEventListener("blur", function(e){
      if (!e.target.classList || !e.target.classList.contains("gsfox-nb-note")) return;
      var card = closestSafe(e.target, ".gsfox-nb-card");
      if (!card) return;
      updateNoteFieldFor(card.dataset.pathname, card.dataset.id, { note: e.target.value.trim() });
    }, true);

    notebookBody.addEventListener("keydown", function(e){
      if (e.key !== "Enter") return;
      if (!e.target.classList || !e.target.classList.contains("gsfox-nb-tag-input")) return;
      e.preventDefault();
      var card = closestSafe(e.target, ".gsfox-nb-card");
      if (!card) return;
      var val = e.target.value.trim();
      if (!val) return;
      var pathname = card.dataset.pathname, id = card.dataset.id;
      var rec = loadHlFor(pathname).filter(function(r){ return r.id === id; })[0];
      var tags = (rec && Array.isArray(rec.tags)) ? rec.tags.slice() : [];
      if (tags.indexOf(val) === -1) tags.push(val);
      updateNoteFieldFor(pathname, id, { tags: tags });
      e.target.value = "";
      renderNotebook();
    });

    notebookBody.addEventListener("click", function(e){
      var tagDel = closestSafe(e.target, '[data-act="nb-tag-del"]');
      if (tagDel){
        var card = closestSafe(e.target, ".gsfox-nb-card");
        var pathname = card.dataset.pathname, id = card.dataset.id;
        var rec = loadHlFor(pathname).filter(function(r){ return r.id === id; })[0];
        var tags = ((rec && rec.tags) || []).filter(function(t){ return t !== tagDel.dataset.tag; });
        updateNoteFieldFor(pathname, id, { tags: tags });
        renderNotebook();
        return;
      }
      var delBtn = closestSafe(e.target, '[data-act="nb-del"]');
      if (delBtn){
        var card2 = closestSafe(e.target, ".gsfox-nb-card");
        if (confirm("確定要移除這則筆記？來源文章裡的畫重點標記也會一併移除。")){
          removeNoteFor(card2.dataset.pathname, card2.dataset.id);
          renderNotebook();
        }
        return;
      }
    });

    [notebookFilterCat, notebookFilterTag].forEach(function(sel){
      sel.addEventListener("change", renderNotebook);
    });
  }

  function downloadNotebook(){
    var all = applyNotebookOrder(collectAllNotes());
    if (!all.length){ alert("筆記本目前還是空的。"); return; }
    var lines = ["# 筆記本彙整匯出", "", "匯出時間：" + fmtTime(new Date().toISOString()), "", "---", ""];
    all.forEach(function(r){
      lines.push("## [" + (r.category || "未分類") + "] " + (r.tags.length ? r.tags.map(function(t){ return "#"+t; }).join(" ") : ""));
      lines.push("");
      lines.push("來源：" + location.origin + r.pathname);
      lines.push("摘取時間：" + fmtTime(r.ts));
      lines.push("");
      lines.push("*「" + r.text + "」*");
      lines.push("");
      if (r.note) lines.push(r.note);
      lines.push("", "---", "");
    });
    var blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "筆記本彙整_" + new Date().toISOString().slice(0,10) + ".md";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
  }

  function buildNotebookUI(){
    var btn = document.getElementById("gsfox-notebook-btn");
    if (!btn) return;

    notebookOverlay = document.createElement("div");
    notebookOverlay.className = "gsfox-nb-overlay";
    notebookOverlay.hidden = true;
    notebookOverlay.innerHTML =
      '<div class="gsfox-nb-modal">'
      + '<div class="gsfox-nb-head">'
      +   '<b>📓 我的筆記本</b>'
      +   '<span class="gsfox-nb-head-sub">跨所有文章彙整的畫重點與筆記，可分類/標籤後重新整理</span>'
      +   '<span class="gsfox-nb-head-btns">'
      +     '<button data-act="nb-download" title="下載全部筆記">⬇︎ 下載</button>'
      +     '<button data-act="nb-close">✕</button>'
      +   '</span>'
      + '</div>'
      + '<div class="gsfox-nb-filterbar">'
      +   '<select data-role="nb-filter-cat"></select>'
      +   '<select data-role="nb-filter-tag"></select>'
      + '</div>'
      + '<datalist id="gsfox-nb-catlist"></datalist>'
      + '<div class="gsfox-nb-body"></div>'
      + '</div>';
    document.body.appendChild(notebookOverlay);

    notebookBody = notebookOverlay.querySelector(".gsfox-nb-body");
    notebookFilterCat = notebookOverlay.querySelector('[data-role="nb-filter-cat"]');
    notebookFilterTag = notebookOverlay.querySelector('[data-role="nb-filter-tag"]');

    btn.addEventListener("click", function(){ notebookOverlay.hidden = false; renderNotebook(); });
    notebookOverlay.addEventListener("click", function(e){
      if (e.target === notebookOverlay){ notebookOverlay.hidden = true; return; }
      var closeBtn = closestSafe(e.target, '[data-act="nb-close"]');
      if (closeBtn){ notebookOverlay.hidden = true; return; }
      var dlBtn = closestSafe(e.target, '[data-act="nb-download"]');
      if (dlBtn){ downloadNotebook(); return; }
    });

    initNotebookEvents();
    initNotebookDrag();
  }

  function boot(){
    if (document.body.classList.contains("gsfox-index")){
      var code = getSyncCode();
      if (code){
        pullFromCloud(code).then(function(){ initStarWidgets(); initReadNoteBadges(); buildNotebookUI(); });
      } else {
        initStarWidgets();
        initReadNoteBadges();
        buildNotebookUI();
      }
      initSyncWidget();
    } else {
      initAnnotation();
    }
  }

  if (document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
