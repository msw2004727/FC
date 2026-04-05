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
    var _hp = typeof InvAuth !== 'undefined' && InvAuth.hasPerm ? InvAuth.hasPerm.bind(InvAuth) : function() { return true; };
    var ib = function(k) { return ' <button class="inv-info-btn" onclick="InvSettings._showInfo(\'' + k + '\')">?</button>'; };
    var h4 = function (t, k) { return '<h4 class="inv-section-head">' + t + (k ? ib(k) : '') + '</h4>'; };
    // 店名 fallback
    var shopName = (cfg.shopName && /^[\x20-\x7E\u4e00-\u9fff]+$/.test(cfg.shopName)) ? cfg.shopName : 'ToosterX';
    var sections = '';

    // Shop name card
    if (_hp('settings.shop')) {
      sections += this._card(h4('店鋪資訊', 'shop') +
        '<div id="inv-shop-name-area" style="display:flex;align-items:center;gap:8px">' +
          '<span style="font-size:14px;color:var(--text-secondary);flex-shrink:0">店名：</span>' +
          '<span id="inv-shop-name-display" style="flex:1;font-size:15px;font-weight:600;color:var(--text-primary)">' + esc(shopName) + '</span>' +
          '<button class="inv-btn outline sm" onclick="InvSettings._enableShopNameEdit()" style="font-size:12px;min-height:30px;padding:2px 12px">更名</button>' +
        '</div>');
    }

    // People management card with wrench button
    if (_hp('settings.people')) {
      var wrenchBtn = '<button onclick="InvSettings._showPermConfigModal()" style="width:22px;height:22px;border-radius:50%;border:1.5px solid var(--accent);background:var(--bg-card);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0;vertical-align:middle" title="權限設定"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg></button>';
      var editBtnLabel = this._adminEditMode ? '完成' : '編輯';
      var editBtnStyle = this._adminEditMode
        ? 'background:var(--success,#16a34a);color:#fff;border:none'
        : 'background:var(--accent);color:#fff;border:none';
      var editBtn = '<button onclick="InvSettings._toggleAdminEditMode()" style="' + editBtnStyle + ';border-radius:6px;cursor:pointer;font-size:11px;padding:3px 10px;font-weight:600;margin-left:auto;flex-shrink:0">' + editBtnLabel + '</button>';
      sections += this._card(
        '<div style="display:flex;align-items:center;gap:6px">' +
          '<h4 class="inv-section-head" style="margin:0;flex-shrink:0">人員管理</h4>' +
          ib('admin') + wrenchBtn + editBtn +
        '</div>' +
        '<div id="inv-admin-list" style="margin-top:12px"></div>'
      );
    }

    // Category card
    if (_hp('settings.categories')) {
      sections += this._card(h4('商品分類管理', 'category') + '<div id="inv-category-list"></div>');
    }

    // Barcode prefix card (always shown if settings.entry)
    sections += this._card(h4('條碼設定', 'barcode') +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">' +
        '<span style="font-size:13px;color:var(--text-secondary);flex-shrink:0">自動編號前綴：</span>' +
        '<input id="inv-barcode-prefix" class="inv-input" value="' + esc(cfg.barcodePrefix || 'TX') + '" maxlength="4" style="width:70px;height:34px;font-size:14px;font-weight:600;text-align:center" />' +
        '<span style="font-size:12px;color:var(--text-muted)">下一號：' + ((cfg.nextBarcode || 0) + 1) + '</span>' +
        '<button class="inv-btn primary sm" onclick="InvSettings._saveBarcodePrefix()" style="font-size:12px;min-height:30px;padding:2px 12px">儲存</button>' +
      '</div>');

    // Tools card
    if (_hp('settings.barcode_print') || _hp('settings.rebuild')) {
      var toolBtns = '';
      if (_hp('settings.barcode_print')) {
        toolBtns += '<button class="inv-btn outline full sm" onclick="InvSettings._promptBarcodePrint()">條碼列印</button>';
      }
      if (_hp('settings.rebuild')) {
        toolBtns += '<div style="display:flex;gap:4px">' +
          '<button class="inv-btn outline full sm" onclick="InvSettings.rebuildStock()" style="color:var(--danger);border-color:var(--danger)">庫存重建</button>' +
          '<button class="inv-info-btn" onclick="InvSettings._showInfo(\'rebuild\')" style="flex-shrink:0">?</button>' +
        '</div>';
        toolBtns += '<button class="inv-btn outline full sm" onclick="InvSettings.backfillTxProductNames()">交易名稱修復</button>';
      }
      sections += this._card(h4('工具', 'tools') +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' + toolBtns + '</div>');
    }

    // Log viewer card (owner + manager)
    if (_hp('settings.logs') || InvAuth.getRole() === 'owner' || InvAuth.getRole() === 'manager') {
      sections += this._card(h4('操作紀錄', 'logs') +
        '<button class="inv-btn outline full" onclick="InvSettings._showLogViewer()">查詢 LOG</button>');
    }

    // Announcements card
    if (_hp('settings.announcements')) {
      sections += this._card(h4('登入公告管理', 'announcement') + '<div id="inv-announcement-list"></div>');
    }

    c.innerHTML = '<div style="padding:16px;">' + sections + '</div>';
    if (_hp('settings.people')) this.renderAdminList(cfg.adminUids || []);
    if (_hp('settings.announcements')) this.renderAnnouncements();
    if (_hp('settings.categories')) this.renderCategories(cfg.categories || []);
  },

  // ══════ 人員白名單（工程師/負責人/店長/店員/工讀）══════
  _OWNER_UID: 'U7774e1410479bafff4997f51b2c47b95',
  _adminEditMode: false,

  _toggleAdminEditMode() {
    this._adminEditMode = !this._adminEditMode;
    // 只更新按鈕文字 + 重渲染人員列表，不重建整頁
    var btn = document.querySelector('[onclick*="_toggleAdminEditMode"]');
    if (btn) {
      btn.textContent = this._adminEditMode ? '完成' : '編輯';
      btn.style.background = this._adminEditMode ? 'var(--success,#16a34a)' : 'var(--accent)';
    }
    this.renderAdminList();
  },

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

    var nameMap = cfg.adminNames || {};
    var html = '<div style="display:flex;flex-wrap:wrap;gap:8px">';
    for (var i = 0; i < uids.length; i++) {
      var u = uids[i], isMe = u === myUid, isUOwner = u === this._OWNER_UID;
      var role = this._getUserRole(u, cfg);
      var meta = this._ROLE_META[role] || this._ROLE_META.leader;
      var tagColor = meta.textColor || '#fff';
      var displayName = nameMap[u] || u.substring(0, 8) + '…';
      var border = isMe ? 'border:2px solid var(--accent)' : 'border:1px solid ' + meta.border;
      var bg = isMe ? 'background:var(--accent-light)' : 'background:var(--bg-elevated)';

      // 操作按鈕（僅編輯模式）
      var actions = '';
      if (canManage && !isUOwner && !isMe && this._adminEditMode) {
        actions =
          '<div style="display:flex;gap:2px;margin-top:4px">' +
            '<button onclick="InvSettings._showRolePicker(\'' + esc(u) + '\')" style="flex:1;padding:3px;border:1px solid var(--accent);border-radius:4px;background:var(--bg-card);color:var(--accent);font-size:10px;cursor:pointer">✎ 角色</button>' +
            '<button onclick="InvSettings.removeAdmin(\'' + esc(u) + '\')" style="flex:1;padding:3px;border:1px solid var(--danger);border-radius:4px;background:var(--bg-card);color:var(--danger);font-size:10px;cursor:pointer">✕ 移除</button>' +
          '</div>';
      }

      html +=
        '<div style="width:calc(50% - 4px);box-sizing:border-box;padding:10px;border-radius:var(--radius-sm);' + bg + ';' + border + ';text-align:center">' +
          '<div style="font-size:14px;font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="' + esc(u) + '">' + esc(displayName) + '</div>' +
          '<span style="display:inline-block;margin-top:4px;background:' + meta.bg + ';color:' + tagColor + ';padding:2px 10px;border-radius:999px;font-size:11px;font-weight:600">' + meta.label + '</span>' +
          actions +
        '</div>';
    }
    html += '</div>';
    if (canManage && this._adminEditMode) {
      html += '<div style="display:flex;gap:8px;margin-top:10px">' +
        '<input id="inv-new-admin-uid" class="inv-input" placeholder="輸入 LINE userId" style="flex:1;min-width:0;height:36px;font-size:13px" />' +
        '<select id="inv-new-admin-role" class="inv-select" style="min-width:72px;height:36px;font-size:13px;flex-shrink:0;padding:0 4px">' +
          '<option value="leader">店長</option><option value="staff">店員</option><option value="part">工讀</option>' +
          (isOwner ? '<option value="manager">負責人</option>' : '') +
        '</select>' +
        '<button class="inv-btn primary sm" style="flex-shrink:0" onclick="InvSettings.addAdmin()">新增</button></div>';
    } else if (!canManage) {
      html += '<div style="font-size:12px;color:var(--text-muted);margin-top:8px">僅負責人可管理人員</div>';
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
      InvUtils.writeLog('setting_shop_name', name);
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
      InvUtils.writeLog('setting_admin_add', roleName + ' ' + uid);
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
      InvUtils.writeLog('setting_admin_remove', uid);
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

  // ══════ 條碼前綴設定 ══════
  async _saveBarcodePrefix() {
    var input = document.getElementById('inv-barcode-prefix');
    var val = (input ? input.value : '').trim().toUpperCase();
    if (!val || !/^[A-Z]{1,4}$/.test(val)) {
      InvApp.showToast('前綴需為 1-4 位英文字母');
      return;
    }
    try {
      await this._cfgRef().update({ barcodePrefix: val });
      InvUtils.writeLog('setting_barcode_prefix', val);
      InvApp.showToast('前綴已儲存：' + val);
    } catch (e) {
      InvApp.showToast('儲存失敗：' + (e.message || ''));
    }
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

  /** 回填交易紀錄缺少的 productName（從 inv_products 對照 barcode） */
  async backfillTxProductNames() {
    if (!confirm('此操作將修復交易紀錄中缺少商品名稱的項目，確定嗎？')) return;
    InvApp.showToast('正在掃描交易紀錄...');
    try {
      if (!InvProducts._loaded) await InvProducts.loadAll();
      var snap = await db.collection('inv_transactions').get();
      var toFix = [];
      snap.forEach(function(doc) {
        var data = doc.data();
        if (!data.productName && data.barcode) {
          var product = InvProducts.getByBarcode(data.barcode);
          if (product && product.name) {
            toFix.push({ docId: doc.id, productName: product.name });
          }
        }
      });
      if (toFix.length === 0) {
        InvApp.showToast('所有交易紀錄都已有商品名稱');
        return;
      }
      if (!confirm('找到 ' + toFix.length + ' 筆缺少商品名稱的交易紀錄，確定修復？')) return;
      // 每批 500 筆（Firestore batch 上限）
      for (var start = 0; start < toFix.length; start += 500) {
        var chunk = toFix.slice(start, start + 500);
        var batch = db.batch();
        for (var i = 0; i < chunk.length; i++) {
          batch.update(db.collection('inv_transactions').doc(chunk[i].docId), { productName: chunk[i].productName });
        }
        await batch.commit();
      }
      InvApp.showToast('已修復 ' + toFix.length + ' 筆交易紀錄的商品名稱');
      InvUtils.writeLog('backfill_tx_names', '修復 ' + toFix.length + ' 筆交易紀錄商品名稱');
    } catch (e) {
      console.error('[InvSettings] backfillTxProductNames:', e);
      InvApp.showToast('修復失敗：' + (e.message || ''));
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

  // ══════ 權限設定 Modal ══════
  _showPermConfigModal() {
    if (!this._canManageAdmins()) { InvApp.showToast('權限不足'); return; }
    if (typeof InvPermissions === 'undefined') { InvApp.showToast('權限模組未載入'); return; }
    var existing = document.getElementById('inv-perm-config-overlay');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'inv-perm-config-overlay';
    overlay.className = 'inv-overlay show';
    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
    overlay.addEventListener('touchmove', function(e) {
      if (!e.target.closest('.inv-modal')) { e.preventDefault(); e.stopPropagation(); }
    }, { passive: false });

    var roleOpts = [
      { key: 'manager', label: '負責人' },
      { key: 'leader', label: '店長' },
      { key: 'staff', label: '店員' },
      { key: 'part', label: '工讀' },
    ];
    var selectHtml = '<select id="inv-perm-role-sel" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:8px;font-size:14px;margin-bottom:12px;background:var(--bg-card);color:var(--text-primary)">';
    for (var ri = 0; ri < roleOpts.length; ri++) {
      selectHtml += '<option value="' + roleOpts[ri].key + '">' + InvApp.escapeHTML(roleOpts[ri].label) + '</option>';
    }
    selectHtml += '</select>';

    overlay.innerHTML =
      '<div class="inv-modal" style="max-width:420px;width:92%;max-height:80vh;overflow-y:auto">' +
        '<h3 style="margin:0 0 12px;font-size:17px;font-weight:700;text-align:center">權限設定</h3>' +
        selectHtml +
        '<div id="inv-perm-toggles"></div>' +
        '<button class="inv-btn primary full" style="margin-top:12px" onclick="document.getElementById(\'inv-perm-config-overlay\').remove()">完成</button>' +
      '</div>';
    document.body.appendChild(overlay);

    var self = this;
    var sel = document.getElementById('inv-perm-role-sel');
    self._renderPermToggles(sel.value);
    sel.addEventListener('change', function() {
      self._renderPermToggles(this.value);
    });
  },

  _renderPermToggles(role) {
    var wrap = document.getElementById('inv-perm-toggles');
    if (!wrap || typeof InvPermissions === 'undefined') return;
    var merged = InvPermissions.getMergedPerms(role);
    var catalog = InvPermissions.CATALOG;
    var esc = InvApp.escapeHTML;
    var html = '';
    for (var gi = 0; gi < catalog.length; gi++) {
      var group = catalog[gi];
      html += '<div style="font-size:13px;font-weight:700;color:var(--text-primary);margin:10px 0 4px;padding:4px 0;border-bottom:2px solid var(--accent)">' + esc(group.group) + '</div>';
      for (var ii = 0; ii < group.items.length; ii++) {
        var item = group.items[ii];
        var checked = merged[item.code] ? ' checked' : '';
        html +=
          '<label style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">' +
            '<input type="checkbox" data-code="' + esc(item.code) + '" data-role="' + esc(role) + '"' + checked + ' style="width:18px;height:18px;flex-shrink:0" />' +
            '<span style="flex:1;font-size:13px">' + esc(item.label) + '</span>' +
            '<button class="inv-info-btn" onclick="event.preventDefault();event.stopPropagation();InvSettings._showPermDesc(\'' + esc(item.code) + '\')" style="flex-shrink:0">?</button>' +
          '</label>';
      }
    }
    wrap.innerHTML = html;
    // Bind toggle events
    var checkboxes = wrap.querySelectorAll('input[type="checkbox"]');
    for (var ci = 0; ci < checkboxes.length; ci++) {
      checkboxes[ci].addEventListener('change', function() {
        var code = this.getAttribute('data-code');
        var r = this.getAttribute('data-role');
        var val = this.checked;
        InvPermissions.savePerm(r, code, val).catch(function() { InvApp.showToast('儲存失敗'); });
      });
    }
  },

  _showPermDesc(code) {
    if (typeof InvPermissions === 'undefined') return;
    var catalog = InvPermissions.CATALOG;
    var desc = '';
    var label = '';
    for (var gi = 0; gi < catalog.length; gi++) {
      for (var ii = 0; ii < catalog[gi].items.length; ii++) {
        if (catalog[gi].items[ii].code === code) {
          desc = catalog[gi].items[ii].desc;
          label = catalog[gi].items[ii].label;
          break;
        }
      }
    }
    if (!desc) return;
    InvApp.showToast(label + '：' + desc, 4000);
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
        body: '<p>控制誰可以登入並使用庫存系統。系統分為四個層級：</p>'
          + '<div style="background:var(--accent-subtle);border-radius:var(--radius-sm);padding:10px 12px;margin:8px 0">'
          + '<b>負責人</b><p style="font-size:13px;margin:4px 0 0;color:var(--text-secondary)">最高負責人，擁有人員管理權限（新增/移除/變更角色），可查看進貨價與成本。</p></div>'
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
      barcode: {
        title: '條碼設定說明',
        body: '<div style="background:var(--accent-subtle);border-radius:var(--radius-sm);padding:10px 12px;margin:8px 0">'
          + '<b>自動編號前綴</b><p style="font-size:13px;margin:4px 0 0;color:var(--text-secondary)">自有商品使用「自動產生」條碼時的前綴（預設 TX）。例如前綴 TX → 產生 TX000001、TX000002…</p></div>'
          + '<div style="background:var(--accent-subtle);border-radius:var(--radius-sm);padding:10px 12px;margin:8px 0">'
          + '<b>下一號</b><p style="font-size:13px;margin:4px 0 0;color:var(--text-secondary)">下次自動產生時會使用的流水號。每次產生會自動遞增，不會重複。</p></div>'
          + '<p style="font-size:13px;color:var(--text-muted);margin-top:8px">有原廠條碼的商品直接掃碼入庫即可，無需使用自動編號。自動編號適用於自製商品、散裝品或遺失條碼的商品。</p>'
      },
      tools: {
        title: '工具說明',
        body: '<div style="background:var(--accent-subtle);border-radius:var(--radius-sm);padding:10px 12px;margin:8px 0">'
          + '<b>條碼列印</b><p style="font-size:13px;margin:4px 0 0;color:var(--text-secondary)">輸入條碼編號，系統會生成條碼圖片並可直接列印標籤。適用於自有商品需要製作條碼吊牌的場景。</p></div>'
          + '<div style="background:var(--danger-light);border-radius:var(--radius-sm);padding:10px 12px;margin:8px 0">'
          + '<b>庫存重建</b><p style="font-size:13px;margin:4px 0 0;color:var(--text-secondary)">根據交易紀錄重算正確庫存（詳情請點庫存重建旁的 ? 按鈕）。</p></div>'
      },
      rebuild: {
        title: '庫存重建說明',
        body: '<div style="background:var(--accent-subtle);border-radius:var(--radius-sm);padding:10px 12px;margin:8px 0">'
          + '<b>什麼時候用？</b><p style="font-size:13px;margin:4px 0 0;color:var(--text-secondary)">庫存數字「不對」的時候。例如商品顯示庫存 5 件，但你覺得跟實際不符。正常操作下不需要使用。</p></div>'
          + '<div style="background:var(--accent-subtle);border-radius:var(--radius-sm);padding:10px 12px;margin:8px 0">'
          + '<b>它怎麼算？</b><p style="font-size:13px;margin:4px 0 0;color:var(--text-secondary)">把每個商品的所有交易紀錄從頭到尾加減一遍。<br>例如：入庫 +10 → 賣掉 -3 → 退貨 +1 → 報廢 -1 = 理論庫存應該是 7。</p></div>'
          + '<div style="background:var(--accent-subtle);border-radius:var(--radius-sm);padding:10px 12px;margin:8px 0">'
          + '<b>操作流程</b>'
          + '<ol style="font-size:13px;margin:4px 0 0;padding-left:18px;color:var(--text-secondary);line-height:1.7">'
          + '<li>按「庫存重建」→ 確認要執行</li>'
          + '<li>系統掃描全部交易紀錄，算出每個商品「應該有幾件」</li>'
          + '<li>跟目前庫存比對，列出有差異的商品</li>'
          + '<li>顯示差異（例如：球衣A 目前 5 → 應該是 8）→ 再次確認</li>'
          + '<li>確認後把庫存數字改成計算出來的值</li></ol></div>'
          + '<div style="background:var(--danger-light);border-radius:var(--radius-sm);padding:10px 12px;margin:8px 0">'
          + '<b>注意事項</b>'
          + '<p style="font-size:13px;margin:4px 0 0;color:var(--danger)">此操作會直接覆蓋所有商品的庫存數字，請確認後再執行。如果庫存沒有異常，不需要使用此功能。</p></div>'
      },
      logs: {
        title: '操作紀錄說明',
        body: '<p>記錄所有人員在庫存系統中的操作行為：</p>'
          + '<div style="background:var(--accent-subtle);border-radius:var(--radius-sm);padding:10px 12px;margin:8px 0">'
          + '<b>記錄範圍</b><p style="font-size:13px;margin:4px 0 0;color:var(--text-secondary)">登入/登出、入庫、銷售、退貨、報廢、商品編輯、盤點調整、人員管理、設定變更等所有操作。</p></div>'
          + '<div style="background:var(--accent-subtle);border-radius:var(--radius-sm);padding:10px 12px;margin:8px 0">'
          + '<b>篩選功能</b><p style="font-size:13px;margin:4px 0 0;color:var(--text-secondary)">可依時間範圍、行為類型、人員暱稱篩選，快速找到特定操作紀錄。</p></div>'
          + '<p style="font-size:13px;color:var(--text-muted);margin-top:8px">紀錄為不可修改、不可刪除，確保稽核完整性。</p>'
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

  // ══════ 操作紀錄查詢 ══════
  _logData: [],
  async _showLogViewer() {
    var existing = document.getElementById('inv-log-viewer');
    if (existing) existing.remove();

    var ov = document.createElement('div');
    ov.id = 'inv-log-viewer';
    ov.className = 'inv-overlay show';
    ov.onclick = function(e) { if (e.target === ov) ov.remove(); };
    ov.addEventListener('touchmove', function(e) { if (!e.target.closest('.inv-modal')) { e.preventDefault(); e.stopPropagation(); } }, { passive: false });

    var labels = InvUtils.LOG_LABELS || {};
    var actionOpts = '<option value="">全部行為</option>';
    Object.keys(labels).forEach(function(k) { actionOpts += '<option value="' + k + '">' + InvApp.escapeHTML(labels[k]) + '</option>'; });

    var now = new Date();
    var pad = function(n) { return String(n).padStart(2, '0'); };
    var today = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
    var weekAgo = new Date(now.getTime() - 7 * 86400000);
    var startDef = weekAgo.getFullYear() + '-' + pad(weekAgo.getMonth() + 1) + '-' + pad(weekAgo.getDate());

    ov.innerHTML =
      '<div class="inv-modal" style="max-width:480px;width:95%;max-height:88vh;display:flex;flex-direction:column">' +
        '<div style="flex-shrink:0;padding-bottom:10px;border-bottom:1px solid var(--border)">' +
          '<h3 style="margin:0 0 10px;font-size:17px;font-weight:700">操作紀錄</h3>' +
          '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
            '<input type="date" id="log-start" class="inv-input" value="' + startDef + '" style="flex:1;min-width:110px;height:34px;font-size:12px;padding:4px 6px" />' +
            '<input type="date" id="log-end" class="inv-input" value="' + today + '" style="flex:1;min-width:110px;height:34px;font-size:12px;padding:4px 6px" />' +
          '</div>' +
          '<div style="display:flex;gap:6px;margin-top:6px">' +
            '<select id="log-action" class="inv-select" style="flex:1;min-width:0;height:34px;font-size:13px;padding:0 4px">' + actionOpts + '</select>' +
            '<input type="text" id="log-name" class="inv-input" placeholder="暱稱" style="width:70px;flex-shrink:0;height:34px;font-size:12px" />' +
            '<button id="log-search" class="inv-btn primary sm" style="flex-shrink:0;height:34px;font-size:12px;padding:0 12px">查詢</button>' +
          '</div>' +
        '</div>' +
        '<div id="log-list" style="flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding-top:8px">' +
          '<div style="text-align:center;padding:30px;color:var(--text-muted);font-size:13px">點擊「查詢」載入紀錄</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);

    var self = this;
    document.getElementById('log-search').addEventListener('click', function() { self._loadLogs(); });
  },

  async _loadLogs() {
    var wrap = document.getElementById('log-list');
    if (!wrap) return;
    wrap.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted)">載入中...</div>';

    var startVal = document.getElementById('log-start').value;
    var endVal = document.getElementById('log-end').value;
    var actionFilter = document.getElementById('log-action').value;
    var nameFilter = (document.getElementById('log-name').value || '').trim().toLowerCase();

    var startTs = startVal ? firebase.firestore.Timestamp.fromDate(new Date(startVal + 'T00:00:00')) : null;
    var endDate = endVal ? new Date(endVal + 'T23:59:59') : new Date();
    var endTs = firebase.firestore.Timestamp.fromDate(endDate);

    try {
      var q = db.collection('inv_logs').orderBy('createdAt', 'desc');
      if (startTs) q = q.where('createdAt', '>=', startTs);
      q = q.where('createdAt', '<=', endTs);
      var snap = await q.limit(500).get();

      var logs = [];
      snap.forEach(function(d) { logs.push(d.data()); });

      // 前端篩選 action + name
      if (actionFilter) logs = logs.filter(function(l) { return l.action === actionFilter; });
      if (nameFilter) logs = logs.filter(function(l) { return (l.name || '').toLowerCase().indexOf(nameFilter) !== -1; });

      if (!logs.length) {
        wrap.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted);font-size:13px">無符合條件的紀錄</div>';
        return;
      }

      var labels = InvUtils.LOG_LABELS || {};
      var esc = InvApp.escapeHTML;
      var html = '';
      for (var i = 0; i < logs.length; i++) {
        var l = logs[i];
        var dt = l.createdAt && l.createdAt.toDate ? l.createdAt.toDate() : null;
        var timeStr = dt ? dt.getFullYear() + '/' + String(dt.getMonth() + 1).padStart(2, '0') + '/' + String(dt.getDate()).padStart(2, '0') + ' ' + String(dt.getHours()).padStart(2, '0') + ':' + String(dt.getMinutes()).padStart(2, '0') : '-';
        var actionLabel = labels[l.action] || l.action || '-';
        html +=
          '<div style="display:flex;align-items:flex-start;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px">' +
            '<span style="font-weight:600;color:var(--text-primary);white-space:nowrap;min-width:48px">' + esc(l.name || '?') + '</span>' +
            '<span style="color:var(--text-muted);white-space:nowrap;min-width:100px">' + timeStr + '</span>' +
            '<span style="padding:1px 6px;border-radius:var(--radius-full);background:var(--accent-subtle);color:var(--accent);font-size:11px;white-space:nowrap;flex-shrink:0">' + esc(actionLabel) + '</span>' +
            '<span style="color:var(--text-secondary);flex:1;min-width:0;word-break:break-all">' + esc(l.detail || '') + '</span>' +
          '</div>';
      }
      wrap.innerHTML = '<div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">共 ' + logs.length + ' 筆</div>' + html;
    } catch (e) {
      console.error('[InvSettings] _loadLogs failed:', e);
      wrap.innerHTML = '<div style="color:var(--danger);padding:20px;text-align:center">載入失敗：' + (e.message || '') + '</div>';
    }
  },
};
