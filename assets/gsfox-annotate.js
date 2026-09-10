/* 財經小狐｜畫重點・筆記・星號評分 共用腳本（gsfox-annotate）
   - 文章頁：選取文字→浮動工具列→畫重點(黃/紅/藍)或做筆記；點擊既有重點可取消
   - 首頁(index.html，body帶 class="gsfox-index")：條目旁的星號評分(最多三顆)
   - 全部資料存在瀏覽器 localStorage，僅該裝置/瀏覽器可見，不上傳伺服器 */
(function(){
  "use strict";
  var LS_HL = "gsfox_hl:" + location.pathname;
  var LS_NOTE = "gsfox_note:" + location.pathname;
  var LS_STAR_PREFIX = "gsfox_star:";

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

  /* ============ 畫重點 ============ */
  function applyHighlight(rec){
    var segs = segmentsForGlobalRange(rec.gStart, rec.gEnd);
    wrapSegments(segs, function(){
      var m = document.createElement("mark");
      m.className = "gsfox-hl";
      m.setAttribute("data-color", rec.color);
      m.setAttribute("data-hid", rec.id);
      m.title = "點擊可移除這段畫重點";
      return m;
    });
  }

  function addHighlight(range, color){
    var g = rangeToGlobal(range);
    if (g.gStart < 0 || g.gEnd < 0 || g.gStart === g.gEnd) return;
    var rec = { id: uid(), color: color, gStart: Math.min(g.gStart,g.gEnd), gEnd: Math.max(g.gStart,g.gEnd), text: range.toString() };
    var list = loadJSON(LS_HL, []);
    list.push(rec);
    saveJSON(LS_HL, list);
    applyHighlight(rec);
  }

  function removeHighlight(id){
    unwrapByAttr("data-hid", id);
    var list = loadJSON(LS_HL, []).filter(function(r){ return r.id !== id; });
    saveJSON(LS_HL, list);
  }

  function restoreHighlights(){
    loadJSON(LS_HL, []).forEach(applyHighlight);
  }

  /* ============ 筆記 ============ */
  function applyNoteMark(rec){
    var segs = segmentsForGlobalRange(rec.gStart, rec.gEnd);
    wrapSegments(segs, function(){
      var s = document.createElement("span");
      s.className = "gsfox-note-mark";
      s.setAttribute("data-nid", rec.id);
      s.title = "這段文字有筆記";
      return s;
    });
  }

  function addNote(range, noteText){
    var g = rangeToGlobal(range);
    if (g.gStart < 0 || g.gEnd < 0 || g.gStart === g.gEnd) return null;
    var rec = { id: uid(), gStart: Math.min(g.gStart,g.gEnd), gEnd: Math.max(g.gStart,g.gEnd),
                quote: range.toString(), note: noteText || "", ts: new Date().toISOString() };
    var list = loadJSON(LS_NOTE, []);
    list.push(rec);
    saveJSON(LS_NOTE, list);
    applyNoteMark(rec);
    return rec;
  }

  function updateNoteText(id, newText){
    var list = loadJSON(LS_NOTE, []);
    list.forEach(function(r){ if (r.id === id) r.note = newText; });
    saveJSON(LS_NOTE, list);
  }

  function removeNote(id){
    unwrapByAttr("data-nid", id);
    var list = loadJSON(LS_NOTE, []).filter(function(r){ return r.id !== id; });
    saveJSON(LS_NOTE, list);
  }

  function restoreNotes(){
    loadJSON(LS_NOTE, []).forEach(applyNoteMark);
  }

  /* ============ UI：浮動工具列 + 筆記撰寫彈窗 ============ */
  var uiRoot, toolbar, composer, notesFab, notesPanel, notesBody, notesBadge;

  function fmtTime(iso){
    try{
      var d = new Date(iso);
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
  function hideComposer(){ composer.style.display = "none"; }

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
    var list = loadJSON(LS_NOTE, []);
    notesBadge.setAttribute("data-count", list.length);
    notesBadge.textContent = list.length;
  }

  function renderNotesPanel(){
    var list = loadJSON(LS_NOTE, []);
    updateBadge();
    if (!list.length){
      notesBody.innerHTML = '<div class="gsfox-notes-empty">這篇文章還沒有筆記<br>選取文字後點擊📝即可新增</div>';
      return;
    }
    notesBody.innerHTML = list.map(function(r){
      return '<div class="gsfox-note-card" data-note-id="'+r.id+'">'
        + '<div class="gsfox-quote">「'+escapeHtml(r.quote)+'」</div>'
        + '<div class="gsfox-note-text" data-note-text="'+r.id+'">'+escapeHtml(r.note||"")+'</div>'
        + '<div class="gsfox-note-row">'
        +   '<span class="gsfox-note-time">'+fmtTime(r.ts)+'</span>'
        +   '<span class="gsfox-note-btns"><button data-act="edit" data-id="'+r.id+'">編輯</button><button data-act="del" class="gsfox-del" data-id="'+r.id+'">刪除</button></span>'
        + '</div></div>';
    }).join("");
  }

  function openNotesPanel(){ notesPanel.hidden = false; renderNotesPanel(); }
  function toggleNotesPanel(){ notesPanel.hidden = !notesPanel.hidden; if (!notesPanel.hidden) renderNotesPanel(); }

  function buildUI(){
    uiRoot = document.createElement("div");
    uiRoot.className = "gsfox-ui";

    toolbar = document.createElement("div");
    toolbar.className = "gsfox-toolbar";
    toolbar.style.display = "none";
    toolbar.innerHTML =
      '<button data-hl="yellow" title="黃色螢光筆"><span class="gsfox-dot yellow"></span></button>'
      + '<button data-hl="red" title="紅色螢光筆"><span class="gsfox-dot red"></span></button>'
      + '<button data-hl="blue" title="藍色螢光筆"><span class="gsfox-dot blue"></span></button>'
      + '<span class="gsfox-sep"></span>'
      + '<button data-act="note" title="新增筆記">📝</button>';
    toolbar.addEventListener("mousedown", function(e){ e.preventDefault(); }); // 不搶走選取狀態
    toolbar.addEventListener("click", function(e){
      var btn = closestSafe(e.target, "button");
      if (!btn || !toolbar._range) return;
      if (btn.dataset.hl){
        addHighlight(toolbar._range, btn.dataset.hl);
        hideToolbar();
        window.getSelection().removeAllRanges();
      } else if (btn.dataset.act === "note"){
        openComposer(toolbar._range);
        hideToolbar();
      }
    });

    composer = document.createElement("div");
    composer.className = "gsfox-composer";
    composer.style.display = "none";
    composer.innerHTML =
      '<div class="gsfox-quote" data-role="quote"></div>'
      + '<textarea placeholder="輸入這段的備注(可留空)..."></textarea>'
      + '<div class="gsfox-actions">'
      +   '<button class="gsfox-btn ghost" data-act="cancel">取消</button>'
      +   '<button class="gsfox-btn primary" data-act="save">存入筆記區</button>'
      + '</div>';
    composer.addEventListener("mousedown", function(e){ e.stopPropagation(); });
    composer.addEventListener("click", function(e){
      var btn = closestSafe(e.target, "button");
      if (!btn) return;
      if (btn.dataset.act === "cancel"){ hideComposer(); window.getSelection().removeAllRanges(); }
      if (btn.dataset.act === "save"){
        var ta = composer.querySelector("textarea");
        if (composer._range) addNote(composer._range, ta.value.trim());
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
      '<div class="gsfox-notes-head"><b>📓 這篇文章的筆記</b><button data-act="close">✕</button></div>'
      + '<div class="gsfox-notes-body"></div>';
    notesBody = notesPanel.querySelector(".gsfox-notes-body");
    notesPanel.addEventListener("click", function(e){
      var closeBtn = closestSafe(e.target, '[data-act="close"]');
      if (closeBtn){ notesPanel.hidden = true; return; }
      var card = closestSafe(e.target, ".gsfox-note-card");
      if (!card) return;
      var id = card.dataset.noteId;
      var btn = closestSafe(e.target, "button");
      if (!btn) return;
      if (btn.dataset.act === "del"){
        if (confirm("確定刪除這則筆記？")){ removeNote(id); renderNotesPanel(); }
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

  function openComposer(range){
    var rect = range.getBoundingClientRect();
    composer.querySelector('[data-role="quote"]').textContent = "「" + range.toString() + "」";
    composer.querySelector("textarea").value = "";
    positionAt(composer, rect);
    composer._range = range.cloneRange();
    setTimeout(function(){ composer.querySelector("textarea").focus(); }, 0);
  }

  function initAnnotation(){
    buildUI();
    restoreHighlights();
    restoreNotes();
    renderNotesPanel();

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
        if (hl){ removeHighlight(hl.getAttribute("data-hid")); return; }
        var nm = closestSafe(e.target, "span.gsfox-note-mark");
        if (nm){ openNotesPanel(); var id = nm.getAttribute("data-nid"); var card = notesBody.querySelector('[data-note-id="'+id+'"]'); if (card) card.scrollIntoView({block:"center", behavior:"smooth"}); return; }
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
      });
      row.addEventListener("mousedown", function(e){ e.preventDefault(); e.stopPropagation(); });
    });
  }

  function boot(){
    if (document.body.classList.contains("gsfox-index")){
      initStarWidgets();
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
