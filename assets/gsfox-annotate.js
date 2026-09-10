/* 財經小狐｜畫重點・筆記・星號評分 共用腳本（gsfox-annotate）
   - 文章頁：選取文字→浮動工具列→點黃/紅/藍任一色畫重點，套色後自動彈出筆記撰寫視窗(可留空)；
     點擊既有的畫重點可直接取消(連同附掛的筆記一起移除)
   - 筆記與畫重點是同一份紀錄：顏色本身即代表重要度分類，筆記面板可一鍵下載成Markdown檔
   - 首頁(index.html，body帶 class="gsfox-index")：條目旁的星號評分(最多三顆)
   - 全部資料存在瀏覽器 localStorage；若使用者在首頁設定「同步碼」，會另外透過 Cloudflare Worker+KV
     把資料同步到雲端，讓不同瀏覽器/裝置能看到同一份畫重點/筆記/星號評分（2026-09-10新增） */
(function(){
  "use strict";
  var LS_HL = "gsfox_hl:" + location.pathname;
  var LS_STAR_PREFIX = "gsfox_star:";
  var COLOR_LABEL = { yellow: "黃", red: "紅", blue: "藍" };

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
          if (k.indexOf("gsfox_hl:") === 0 || k.indexOf("gsfox_star:") === 0){
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
      pushToCloudNow(code).then(function(ok){ setSyncStatus(ok ? "已同步" : "同步失敗，稍後會再試一次"); });
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
      m.title = "點擊可移除這段畫重點" + (rec.note ? "（含筆記）" : "");
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
    var mark = document.querySelector('[data-hid="'+id+'"]');
    if (mark) mark.title = "點擊可移除這段畫重點" + (newText ? "（含筆記）" : "");
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
        + '<div class="gsfox-quote">「'+escapeHtml(r.text)+'」</div>'
        + '<div class="gsfox-note-text" data-note-text="'+r.id+'">'+escapeHtml(r.note||"")+'</div>'
        + '<div class="gsfox-note-row">'
        +   '<span class="gsfox-note-time">'+fmtTime(r.ts)+'</span>'
        +   '<span class="gsfox-note-btns"><button data-act="edit" data-id="'+r.id+'">編輯</button><button data-act="del" class="gsfox-del" data-id="'+r.id+'">刪除</button></span>'
        + '</div></div>';
    }).join("");
  }

  function openNotesPanel(){ notesPanel.hidden = false; renderNotesPanel(); }
  function toggleNotesPanel(){ notesPanel.hidden = !notesPanel.hidden; if (!notesPanel.hidden) renderNotesPanel(); }

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
      var btn = closestSafe(e.target, "button");
      if (!btn) return;
      if (btn.dataset.act === "del"){
        if (confirm("確定刪除這段畫重點／筆記？")){ removeHighlight(id); renderNotesPanel(); }
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

  function initAnnotation(){
    buildUI();
    var code = getSyncCode();
    if (code){
      pullFromCloud(code).then(function(){ restoreHighlights(); renderNotesPanel(); });
    } else {
      restoreHighlights();
      renderNotesPanel();
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
        var hl = closestSafe(e.target, "mark.gsfox-hl");
        if (hl){ removeHighlight(hl.getAttribute("data-hid")); if (!notesPanel.hidden) renderNotesPanel(); else updateBadge(); return; }
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

  /* ============ 雲端同步用：蒐集本機所有畫重點/筆記/星號評分 ============ */
  function collectBackupData(){
    var data = {};
    for (var i = 0; i < localStorage.length; i++){
      var key = localStorage.key(i);
      if (key.indexOf("gsfox_hl:") === 0 || key.indexOf("gsfox_star:") === 0){
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
      setSyncStatus("連接中…");
      pullFromCloud(code).then(function(){
        return pushToCloudNow(code);
      }).then(function(ok){
        setSyncStatus(ok ? "已連接並同步完成" : "已連接，但同步時發生問題，稍後會自動重試");
        if (document.body.classList.contains("gsfox-index")) initStarWidgets();
      });
    });

    disconnectBtn.addEventListener("click", function(){
      if (!confirm("中斷雲端同步？這個瀏覽器裡目前的資料不會被刪除，只是不會再自動同步。")) return;
      clearSyncCode();
      render();
    });

    render();
  }

  function boot(){
    if (document.body.classList.contains("gsfox-index")){
      var code = getSyncCode();
      if (code){
        pullFromCloud(code).then(function(){ initStarWidgets(); });
      } else {
        initStarWidgets();
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
