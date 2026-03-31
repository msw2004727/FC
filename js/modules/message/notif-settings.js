/* ================================================
   SportHub - Admin Notification Toggle Settings
   ================================================ */

const NOTIF_CATEGORY_TOGGLE_FIELDS = Object.freeze([
  { key: 'category_activity', label: '活動通知', hint: '活動報名、候補與活動異動相關推播。' },
  { key: 'category_system', label: '系統通知', hint: '系統訊息、角色變更與歡迎通知。' },
  { key: 'category_tournament', label: '賽事通知', hint: '友誼賽與賽事相關推播。' },
]);

const NOTIF_TYPE_TOGGLE_FIELDS = Object.freeze([
  { key: 'type_signup_success', label: '報名成功', hint: '控制報名成功模板推播。' },
  { key: 'type_cancel_signup', label: '取消報名', hint: '控制取消報名模板推播。' },
  { key: 'type_waitlist_demoted', label: '候補降級', hint: '控制候補降級模板推播。' },
  { key: 'type_event_relisted', label: '活動重新上架', hint: '控制活動重新上架模板推播。' },
  { key: 'type_role_upgrade', label: '角色升級', hint: '控制角色升級模板推播。' },
  { key: 'type_welcome', label: '歡迎通知', hint: '控制新用戶歡迎模板推播。' },
]);

const NOTIF_ALWAYS_ON_FIELDS = Object.freeze([
  { source: 'template:waitlist_promoted', label: '候補遞補', hint: '涉及遞補流程，固定送出。' },
  { source: 'template:event_cancelled', label: '活動取消', hint: '涉及活動取消，固定送出。' },
  { source: 'template:event_changed', label: '活動異動', hint: '涉及活動時間或地點變更，固定送出。' },
  { source: 'target:*', label: '管理員主動廣播', hint: '後台主動推播與廣播固定送出。' },
]);

const NOTIF_TOGGLE_ALLOWED_KEYS = Object.freeze([
  ...NOTIF_CATEGORY_TOGGLE_FIELDS.map(item => item.key),
  ...NOTIF_TYPE_TOGGLE_FIELDS.map(item => item.key),
]);

