/**
 * inv-settings.js
 * 設定頁面 — 管理員白名單、分類管理、條碼列印、庫存重建
 */
const InvSettings = {
  _cfgRef: function () { return db.collection('inv_settings').doc('config'); },
  _card: function (inner) {
    return '<div style="background:#fff;border-radius:12px;padding:16px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,.08);">' + inner + '</div>';
  },
  _overlay: function (id, inner) {
    var el = document.createElement('div');
    el.id = id;
    el.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:5000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.35);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);';
    el.innerHTML = '<div style="background:#fff;border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,.15);width:90%;max-width:360px;padding:20px;">' + inner + '</div>';
    document.body.appendChild(el);
    el.addEventListener('touchmove', function (e) {
      if (!e.target.closest('[style*="border-radius:16px"]')) { e.preventDefault(); e.stopPropagation(); }
    }, { passive: false });
    return el;
  },

  // ══════ 設定頁面渲染 ══════
  async render() {
    var c = document.getElementById('inv-settings-content');
    if (!c) return;
    c.innerHTML = '<div style="text-align:center;padding:40px;color:#999;">載入中...</div>';
    try {
      var doc = await this._cfgRef().get();
      var cfg = doc.exists ? doc.data() : {};
    } catch (e) {
      console.error('[InvSettings] render failed:', e);
      c.innerHTML = '<div style="padding:40px;text-align:center;color:#f44336;">設定載入失敗</div>';
      return;
    }
    var esc = InvApp.escapeHTML;
    var h4 = function (t) { return '<h4 style="margin:0 0 10px;font-size:15px;color:#334155;">' + t + '</h4>'; };
    c.innerHTML = '<div style="padding:16px;">' +
      this._card(h4('店鋪資訊') + '<div style="font-size:14px;color:#64748b;">店名：<b>' + esc(cfg.shopName || '未設定') + '</b></div>') +
      this._card(h4('管理員白名單') + '<div id="inv-admin-list"></div>') +
      this._card(h4('商品分類管理') + '<div id="inv-category-list"></div>') +
      this._card(h4('工具') +
        '<button class="inv-btn outline full" onclick="InvSettings._promptBarcodePrint()" style="margin-bottom:8px;">條碼列印</button>' +
        '<button class="inv-btn outline full" onclick="InvSettings.rebuildStock()" style="color:#dc2626;border-color:#dc2626;">庫存重建</button>') +
      '</div>';
    this.renderAdminList(cfg.adminUids || []);
    this.renderCategories(cfg.categories || []);
  },

  // ══════ 管理員白名單 ══════
  async renderAdminList(uids) {
    if (!uids) {
      var doc = await this._cfgRef().get();
      uids = doc.exists ? (doc.data().adminUids || []) : [];
    }
    var w = document.getElementById('inv-admin-list');
    if (!w) return;
    var esc = InvApp.escapeHTML, myUid = InvAuth.getUid(), html = '';
    for (var i = 0; i < uids.length; i++) {
      var u = uids[i], isMe = u === myUid;
      html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f0f0f0;font-size:13px;">' +
        '<span style="word-break:break-all;flex:1;color:#334155;">' + esc(u) + (isMe ? ' <span style="color:#0d9488;font-size:11px;">(你)</span>' : '') + '</span>' +
        (isMe ? '' : '<button onclick="InvSettings.removeAdmin(\'' + esc(u) + '\')" style="flex-shrink:0;margin-left:8px;padding:4px 10px;border:1px solid #fca5a5;border-radius:6px;background:#fff;color:#dc2626;font-size:12px;cursor:pointer;">移除</button>') +
        '</div>';
    }
    html += '<div style="display:flex;gap:8px;margin-top:10px;">' +
      '<input id="inv-new-admin-uid" placeholder="輸入 LINE userId" style="flex:1;padding:8px;border:1px solid #ccc;border-radius:6px;font-size:13px;" />' +
      '<button onclick="InvSettings.addAdmin()" style="flex-shrink:0;padding:8px 14px;border:none;border-radius:6px;background:#0d9488;color:#fff;font-size:13px;cursor:pointer;">新增</button></div>';
    w.innerHTML = html;
  },

  async addAdmin() {
    var input = document.getElementById('inv-new-admin-uid');
    var uid = (input && input.value || '').trim();
    if (!uid) { InvApp.showToast('請輸入 LINE userId'); return; }
    try {
      await this._cfgRef().update({ adminUids: firebase.firestore.FieldValue.arrayUnion(uid) });
      InvApp.showToast('已新增管理員');
      if (input) input.value = '';
      this.renderAdminList();
    } catch (e) { console.error('[InvSettings] addAdmin:', e); InvApp.showToast('新增失敗'); }
  },

  async removeAdmin(uid) {
    if (uid === InvAuth.getUid()) { InvApp.showToast('不可移除自己'); return; }
    if (!confirm('確定要移除此管理員？\n' + uid)) return;
    try {
      await this._cfgRef().update({ adminUids: firebase.firestore.FieldValue.arrayRemove(uid) });
      InvApp.showToast('已移除管理員');
      this.renderAdminList();
    } catch (e) { console.error('[InvSettings] removeAdmin:', e); InvApp.showToast('移除失敗'); }
  },

  // ══════ 分類管理 ══════
  async renderCategories(cats) {
    if (!cats) {
      var doc = await this._cfgRef().get();
      cats = doc.exists ? (doc.data().categories || []) : [];
    }
    var w = document.getElementById('inv-category-list');
    if (!w) return;
    var esc = InvApp.escapeHTML, html = '';
    for (var i = 0; i < cats.length; i++) {
      var c = cats[i];
      html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f0f0f0;font-size:14px;">' +
        '<div style="display:flex;align-items:center;gap:8px;flex:1;">' +
          '<span style="color:#64748b;font-size:12px;min-width:20px;">' + (i + 1) + '</span>' +
          '<span style="color:#334155;">' + esc(c) + '</span></div>' +
        '<div style="display:flex;gap:4px;flex-shrink:0;">' +
          (i > 0 ? '<button onclick="InvSettings._moveCategory(' + i + ',-1)" style="border:1px solid #e2e8f0;background:#fff;border-radius:4px;padding:2px 6px;cursor:pointer;font-size:12px;">&#9650;</button>' : '') +
          (i < cats.length - 1 ? '<button onclick="InvSettings._moveCategory(' + i + ',1)" style="border:1px solid #e2e8f0;background:#fff;border-radius:4px;padding:2px 6px;cursor:pointer;font-size:12px;">&#9660;</button>' : '') +
          '<button onclick="InvSettings.removeCategory(\'' + esc(c).replace(/'/g, "\\'") + '\')" style="border:1px solid #fca5a5;background:#fff;border-radius:4px;padding:2px 8px;cursor:pointer;font-size:12px;color:#dc2626;">&#10005;</button>' +
        '</div></div>';
    }
    html += '<div style="display:flex;gap:8px;margin-top:10px;">' +
      '<input id="inv-new-category" placeholder="新分類名稱" style="flex:1;padding:8px;border:1px solid #ccc;border-radius:6px;font-size:13px;" />' +
      '<button onclick="InvSettings.addCategory()" style="flex-shrink:0;padding:8px 14px;border:none;border-radius:6px;background:#0d9488;color:#fff;font-size:13px;cursor:pointer;">新增</button></div>';
    w.innerHTML = html;
  },

  async addCategory() {
    var input = document.getElementById('inv-new-category');
    var name = (input && input.value || '').trim();
    if (!name) { InvApp.showToast('請輸入分類名稱'); return; }
    try {
      await this._cfgRef().update({ categories: firebase.firestore.FieldValue.arrayUnion(name) });
      InvApp.showToast('已新增分類');
      if (input) input.value = '';
      this.renderCategories();
    } catch (e) { console.error('[InvSettings] addCategory:', e); InvApp.showToast('新增失敗'); }
  },

  async removeCategory(name) {
    if (!confirm('確定要移除分類「' + name + '」？')) return;
    try {
      await this._cfgRef().update({ categories: firebase.firestore.FieldValue.arrayRemove(name) });
      InvApp.showToast('已移除分類');
      this.renderCategories();
    } catch (e) { console.error('[InvSettings] removeCategory:', e); InvApp.showToast('移除失敗'); }
  },

  async _moveCategory(idx, dir) {
    try {
      var doc = await this._cfgRef().get();
      var cats = doc.exists ? (doc.data().categories || []).slice() : [];
      var ni = idx + dir;
      if (ni < 0 || ni >= cats.length) return;
      var tmp = cats[idx]; cats[idx] = cats[ni]; cats[ni] = tmp;
      await this._cfgRef().update({ categories: cats });
      this.renderCategories(cats);
    } catch (e) { console.error('[InvSettings] _moveCategory:', e); InvApp.showToast('排序失敗'); }
  },

  // ══════ 條碼生成/列印 ══════
  _promptBarcodePrint: function () {
    var iS = 'width:100%;padding:8px;margin-bottom:10px;border:1px solid #ccc;border-radius:6px;box-sizing:border-box;';
    var ol = this._overlay('inv-barcode-prompt',
      '<h3 style="margin:0 0 14px;font-size:16px;">條碼列印</h3>' +
      '<label style="font-size:13px;color:#666;">條碼</label><input id="bp-barcode" style="' + iS + '" placeholder="掃碼或手動輸入" />' +
      '<label style="font-size:13px;color:#666;">品名</label><input id="bp-name" style="' + iS + '" placeholder="商品名稱" />' +
      '<label style="font-size:13px;color:#666;">售價</label><input id="bp-price" type="number" style="' + iS.replace('10px','16px') + '" placeholder="0" />' +
      '<div style="display:flex;gap:8px;">' +
        '<button id="bp-cancel" style="flex:1;padding:10px;border:1px solid #ccc;border-radius:8px;background:#fff;cursor:pointer;">取消</button>' +
        '<button id="bp-ok" style="flex:1;padding:10px;border:none;border-radius:8px;background:#0d9488;color:#fff;cursor:pointer;">預覽</button></div>'
    );
    document.getElementById('bp-cancel').addEventListener('click', function () { ol.remove(); });
    document.getElementById('bp-ok').addEventListener('click', function () {
      var bc = (document.getElementById('bp-barcode').value || '').trim();
      var nm = (document.getElementById('bp-name').value || '').trim();
      var pr = Number(document.getElementById('bp-price').value) || 0;
      if (!bc) { InvApp.showToast('請輸入條碼'); return; }
      ol.remove();
      InvSettings.showBarcodePrint(bc, nm, pr);
    });
  },

  showBarcodePrint: function (barcode, productName, sellPrice) {
    var esc = InvApp.escapeHTML;
    var labelHtml =
      '<div id="bp-label" style="display:inline-block;border:1px dashed #ccc;padding:8px 12px;width:50mm;min-height:25mm;box-sizing:border-box;">' +
        '<div style="font-size:11px;font-weight:600;margin-bottom:4px;">' + esc(productName || '') + '</div>' +
        '<canvas id="bp-canvas" width="180" height="60" style="display:block;margin:0 auto;"></canvas>' +
        '<div style="font-size:10px;color:#333;margin-top:2px;">' + esc(barcode) + '</div>' +
        (sellPrice ? '<div style="font-size:12px;font-weight:700;margin-top:2px;">NT$ ' + sellPrice + '</div>' : '') +
      '</div>';
    var ol = this._overlay('inv-barcode-print',
      '<div style="text-align:center;"><h3 style="margin:0 0 12px;font-size:16px;">條碼預覽</h3>' + labelHtml +
      '<div style="display:flex;gap:8px;margin-top:16px;">' +
        '<button id="bp-close" style="flex:1;padding:10px;border:1px solid #ccc;border-radius:8px;background:#fff;cursor:pointer;">關閉</button>' +
        '<button id="bp-print" style="flex:1;padding:10px;border:none;border-radius:8px;background:#0d9488;color:#fff;cursor:pointer;">列印</button></div></div>'
    );
    this._drawBarcode(document.getElementById('bp-canvas'), barcode);
    document.getElementById('bp-close').addEventListener('click', function () { ol.remove(); });
    document.getElementById('bp-print').addEventListener('click', function () {
      var labelEl = document.getElementById('bp-label');
      var pw = window.open('', '_blank', 'width=300,height=200');
      if (!pw) { InvApp.showToast('無法開啟列印視窗'); return; }
      pw.document.write('<html><head><style>@page{size:50mm 25mm;margin:0;}body{margin:0;display:flex;align-items:center;justify-content:center;font-family:sans-serif;}</style></head><body>' + labelEl.innerHTML + '</body></html>');
      pw.document.close(); pw.focus(); pw.print(); pw.close();
    });
  },

  _drawBarcode: function (canvas, value) {
    if (!canvas) return;
    if (typeof JsBarcode !== 'undefined') {
      try { JsBarcode(canvas, value, { format: 'CODE128', width: 1.5, height: 40, displayValue: false }); return; } catch (_) {}
    }
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000';
    var chars = value.split(''), barW = Math.max(1, Math.floor(canvas.width / (chars.length * 4 + 10))), x = 4;
    for (var i = 0; i < chars.length; i++) {
      var code = chars[i].charCodeAt(0);
      for (var b = 0; b < 3; b++) { if ((code >> b) & 1) ctx.fillRect(x, 2, barW, canvas.height - 4); x += barW; }
      x += barW;
    }
  },

  // ══════ 庫存重建工具 ══════
  async rebuildStock() {
    if (!confirm('此操作將根據交易紀錄重新計算所有商品庫存，確定嗎？')) return;
    InvApp.showToast('正在重建庫存...');
    try {
      var snap = await db.collection('inv_transactions').get();
      var txList = snap.docs.map(function (d) { return d.data(); });
      // 按 barcode 分組計算淨庫存
      var sm = {};
      for (var i = 0; i < txList.length; i++) {
        var tx = txList[i], bc = tx.barcode;
        if (!bc) continue;
        if (!(bc in sm)) sm[bc] = 0;
        var qty = Math.abs(Number(tx.quantity) || Number(tx.delta) || 0);
        var type = tx.type || '';
        if (type === 'in') sm[bc] += qty;
        else if (type === 'out' || type === 'sale') sm[bc] -= qty;
        else if (type === 'return') { if (tx.returnToStock !== false) sm[bc] += qty; }
        else if (type === 'waste' || type === 'gift') sm[bc] -= qty;
        else if (type === 'void') sm[bc] -= (Number(tx.delta) || 0);
        else if (type === 'adjust' && tx.afterStock != null) sm[bc] = Number(tx.afterStock);
      }
      // 比對現有商品庫存
      if (!InvProducts._loaded) await InvProducts.loadAll();
      var diffs = [], keys = Object.keys(sm);
      for (var j = 0; j < keys.length; j++) {
        var k = keys[j], prod = InvProducts.getByBarcode(k);
        var cur = prod ? (prod.stock || 0) : 0, calc = sm[k];
        if (cur !== calc) diffs.push({ barcode: k, name: prod ? prod.name : '(未知)', current: cur, calculated: calc });
      }
      if (!diffs.length) { InvApp.showToast('庫存一致，無需調整'); return; }
      // 差異報告
      var msg = '發現 ' + diffs.length + ' 項差異：\n\n';
      for (var m = 0; m < Math.min(diffs.length, 10); m++) {
        var d = diffs[m]; msg += d.name + ': ' + d.current + ' -> ' + d.calculated + '\n';
      }
      if (diffs.length > 10) msg += '...還有 ' + (diffs.length - 10) + ' 項\n';
      if (!confirm(msg + '\n確定要更新嗎？')) return;
      // 批次更新
      var batch = db.batch();
      for (var n = 0; n < diffs.length; n++) {
        batch.update(db.collection('inv_products').doc(diffs[n].barcode),
          { stock: diffs[n].calculated, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
      }
      await batch.commit();
      for (var p = 0; p < diffs.length; p++) {
        var pr = InvProducts.getByBarcode(diffs[p].barcode);
        if (pr) pr.stock = diffs[p].calculated;
      }
      InvApp.showToast('庫存重建完成，調整 ' + diffs.length + ' 件');
    } catch (e) {
      console.error('[InvSettings] rebuildStock:', e);
      InvApp.showToast('庫存重建失敗：' + (e.message || ''));
    }
  }
};
