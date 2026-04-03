/**
 * inv-settings.js
 * 設定頁面 — 管理員白名單、分類管理、條碼列印、庫存重建
 */
const InvSettings = {
  _cfgRef: function () { return db.collection('inv_settings').doc('config'); },
  _card: function (inner) {
    return '<div style="background:var(--bg-card);border-radius:12px;padding:16px;margin-bottom:12px;box-shadow:var(--shadow);">' + inner + '</div>';
  },
  _overlay: function (id, inner) {
    var el = document.createElement('div');
    el.id = id;
    el.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:5000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.35);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);';
    el.innerHTML = '<div style="background:var(--bg-card);border-radius:16px;box-shadow:var(--shadow-lg);width:90%;max-width:360px;padding:20px;">' + inner + '</div>';
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
    c.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">載入中...</div>';
    try {
      var doc = await this._cfgRef().get();
      var cfg = doc.exists ? doc.data() : {};
    } catch (e) {
      console.error('[InvSettings] render failed:', e);
      c.innerHTML = '<div style="padding:40px;text-align:center;color:var(--danger);">設定載入失敗</div>';
      return;
    }
    var esc = InvApp.escapeHTML;
    var ib = function(k) { return ' <button class="inv-info-btn" onclick="InvSettings._showInfo(\'' + k + '\')">?</button>'; };
    var h4 = function (t, k) { return '<h4 class="inv-section-head">' + t + (k ? ib(k) : '') + '</h4>'; };
    // 店名 fallback
    var shopName = (cfg.shopName && /^[\x20-\x7E\u4e00-\u9fff]+$/.test(cfg.shopName)) ? cfg.shopName : 'ToosterX';
    c.innerHTML = '<div style="padding:16px;">' +
      this._card(h4('店鋪資訊', 'shop') +
        '<div id="inv-shop-name-area" style="display:flex;align-items:center;gap:8px">' +
          '<span style="font-size:14px;color:var(--text-secondary);flex-shrink:0">店名：</span>' +
          '<span id="inv-shop-name-display" style="flex:1;font-size:15px;font-weight:600;color:var(--text-primary)">' + esc(shopName) + '</span>' +
          '<button class="inv-btn outline sm" onclick="InvSettings._enableShopNameEdit()" style="font-size:12px;min-height:30px;padding:2px 12px">更名</button>' +
        '</div>') +
      this._card(h4('人員管理', 'admin') + '<div id="inv-admin-list"></div>') +
      this._card(h4('商品分類管理', 'category') + '<div id="inv-category-list"></div>') +
      this._card(h4('工具', 'tools') +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
          '<button class="inv-btn outline full sm" onclick="InvSettings._promptBarcodePrint()">條碼列印</button>' +
          '<button class="inv-btn outline full sm" onclick="InvSettings.rebuildStock()" style="color:var(--danger);border-color:var(--danger)">庫存重建</button>' +
        '</div>') +
      this._card(h4('登入公告管理', 'announcement') + '<div id="inv-announcement-list"></div>') +
      '</div>';
    this.renderAdminList(cfg.adminUids || []);
    this.renderAnnouncements();
    this.renderCategories(cfg.categories || []);
  },

  // ══════ 人員白名單（工程師/負責人/店長/店員/工讀）══════
  _OWNER_UID: 'U7774e1410479bafff4997f51b2c47b95',

  _canManageAdmins() {
    var uid = InvAuth.getUid();
    return uid === this._OWNER_UID || (this._superAdmins || []).indexOf(uid) !== -1;
  },

  /** 判定指定 UID 的角色 */
  _getUserRole(uid, cfg) {
    if (uid === this._OWNER_UID) return 'owner';
    if ((cfg.superAdminUids || []).indexOf(uid) !== -1) return 'manager';
    if ((cfg.staffUids || []).indexOf(uid) !== -1) return 'staff';
    if ((cfg.partTimeUids || []).indexOf(uid) !== -1) return 'part';
    return 'leader';
  },

  _ROLE_META: {
    owner:   { label: '工程師', bg: 'var(--accent)',      border: 'var(--accent)' },
    manager: { label: '負責人', bg: 'var(--warning)',      border: 'var(--warning)' },
    leader:  { label: '店長',   bg: 'var(--info,#2563eb)', border: 'var(--info,#2563eb)' },
    staff:   { label: '店員',   bg: 'var(--bg-elevated)',  border: 'var(--border)', textColor: 'var(--text-muted)' },
    part:    { label: '工讀',   bg: 'var(--bg-elevated)',  border: 'var(--border)', textColor: 'var(--text-muted)' },
  },

  /** 可指派的角色選項（排除工程師） */
  _ROLE_OPTIONS: [
    { key: 'manager', field: 'superAdminUids', label: '負責人' },
    { key: 'leader',  field: null,             label: '店長' },
    { key: 'staff',   field: 'staffUids',      label: '店員' },
    { key: 'part',    field: 'partTimeUids',    label: '工讀' },
  ],

  async renderAdminList(uids) {
    var cfg;
    if (!uids) {
      var doc = await this._cfgRef().get();
      cfg = doc.exists ? doc.data() : {};
      uids = cfg.adminUids || [];
    } else {
      try { var d2 = await this._cfgRef().get(); cfg = d2.exists ? d2.data() : {}; } catch(_) { cfg = {}; }
    }
    this._superAdmins = cfg.superAdminUids || [];
    this._cfg = cfg;
    var w = document.getElementById('inv-admin-list');
    if (!w) return;
    var esc = InvApp.escapeHTML, myUid = InvAuth.getUid();
    var isOwner = myUid === this._OWNER_UID;
    var canManage = this._canManageAdmins();

    var html = '';
    for (var i = 0; i < uids.length; i++) {
      var u = uids[i], isMe = u === myUid, isUOwner = u === this._OWNER_UID;
      var role = this._getUserRole(u, cfg);
      var meta = this._ROLE_META[role] || this._ROLE_META.leader;
      var tagColor = meta.textColor || '#fff';
      var roleTag = '<span style="flex-shrink:0;background:' + meta.bg + ';color:' + tagColor + ';padding:2px 10px;border-radius:999px;font-size:10px;font-weight:600">' + meta.label + '</span>';

      // 操作按鈕
      var actions = '';
      if (canManage && !isUOwner && !isMe) {
        actions += '<button onclick="InvSettings.removeAdmin(\'' + esc(u) + '\')" style="flex-shrink:0;background:none;border:none;color:var(--danger);cursor:pointer;font-size:16px;padding:0 4px" title="移除">✕</button>';
        actions += '<button onclick="InvSettings._showRolePicker(\'' + esc(u) + '\')" style="flex-shrink:0;background:none;border:none;color:var(--accent);cursor:pointer;font-size:12px;padding:0 4px" title="變更角色">✎</button>';
      }
      var border = isMe ? 'border:1.5px solid var(--accent)' : 'border:1px solid ' + meta.border;
      var bg = isMe ? 'background:var(--accent-light)' : 'background:var(--bg-elevated)';
      var uidColor = isMe ? 'color:var(--accent);font-weight:600' : 'color:var(--text-secondary)';
      html += '<div style="display:flex;align-items:center;gap:8px;padding:8px 14px;margin-bottom:6px;border-radius:var(--radius-sm);' + bg + ';' + border + '">'
        + '<span style="flex:1;font-size:11px;' + uidColor + ';word-break:break-all">' + esc(u) + '</span>'
        + roleTag + actions + '</div>';
    }
    if (canManage) {
      html += '<div style="display:flex;gap:8px;margin-top:10px">' +
        '<input id="inv-new-admin-uid" class="inv-input" placeholder="輸入 LINE userId" style="flex:1;height:36px;font-size:13px" />' +
        '<select id="inv-new-admin-role" class="inv-select" style="width:auto;height:36px;font-size:13px">' +
          '<option value="leader">店長</option><option value="staff">店員</option><option value="part">工讀</option>' +
          (isOwner ? '<option value="manager">負責人</option>' : '') +
        '</select>' +
        '<button class="inv-btn primary sm" onclick="InvSettings.addAdmin()">新增</button></div>';
    } else {
      html += '<div style="font-size:12px;color:var(--text-muted);margin-top:8px">僅工程師與負責人可管理人員</div>';
    }
    w.innerHTML = html;
  },

  /** 角色選擇彈窗 */
  _showRolePicker(uid) {
    var isOwner = InvAuth.getUid() === this._OWNER_UID;
    var cfg = this._cfg || {};
    var currentRole = this._getUserRole(uid, cfg);
    var esc = InvApp.escapeHTML;
    var overlay = document.createElement('div');
    overlay.className = 'inv-overlay show';
    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
    var btns = '';
    for (var i = 0; i < this._ROLE_OPTIONS.length; i++) {
      var opt = this._ROLE_OPTIONS[i];
      if (opt.key === 'manager' && !isOwner) continue;
      var active = currentRole === opt.key;
      btns += '<button class="inv-role-opt" data-role="' + opt.key + '" style="width:100%;padding:10px;margin-bottom:6px;border:1px solid ' + (active ? 'var(--accent)' : 'var(--border)') + ';border-radius:8px;background:' + (active ? 'var(--accent)' : 'var(--bg-card)') + ';color:' + (active ? '#fff' : 'var(--text-primary)') + ';font-size:14px;cursor:pointer">' + esc(opt.label) + (active ? ' (目前)' : '') + '</button>';
    }
    overlay.innerHTML = '<div class="inv-modal" style="max-width:300px;width:85%"><h3 style="margin:0 0 12px;font-size:16px">變更角色</h3>' + btns +
      '<button class="inv-btn outline full" style="margin-top:4px" onclick="this.closest(\'.inv-overlay\').remove()">取消</button></div>';
    document.body.appendChild(overlay);
    var self = this;
    overlay.querySelectorAll('.inv-role-opt').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        var newRole = this.getAttribute('data-role');
        if (newRole === currentRole) { overlay.remove(); return; }
        overlay.remove();
        await self._changeUserRole(uid, newRole);
      });
    });
  },

  /** 變更用戶角色 */
  async _changeUserRole(uid, newRole) {
    try {
      // 先從所有角色陣列移除
      var updates = {
        superAdminUids: firebase.firestore.FieldValue.arrayRemove(uid),
        staffUids: firebase.firestore.FieldValue.arrayRemove(uid),
        partTimeUids: firebase.firestore.FieldValue.arrayRemove(uid),
      };
      await this._cfgRef().update(updates);
      // 加入對應陣列（店長不需要，因為預設就是店長）
      var fieldMap = { manager: 'superAdminUids', staff: 'staffUids', part: 'partTimeUids' };
      if (fieldMap[newRole]) {
        var add = {};
        add[fieldMap[newRole]] = firebase.firestore.FieldValue.arrayUnion(uid);
        await this._cfgRef().update(add);
      }
      InvApp.showToast('角色已變更');
      this.renderAdminList();
    } catch (e) { InvApp.showToast('變更失敗'); }
  },

  _enableShopNameEdit() {
    var area = document.getElementById('inv-shop-name-area');
    if (!area) return;
    var current = (document.getElementById('inv-shop-name-display') || {}).textContent || '';
    area.innerHTML =
      '<span style="font-size:14px;color:var(--text-secondary);flex-shrink:0">店名：</span>' +
      '<input id="inv-shop-name-input" class="inv-input" value="' + InvApp.escapeHTML(current) + '" style="flex:1;height:36px;font-size:14px" />' +
      '<button class="inv-btn primary sm" onclick="InvSettings.saveShopName()" style="font-size:12px;min-height:30px;padding:2px 12px">儲存</button>' +
      '<button class="inv-btn outline sm" onclick="InvSettings.render()" style="font-size:12px;min-height:30px;padding:2px 8px">取消</button>';
    document.getElementById('inv-shop-name-input').focus();
  },

  async saveShopName() {
    var input = document.getElementById('inv-shop-name-input');
    if (!input) return;
    var name = input.value.trim();
    if (!name) { InvApp.showToast('請輸入店名'); return; }
    try {
      await this._cfgRef().update({ shopName: name });
      InvApp.showToast('店名已更新');
      this.render();
    } catch (e) { InvApp.showToast('儲存失敗'); }
  },

  async addAdmin() {
    if (!this._canManageAdmins()) { InvApp.showToast('僅工程師或負責人可操作'); return; }
    var input = document.getElementById('inv-new-admin-uid');
    var roleSelect = document.getElementById('inv-new-admin-role');
    var uid = (input && input.value || '').trim();
    var role = roleSelect ? roleSelect.value : 'leader';
    if (!uid) { InvApp.showToast('請輸入 LINE userId'); return; }
    try {
      // 加入白名單
      await this._cfgRef().update({ adminUids: firebase.firestore.FieldValue.arrayUnion(uid) });
      // 設定角色
      var fieldMap = { manager: 'superAdminUids', staff: 'staffUids', part: 'partTimeUids' };
      if (fieldMap[role]) {
        var add = {};
        add[fieldMap[role]] = firebase.firestore.FieldValue.arrayUnion(uid);
        await this._cfgRef().update(add);
      }
      var roleName = (this._ROLE_META[role] || {}).label || '店長';
      InvApp.showToast('已新增' + roleName);
      if (input) input.value = '';
      this.renderAdminList();
    } catch (e) { InvApp.showToast('新增失敗'); }
  },

  async removeAdmin(uid) {
    if (!this._canManageAdmins()) { InvApp.showToast('無權限'); return; }
    if (uid === this._OWNER_UID) { InvApp.showToast('不可移除工程師'); return; }
    if (uid === InvAuth.getUid()) { InvApp.showToast('不可移除自己'); return; }
    if (!confirm('確定要移除此人員？\n' + uid)) return;
    try {
      await this._cfgRef().update({
        adminUids: firebase.firestore.FieldValue.arrayRemove(uid),
        superAdminUids: firebase.firestore.FieldValue.arrayRemove(uid),
        staffUids: firebase.firestore.FieldValue.arrayRemove(uid),
        partTimeUids: firebase.firestore.FieldValue.arrayRemove(uid),
      });
      InvApp.showToast('已移除人員');
      this.renderAdminList();
    } catch (e) { InvApp.showToast('移除失敗'); }
  },

  async promoteSuperAdmin(uid) {
    if (InvAuth.getUid() !== this._OWNER_UID) { InvApp.showToast('僅擁有者可指派超級管理員'); return; }
    try {
      await this._cfgRef().update({ superAdminUids: firebase.firestore.FieldValue.arrayUnion(uid) });
      InvApp.showToast('已升為超級管理員');
      this.renderAdminList();
    } catch (e) { InvApp.showToast('操作失敗'); }
  },

  async demoteSuperAdmin(uid) {
    if (InvAuth.getUid() !== this._OWNER_UID) { InvApp.showToast('僅擁有者可操作'); return; }
    try {
      await this._cfgRef().update({ superAdminUids: firebase.firestore.FieldValue.arrayRemove(uid) });
      InvApp.showToast('已取消超級管理員');
      this.renderAdminList();
    } catch (e) { InvApp.showToast('操作失敗'); }
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
      html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:14px;">' +
        '<div style="display:flex;align-items:center;gap:8px;flex:1;">' +
          '<span style="color:var(--text-secondary);font-size:12px;min-width:20px;">' + (i + 1) + '</span>' +
          '<span style="color:var(--text-primary);">' + esc(c) + '</span></div>' +
        '<div style="display:flex;gap:4px;flex-shrink:0;">' +
          (i > 0 ? '<button onclick="InvSettings._moveCategory(' + i + ',-1)" style="border:1px solid var(--border);background:var(--bg-card);border-radius:4px;padding:2px 6px;cursor:pointer;font-size:12px;">&#9650;</button>' : '') +
          (i < cats.length - 1 ? '<button onclick="InvSettings._moveCategory(' + i + ',1)" style="border:1px solid var(--border);background:var(--bg-card);border-radius:4px;padding:2px 6px;cursor:pointer;font-size:12px;">&#9660;</button>' : '') +
          '<button onclick="InvSettings.removeCategory(\'' + esc(c).replace(/'/g, "\\'") + '\')" style="border:1px solid var(--danger);background:var(--bg-card);border-radius:4px;padding:2px 8px;cursor:pointer;font-size:12px;color:var(--danger);">&#10005;</button>' +
        '</div></div>';
    }
    html += '<div style="display:flex;gap:8px;margin-top:10px;">' +
      '<input id="inv-new-category" placeholder="新分類名稱" style="flex:1;padding:8px;border:1px solid var(--border);border-radius:6px;font-size:13px;" />' +
      '<button onclick="InvSettings.addCategory()" style="flex-shrink:0;padding:8px 14px;border:none;border-radius:6px;background:var(--accent);color:#fff;font-size:13px;cursor:pointer;">新增</button></div>';
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
    var iS = 'width:100%;padding:8px;margin-bottom:10px;border:1px solid var(--border);border-radius:6px;box-sizing:border-box;';
    var ol = this._overlay('inv-barcode-prompt',
      '<h3 style="margin:0 0 14px;font-size:16px;">條碼列印</h3>' +
      '<label style="font-size:13px;color:var(--text-muted);">條碼</label><input id="bp-barcode" style="' + iS + '" placeholder="掃碼或手動輸入" />' +
      '<label style="font-size:13px;color:var(--text-muted);">品名</label><input id="bp-name" style="' + iS + '" placeholder="商品名稱" />' +
      '<label style="font-size:13px;color:var(--text-muted);">售價</label><input id="bp-price" type="number" style="' + iS.replace('10px','16px') + '" placeholder="0" />' +
      '<div style="display:flex;gap:8px;">' +
        '<button id="bp-cancel" style="flex:1;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg-card);cursor:pointer;">取消</button>' +
        '<button id="bp-ok" style="flex:1;padding:10px;border:none;border-radius:8px;background:var(--accent);color:#fff;cursor:pointer;">預覽</button></div>'
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
        '<div style="font-size:10px;color:var(--text-primary);margin-top:2px;">' + esc(barcode) + '</div>' +
        (sellPrice ? '<div style="font-size:12px;font-weight:700;margin-top:2px;">NT$ ' + sellPrice + '</div>' : '') +
      '</div>';
    var ol = this._overlay('inv-barcode-print',
      '<div style="text-align:center;"><h3 style="margin:0 0 12px;font-size:16px;">條碼預覽</h3>' + labelHtml +
      '<div style="display:flex;gap:8px;margin-top:16px;">' +
        '<button id="bp-close" style="flex:1;padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg-card);cursor:pointer;">關閉</button>' +
        '<button id="bp-print" style="flex:1;padding:10px;border:none;border-radius:8px;background:var(--accent);color:#fff;cursor:pointer;">列印</button></div></div>'
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
  },

  // ══════ 登入公告管理 ══════

  async renderAnnouncements() {
    var w = document.getElementById('inv-announcement-list');
    if (!w) return;
    var esc = InvApp.escapeHTML;
    try {
      var snap = await db.collection('inv_announcements').orderBy('createdAt', 'desc').limit(10).get();
      var list = snap.docs.map(function(d) { return Object.assign({ _id: d.id }, d.data()); });
    } catch (_) { var list = []; }

    var html = '';
    if (!list.length) {
      html += '<div style="font-size:13px;color:var(--text-muted);padding:8px 0">目前沒有公告</div>';
    }
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      var typeLabel = a.type === 'urgent' ? '緊急' : a.type === 'warning' ? '注意' : '一般';
      var typeColor = a.type === 'urgent' ? 'var(--danger)' : a.type === 'warning' ? 'var(--warning)' : 'var(--accent)';
      var statusDot = a.active ? '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--success);margin-right:4px"></span>'
        : '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--text-muted);margin-right:4px"></span>';
      html += '<div style="padding:10px 0;border-bottom:1px solid var(--border)">' +
        '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">' +
          statusDot +
          '<span style="font-size:11px;padding:2px 8px;border-radius:var(--radius-full);background:' + typeColor + ';color:#fff;font-weight:600">' + typeLabel + '</span>' +
          '<span style="font-weight:600;font-size:14px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(a.title || '') + '</span>' +
        '</div>' +
        '<div style="font-size:12px;color:var(--text-muted);margin-bottom:6px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">' + esc(a.content || '') + '</div>' +
        '<div style="display:flex;gap:6px">' +
          '<button class="inv-btn sm outline" onclick="InvSettings.editAnnouncement(\'' + a._id + '\')" style="font-size:11px;min-height:28px;padding:2px 10px">編輯</button>' +
          '<button class="inv-btn sm outline" onclick="InvSettings.toggleAnnouncement(\'' + a._id + '\',' + !a.active + ')" style="font-size:11px;min-height:28px;padding:2px 10px">' + (a.active ? '停用' : '啟用') + '</button>' +
          '<button class="inv-btn sm outline" onclick="InvSettings.deleteAnnouncement(\'' + a._id + '\')" style="font-size:11px;min-height:28px;padding:2px 10px;color:var(--danger);border-color:var(--danger)">刪除</button>' +
        '</div></div>';
    }
    // 新增按鈕（最多 3 則）
    var canAdd = list.filter(function(a) { return a.active; }).length < 3;
    html += '<button class="inv-btn primary full" onclick="InvSettings.editAnnouncement(null)" style="margin-top:12px"' +
      (canAdd ? '' : ' disabled title="最多 3 則啟用中的公告"') + '>新增公告</button>';
    w.innerHTML = html;
  },

  editAnnouncement(id) {
    var self = this;
    var isEdit = !!id;
    var loadAndShow = async function() {
      var data = { title: '', content: '', type: 'info', active: true };
      if (isEdit) {
        try {
          var doc = await db.collection('inv_announcements').doc(id).get();
          if (doc.exists) data = doc.data();
        } catch (_) {}
      }
      var esc = InvApp.escapeHTML;
      var overlay = document.createElement('div');
      overlay.className = 'inv-overlay show';
      overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
      overlay.innerHTML = '<div class="inv-modal" style="max-width:380px;width:92%">' +
        '<div style="font-size:17px;font-weight:700;text-align:center;margin-bottom:16px">' + (isEdit ? '編輯公告' : '新增公告') + '</div>' +
        '<div class="inv-form-group"><label class="inv-label">類型</label>' +
          '<select id="_ann-type" class="inv-select" style="height:40px">' +
            '<option value="info"' + (data.type === 'info' ? ' selected' : '') + '>一般</option>' +
            '<option value="warning"' + (data.type === 'warning' ? ' selected' : '') + '>注意</option>' +
            '<option value="urgent"' + (data.type === 'urgent' ? ' selected' : '') + '>緊急</option>' +
          '</select></div>' +
        '<div class="inv-form-group"><label class="inv-label">標題</label>' +
          '<input id="_ann-title" class="inv-input" value="' + esc(data.title || '') + '" placeholder="公告標題" maxlength="30" style="height:40px;font-size:14px" /></div>' +
        '<div class="inv-form-group"><label class="inv-label">內容</label>' +
          '<textarea id="_ann-content" class="inv-input" rows="4" placeholder="公告內容" maxlength="200" style="height:auto;min-height:80px;font-size:14px;resize:vertical">' + esc(data.content || '') + '</textarea></div>' +
        '<div style="display:flex;gap:8px;margin-top:16px">' +
          '<button class="inv-btn outline full" onclick="this.closest(\'.inv-overlay\').remove()">取消</button>' +
          '<button class="inv-btn primary full" id="_ann-save">儲存</button>' +
        '</div></div>';
      document.body.appendChild(overlay);
      document.getElementById('_ann-save').onclick = async function() {
        var title = document.getElementById('_ann-title').value.trim();
        var content = document.getElementById('_ann-content').value.trim();
        var type = document.getElementById('_ann-type').value;
        if (!title) { InvApp.showToast('請輸入標題'); return; }
        if (!content) { InvApp.showToast('請輸入內容'); return; }
        try {
          var payload = { title: title, content: content, type: type, active: data.active !== false };
          if (isEdit) {
            await db.collection('inv_announcements').doc(id).update(payload);
          } else {
            payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
            payload.uid = InvAuth.getUid();
            await db.collection('inv_announcements').add(payload);
          }
          overlay.remove();
          InvApp.showToast(isEdit ? '公告已更新' : '公告已新增');
          self.renderAnnouncements();
        } catch (e) { InvApp.showToast('儲存失敗：' + (e.message || '')); }
      };
    };
    loadAndShow();
  },

  async toggleAnnouncement(id, active) {
    try {
      await db.collection('inv_announcements').doc(id).update({ active: active });
      InvApp.showToast(active ? '公告已啟用' : '公告已停用');
      this.renderAnnouncements();
    } catch (e) { InvApp.showToast('操作失敗'); }
  },

  async deleteAnnouncement(id) {
    if (!confirm('確定刪除此公告？')) return;
    try {
      await db.collection('inv_announcements').doc(id).delete();
      InvApp.showToast('公告已刪除');
      this.renderAnnouncements();
    } catch (e) { InvApp.showToast('刪除失敗'); }
  },

  // ══════ 說明彈窗 ══════
  _showInfo(key) {
    var info = {
      shop: {
        title: '店鋪資訊說明',
        body: '<p>設定你的店鋪名稱，此名稱會顯示在系統各處。</p>'
          + '<div style="background:var(--accent-subtle);border-radius:var(--radius-sm);padding:10px 12px;margin:8px 0">'
          + '<b>更名功能</b><p style="font-size:13px;margin:4px 0 0;color:var(--text-secondary)">點擊「更名」按鈕後可修改店名，修改完成後點「儲存」即生效。</p></div>'
      },
      admin: {
        title: '人員管理說明',
        body: '<p>控制誰可以登入並使用庫存系統。系統分為五個層級：</p>'
          + '<div style="background:var(--accent-subtle);border-radius:var(--radius-sm);padding:10px 12px;margin:8px 0">'
          + '<b>工程師</b><p style="font-size:13px;margin:4px 0 0;color:var(--text-secondary)">系統最高權限，可管理所有人員與設定，可查看進貨價與成本，不可被移除。</p></div>'
          + '<div style="background:var(--accent-subtle);border-radius:var(--radius-sm);padding:10px 12px;margin:8px 0">'
          + '<b>負責人</b><p style="font-size:13px;margin:4px 0 0;color:var(--text-secondary)">由工程師指派，擁有人員管理權限（新增/移除/變更角色），可查看進貨價與成本。</p></div>'
          + '<div style="background:var(--accent-subtle);border-radius:var(--radius-sm);padding:10px 12px;margin:8px 0">'
          + '<b>店長</b><p style="font-size:13px;margin:4px 0 0;color:var(--text-secondary)">可操作所有商品功能（入庫、銷售、盤點、退貨、報廢等），但無法查看進貨價與成本，也無法管理人員。</p></div>'
          + '<div style="background:var(--accent-subtle);border-radius:var(--radius-sm);padding:10px 12px;margin:8px 0">'
          + '<b>店員</b><p style="font-size:13px;margin:4px 0 0;color:var(--text-secondary)">權限同店長，適用於正職員工。後續可依需求調整為較限縮的權限。</p></div>'
          + '<div style="background:var(--accent-subtle);border-radius:var(--radius-sm);padding:10px 12px;margin:8px 0">'
          + '<b>工讀</b><p style="font-size:13px;margin:4px 0 0;color:var(--text-secondary)">權限同店長，適用於兼職人員。後續可依需求調整為較限縮的權限。</p></div>'
          + '<p style="font-size:13px;color:var(--text-muted);margin-top:8px">新增人員時需輸入對方的 LINE userId（U 開頭的 32 位字串），並選擇角色層級。點擊人員旁的 ✎ 按鈕可隨時變更角色。</p>'
      },
      category: {
        title: '商品分類管理說明',
        body: '<p>管理商品的分類標籤，分類用於：</p>'
          + '<ul style="padding-left:20px;font-size:14px;line-height:1.8;color:var(--text-secondary)">'
          + '<li>入庫時快速選擇商品分類</li>'
          + '<li>商品列表的篩選功能</li>'
          + '<li>銷售統計的分類報表</li></ul>'
          + '<p style="font-size:13px;color:var(--text-muted);margin-top:8px">可新增、刪除分類，也可用上下箭頭調整排序。</p>'
      },
      tools: {
        title: '工具說明',
        body: '<div style="background:var(--accent-subtle);border-radius:var(--radius-sm);padding:10px 12px;margin:8px 0">'
          + '<b>條碼列印</b><p style="font-size:13px;margin:4px 0 0;color:var(--text-secondary)">輸入條碼編號，系統會生成條碼圖片並可直接列印標籤。適用於自有商品需要製作條碼吊牌的場景。</p></div>'
          + '<div style="background:var(--danger-light);border-radius:var(--radius-sm);padding:10px 12px;margin:8px 0">'
          + '<b>庫存重建</b><p style="font-size:13px;margin:4px 0 0;color:var(--text-secondary)">根據所有交易紀錄重新計算每個商品的正確庫存數量。僅在庫存數據異常時使用。</p>'
          + '<p style="font-size:12px;margin:4px 0 0;color:var(--danger)">⚠ 此操作會覆蓋所有商品的現有庫存數量，請謹慎操作。</p></div>'
      },
      announcement: {
        title: '登入公告管理說明',
        body: '<p>管理用戶登入後看到的公告彈窗：</p>'
          + '<ul style="padding-left:20px;font-size:14px;line-height:1.8;color:var(--text-secondary)">'
          + '<li>最多可同時啟用 <b>3 則</b>公告</li>'
          + '<li>公告分為三種類型：<span style="color:var(--accent)">一般</span>、<span style="color:var(--warning)">注意</span>、<span style="color:var(--danger)">緊急</span></li>'
          + '<li>用戶看過公告並點「我知道了」後不會重複顯示</li>'
          + '<li>停用的公告不會顯示給用戶，但會保留在列表中</li></ul>'
          + '<p style="font-size:13px;color:var(--text-muted);margin-top:8px">公告標題最多 30 字，內容最多 200 字。</p>'
      },
    };
    var item = info[key];
    if (!item) return;
    var overlay = document.createElement('div');
    overlay.className = 'inv-overlay show';
    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
    overlay.innerHTML = '<div class="inv-modal">'
      + '<div style="font-size:17px;font-weight:700;text-align:center;margin-bottom:12px">' + item.title + '</div>'
      + '<div style="font-size:14px;color:var(--text-secondary);line-height:1.7">' + item.body + '</div>'
      + '<button class="inv-btn primary full" style="margin-top:16px" onclick="this.closest(\'.inv-overlay\').remove()">了解</button>'
      + '</div>';
    document.body.appendChild(overlay);
  },
};