Object.assign(App, {

  _notifSettingsDocReady: false,
  _notifSettingsDocPromise: null,
  _notifSettingsLoadError: null,

  async _ensureNotifSettingsDocLoaded() {
    if (this._notifSettingsDocReady) {
      return FirebaseService.getCachedDoc?.('siteConfig', 'featureFlags');
    }

    if (this._notifSettingsDocPromise) {
      return this._notifSettingsDocPromise;
    }

    this._notifSettingsDocPromise = (async () => {
      const cachedDoc = FirebaseService.getCachedDoc?.('siteConfig', 'featureFlags');
      if (cachedDoc) {
        this._notifSettingsDocReady = true;
        this._notifSettingsLoadError = null;
        return cachedDoc;
      }

      const loadedDoc = await FirebaseService.ensureSingleDocLoaded?.('siteConfig', 'featureFlags');
      this._notifSettingsDocReady = true;
      this._notifSettingsLoadError = null;
      return loadedDoc;
    })().catch(err => {
      this._notifSettingsLoadError = err;
      throw err;
    }).finally(() => {
      this._notifSettingsDocPromise = null;
    });

    return this._notifSettingsDocPromise;
  },

  retryNotifSettingsLoad() {
    this._notifSettingsDocReady = false;
    this._notifSettingsLoadError = null;
    this.renderNotifSettings();
  },

  _buildNotifToggleRow(field, currentToggles) {
    const checked = currentToggles[field.key] !== false ? ' checked' : '';
    return ''
      + '<div style="display:flex;align-items:center;justify-content:space-between;gap:.75rem;padding:.7rem 0;border-top:1px solid var(--border)">'
      +   '<div style="min-width:0;flex:1">'
      +     '<div style="font-size:.84rem;font-weight:600;color:var(--text-primary)">' + escapeHTML(field.label) + '</div>'
      +     '<div style="font-size:.75rem;color:var(--text-muted);margin-top:.15rem;line-height:1.55">' + escapeHTML(field.hint) + '</div>'
      +   '</div>'
      +   '<label class="toggle-switch" style="margin:0;flex-shrink:0">'
      +     '<input type="checkbox" data-notif-toggle-key="' + escapeHTML(field.key) + '"' + checked + '>'
      +     '<span class="toggle-slider"></span>'
      +   '</label>'
      + '</div>';
  },

  _buildNotifAlwaysOnRow(field) {
    return ''
      + '<div style="display:flex;align-items:center;justify-content:space-between;gap:.75rem;padding:.7rem 0;border-top:1px solid var(--border);opacity:.72">'
      +   '<div style="min-width:0;flex:1">'
      +     '<div style="font-size:.84rem;font-weight:600;color:var(--text-primary)">' + escapeHTML(field.label) + '</div>'
      +     '<div style="font-size:.75rem;color:var(--text-muted);margin-top:.15rem;line-height:1.55">' + escapeHTML(field.hint) + '</div>'
      +   '</div>'
      +   '<label class="toggle-switch" style="margin:0;flex-shrink:0">'
      +     '<input type="checkbox" checked disabled>'
      +     '<span class="toggle-slider"></span>'
      +   '</label>'
      + '</div>';
  },

  _validateNotifToggles(toggles) {
    if (!toggles || typeof toggles !== 'object' || Array.isArray(toggles)) {
      return { ok: false, message: '推播開關格式錯誤' };
    }

    const allowed = new Set(NOTIF_TOGGLE_ALLOWED_KEYS);
    const keys = Object.keys(toggles);
    if (!keys.every(key => allowed.has(key))) {
      return { ok: false, message: '推播開關包含未允許的設定鍵' };
    }

    if (!keys.every(key => typeof toggles[key] === 'boolean')) {
      return { ok: false, message: '推播開關的值必須是布林' };
    }

    return { ok: true };
  },

  _collectNotifToggleFormValues() {
    const toggles = {};
    document.querySelectorAll('#notif-settings-root [data-notif-toggle-key]').forEach(input => {
      const key = String(input?.dataset?.notifToggleKey || '').trim();
      if (!key) return;
      toggles[key] = !!input.checked;
    });
    return toggles;
  },

  _setNotifSettingsSaving(isSaving) {
    const saveBtn = document.getElementById('notif-settings-save-btn');
    if (!saveBtn) return;
    saveBtn.disabled = !!isSaving;
    saveBtn.textContent = isSaving ? '儲存中...' : '儲存推播開關';
  },

  renderNotifSettings() {
    const root = document.getElementById('notif-settings-root');
    if (!root) return;

    if (!this.hasPermission('admin.notif.entry')) {
      root.innerHTML = '<div class="info-card"><div class="info-title">權限不足</div><div style="font-size:.78rem;color:var(--text-muted)">你沒有查看推播通知設定的權限。</div></div>';
      return;
    }

    if (this._notifSettingsLoadError) {
      root.innerHTML = ''
        + '<div class="info-card">'
        +   '<div class="info-title">載入失敗</div>'
        +   '<div style="font-size:.78rem;color:var(--text-muted);line-height:1.7">通知設定尚未成功載入，為了避免覆寫既有開關，請重新載入後再儲存。</div>'
        +   '<button class="secondary-btn full-width" style="margin-top:.85rem" onclick="App.retryNotifSettingsLoad()">重新載入</button>'
        + '</div>';
      return;
    }

    if (!this._notifSettingsDocReady) {
      root.innerHTML = '<div class="info-card"><div class="info-title">載入中</div><div style="font-size:.78rem;color:var(--text-muted);line-height:1.7">正在同步目前的推播開關設定，載入完成前不會顯示可儲存的表單。</div></div>';
      void this._ensureNotifSettingsDocLoaded()
        .then(() => {
          this.renderNotifSettings();
        })
        .catch(err => {
          console.error('[NotifSettings] load failed:', err);
          this.renderNotifSettings();
        });
      return;
    }

    const currentToggles = FirebaseService.getNotificationToggles?.() || {};
    root.innerHTML = ''
      + '<div class="info-card">'
      +   '<div class="info-title">設定說明</div>'
      +   '<div style="font-size:.78rem;color:var(--text-muted);line-height:1.7">這裡控制的是平台送出的 LINE 推播，不影響站內信箱。未設定的項目預設為開啟，關閉後只會影響對應分類或模板推播。</div>'
      + '</div>'
      + '<div class="info-card">'
      +   '<div class="info-title">分類開關</div>'
      +   NOTIF_CATEGORY_TOGGLE_FIELDS.map(field => this._buildNotifToggleRow(field, currentToggles)).join('')
      + '</div>'
      + '<div class="info-card">'
      +   '<div class="info-title">通知類型開關</div>'
      +   '<div style="font-size:.76rem;color:var(--text-muted);margin-bottom:.1rem">這些開關會在分類開關之外再做一次細部控制。</div>'
      +   NOTIF_TYPE_TOGGLE_FIELDS.map(field => this._buildNotifToggleRow(field, currentToggles)).join('')
      + '</div>'
      + '<div class="info-card">'
      +   '<div class="info-title">固定送出的通知</div>'
      +   '<div style="font-size:.76rem;color:var(--text-muted);margin-bottom:.1rem">以下推播不受開關影響，避免漏送關鍵通知。</div>'
      +   NOTIF_ALWAYS_ON_FIELDS.map(field => this._buildNotifAlwaysOnRow(field)).join('')
      + '</div>'
      + '<button class="primary-btn full-width" id="notif-settings-save-btn" onclick="App.saveNotifSettings()">儲存推播開關</button>';
  },

  async saveNotifSettings() {
    if (!this.hasPermission('admin.notif.toggle')) {
      this.showToast('權限不足');
      return;
    }

    try {
      await this._ensureNotifSettingsDocLoaded();
    } catch (err) {
      console.error('[NotifSettings] preload failed:', err);
      this.showToast('通知設定載入失敗，請稍後再試');
      return;
    }

    const toggles = this._collectNotifToggleFormValues();
    const validation = this._validateNotifToggles(toggles);
    if (!validation.ok) {
      this.showToast(validation.message);
      return;
    }

    this._setNotifSettingsSaving(true);
    try {
      if (typeof db !== 'undefined') {
        await db.collection('siteConfig').doc('featureFlags').set({
          notificationToggles: toggles,
        }, { merge: true });
      }

      FirebaseService.setNotificationTogglesCache?.(toggles);

      this.showToast('推播通知設定已儲存');
      this.renderNotifSettings();
    } catch (err) {
      console.error('[NotifSettings] save failed:', err);
      this.showToast('儲存失敗，請稍後再試');
    } finally {
      this._setNotifSettingsSaving(false);
    }
  },

});
