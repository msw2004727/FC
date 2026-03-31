/* ================================================
   SportHub — Message: Notification Templates & LINE Push
   Split from message-inbox.js — pure move, no logic changes
   Note: innerHTML usage is safe — all user content passes through escapeHTML()
   依賴：message-line-push.js（_queueLinePush）
   ================================================ */

Object.assign(App, {

  // ══════════════════════════════════
  //  Inbox Delivery Core（從 message-admin.js 搬入，確保任何頁面都能發送通知）
  // ══════════════════════════════════

  _recentInboxDeliveryCache: {},

  _buildInboxDeliveryDedupeKey(category, title, body, targetUid, senderName, extra) {
    const explicitKey = typeof extra?.dedupeKey === 'string' ? extra.dedupeKey.trim() : '';
    if (explicitKey) return explicitKey;
    const normalizedRoles = Array.isArray(extra?.targetRoles)
      ? [...extra.targetRoles].map(v => String(v || '').trim()).filter(Boolean).sort().join(',')
      : '';
    return [
      String(category || '').trim(),
      String(title || '').trim(),
      String(body || '').trim(),
      String(targetUid || '').trim(),
      String(extra?.targetTeamId || '').trim(),
      normalizedRoles,
      String(extra?.targetType || '').trim(),
      String(senderName || '').trim(),
    ].join('||');
  },

  _claimRecentInboxDeliveryKey(dedupeKey, nowMs) {
    if (!dedupeKey) return true;
    const windowMs = 5000;
    const cache = this._recentInboxDeliveryCache || (this._recentInboxDeliveryCache = {});
    Object.keys(cache).forEach(key => {
      if (nowMs - cache[key] > windowMs) delete cache[key];
    });
    const lastSentAt = Number(cache[dedupeKey] || 0);
    if (lastSentAt && (nowMs - lastSentAt) < windowMs) {
      return false;
    }
    cache[dedupeKey] = nowMs;
    return true;
  },

  _releaseRecentInboxDeliveryKey(dedupeKey) {
    if (!dedupeKey || !this._recentInboxDeliveryCache) return;
    delete this._recentInboxDeliveryCache[dedupeKey];
  },

  /** 投遞到用戶收件箱（只建立一封） */
  _deliverMessageToInbox(title, body, category, categoryName, targetUid, senderName, extra) {
    const preview = body.length > 40 ? body.slice(0, 40) + '...' : body;
    const now = new Date();
    const nowMs = now.getTime();
    const timeStr = `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    const currentUser = ApiService.getCurrentUser?.() || null;
    const senderUid = auth?.currentUser?.uid || currentUser?.uid || null;
    const directTargetUid = targetUid || null;
    const targetTeamId = extra?.targetTeamId || null;
    const targetRoles = extra?.targetRoles || null;
    const targetType = extra?.targetType
      || (directTargetUid ? 'individual' : (targetTeamId ? 'team' : ((Array.isArray(targetRoles) && targetRoles.length) ? 'role' : 'all')));
    const dedupeKey = this._buildInboxDeliveryDedupeKey(category, title, body, directTargetUid, senderName, extra);
    if (!this._claimRecentInboxDeliveryKey(dedupeKey, nowMs)) {
      console.warn('[deliverMsg] skip recent duplicate:', dedupeKey);
      return null;
    }
    const newMsg = {
      id: 'msg_' + nowMs + '_' + Math.random().toString(36).slice(2, 6),
      type: category,
      typeName: categoryName,
      title,
      preview,
      body,
      time: timeStr,
      unread: true,
      readBy: [],
      hiddenBy: [],
      senderName,
      fromUid: senderUid,
      toUid: directTargetUid,
      targetUid: directTargetUid,
      targetTeamId,
      targetRoles,
      targetType,
      dedupeKey,
      ...(extra || {}),
    };
    // Phase 4: 只寫 per-user inbox（透過 CF），不再寫 messages/ 集合
    const source = FirebaseService._cache.messages;
    source.unshift(newMsg);
    FirebaseService._deliverToInboxCF?.(
      newMsg, directTargetUid, targetTeamId, targetRoles, targetType
    )?.catch(err => {
      const index = source.indexOf(newMsg);
      if (index !== -1) source.splice(index, 1);
      this._releaseRecentInboxDeliveryKey(dedupeKey);
      this.renderMessageList?.();
      this.updateNotifBadge?.();
      console.error('[deliverMsg:inbox]', err);
    });
    this.renderMessageList?.();
    this.updateNotifBadge?.();
    return newMsg;
  },

  // ══════════════════════════════════
  //  Notification Template Utilities
  // ══════════════════════════════════

  _renderTemplate(str, vars) {
    if (!str) return '';
    return str.replace(/\{(\w+)\}/g, (_, key) => (vars && vars[key] != null) ? vars[key] : `{${key}}`);
  },

  _getDefaultNotifTemplates() {
    return {
      welcome: {
        title: '歡迎加入 SportHub！',
        body: '嗨 {userName}，歡迎加入 SportHub 平台！\n\n您可以在這裡瀏覽並報名各類足球活動、加入俱樂部、參與聯賽。\n祝您使用愉快！',
      },
      signup_success: {
        title: '報名成功通知',
        body: '您已成功報名以下活動：\n\n活動名稱：{eventName}\n活動時間：{date}\n活動地點：{location}\n報名狀態：{status}\n\n請準時出席，如需取消請提前至活動頁面操作。',
      },
      cancel_signup: {
        title: '取消報名通知',
        body: '{status}。\n\n活動名稱：{eventName}\n活動時間：{date}\n活動地點：{location}\n\n如需再次參加，可回到活動頁重新報名。',
      },
      waitlist_promoted: {
        title: '候補遞補通知',
        body: '恭喜！由於有人取消報名，您已從候補名單自動遞補為正式參加者。\n\n活動名稱：{eventName}\n活動時間：{date}\n活動地點：{location}\n\n請準時出席！',
      },
      waitlist_demoted: {
        title: '候補降級通知',
        body: '因活動名額調整，您目前已改為候補狀態。\n\n活動名稱：{eventName}\n活動時間：{date}\n活動地點：{location}\n\n若後續有名額釋出，系統會再通知您。',
      },
      event_cancelled: {
        title: '活動取消通知',
        body: '很抱歉通知您，以下活動因故取消：\n\n活動名稱：{eventName}\n原定時間：{date}\n原定地點：{location}\n\n如您已繳費，費用將於 3 個工作天內退還。造成不便深感抱歉。',
      },
      role_upgrade: {
        title: '身份變更通知',
        body: '恭喜 {userName}！您的身份已變更為「{roleName}」。\n\n新身份可能帶來新的權限與功能，請至個人資料頁面查看詳情。\n感謝您對社群的貢獻！',
      },
      event_changed: {
        title: '活動變更通知',
        body: '您報名的活動資訊有所變更，請留意：\n\n活動名稱：{eventName}\n活動時間：{date}\n活動地點：{location}\n\n如因變更需要取消報名，請至活動頁面操作。',
      },
      event_relisted: {
        title: '活動重新上架通知',
        body: '您先前報名的活動已重新上架：\n\n活動名稱：{eventName}\n活動時間：{date}\n活動地點：{location}\n\n您的報名資格仍然保留，請留意活動時間。',
      },
      tournament_friendly_host_opened: {
        title: '友誼賽已建立',
        body: '主辦俱樂部「{hostTeamName}」已開啟友誼賽「{tournamentName}」。\n\n報名截止：{regEnd}\n\n若您為主辦俱樂部成員，現在可前往賽事頁加入球員名單。',
      },
      tournament_friendly_team_apply_host: {
        title: '有新俱樂部申請參賽',
        body: '俱樂部「{teamName}」已申請參加「{tournamentName}」。\n申請人：{applicantName}\n\n請前往賽事詳細頁進行審核。',
      },
      tournament_friendly_team_approved_applicant: {
        title: '俱樂部申請已通過',
        body: '恭喜！您代表「{teamName}」申請參加「{tournamentName}」已通過審核。\n審核人：{reviewerName}\n\n隊員現在可加入該隊參賽名單。',
      },
      tournament_friendly_team_rejected_applicant: {
        title: '俱樂部申請結果通知',
        body: '很抱歉，您代表「{teamName}」申請參加「{tournamentName}」未獲通過。\n審核人：{reviewerName}\n\n如有疑問請聯繫主辦方。',
      },
      tournament_friendly_team_approved_broadcast: {
        title: '俱樂部已可加入名單',
        body: '俱樂部「{teamName}」已通過「{tournamentName}」參賽審核。\n\n若您是該隊成員，現在可前往賽事頁加入球員名單。',
      },
    };
  },

  _ensureNotifTemplatesBackfilled() {
    if (this._notifTemplateEnsurePromise) return this._notifTemplateEnsurePromise;
    const callable = firebase.app().functions('asia-east1').httpsCallable('ensureNotificationTemplates');
    this._notifTemplateEnsurePromise = callable({})
      .then(result => {
        const templates = Array.isArray(result?.data?.templates) ? result.data.templates : [];
        if (!templates.length) return [];
        const source = FirebaseService._cache.notifTemplates || [];
        const byKey = new Map(source.map(t => [t.key, t]));
        templates.forEach(t => {
          if (!t?.key) return;
          byKey.set(t.key, { ...(byKey.get(t.key) || {}), ...t, _docId: t.key });
        });
        FirebaseService._cache.notifTemplates = Array.from(byKey.values());
        FirebaseService._saveToLS?.('notifTemplates', FirebaseService._cache.notifTemplates);
        return templates;
      })
      .catch(err => {
        console.warn('[Notif] ensureNotificationTemplates failed:', err);
        return [];
      })
      .finally(() => {
        this._notifTemplateEnsurePromise = null;
      });
    return this._notifTemplateEnsurePromise;
  },

  _deliverMessageWithLinePush(title, body, category, categoryName, targetUid, senderName, extra, options = {}) {
    if (!targetUid) return;
    const deliveredMsg = this._deliverMessageToInbox(title, body, category, categoryName, targetUid, senderName, extra);
    if (!deliveredMsg) return;
    if (typeof this._queueLinePush !== 'function') return;
    const lineOptions = {
      ...(options.lineOptions || {}),
    };
    if (deliveredMsg.dedupeKey && !lineOptions.dedupeKey) {
      lineOptions.dedupeKey = deliveredMsg.dedupeKey;
    }
    this._queueLinePush(
      targetUid,
      options.lineCategory || category || 'system',
      options.lineTitle || title,
      options.lineBody || body,
      lineOptions
    );
  },

  _sendNotifFromTemplate(key, vars, targetUid, category, categoryName, extra = null, options = {}) {
    const fallbackTemplates = {
      ...this._getDefaultNotifTemplates(),
      cancel_signup: {
        title: '取消報名通知',
        body: '{status}：\n\n活動名稱：{eventName}\n活動時間：{date}\n活動地點：{location}\n\n如之後想再次參加，請回到活動頁重新報名。',
      },
      waitlist_demoted: {
        title: '候補調整通知',
        body: '很抱歉通知您，因活動名額調整，您的報名狀態已改為候補。\n\n活動名稱：{eventName}\n活動時間：{date}\n活動地點：{location}\n\n若有名額釋出，系統將依候補順序自動遞補。',
      },
    };
    const customTpl = ApiService.getNotifTemplate(key);
    const tpl = (customTpl && customTpl.title && customTpl.body) ? customTpl : fallbackTemplates[key];
    if (!tpl) { console.warn('[Notif] 找不到模板:', key); return; }
    if (!customTpl && fallbackTemplates[key]) {
      void this._ensureNotifTemplatesBackfilled();
      console.warn('[Notif] 使用內建模板補送:', key);
    }
    const title = this._renderTemplate(tpl.title, vars);
    const body = this._renderTemplate(tpl.body, vars);
    this._deliverMessageWithLinePush(
      title,
      body,
      category || 'system',
      categoryName || '系統',
      targetUid,
      '系統',
      extra,
      {
        lineCategory: options.lineCategory || category || 'system',
        lineTitle: options.lineTitle || title,
        lineBody: options.lineBody || body,
        lineOptions: {
          source: `template:${key}`,
          ...(options.lineOptions || {}),
        },
      }
    );
  },

  // LINE Push functions → message-line-push.js

  // ══════════════════════════════════
  //  Notification Template Editor
  // ══════════════════════════════════

  async showTemplateEditor() {
    const modal = document.getElementById('notif-template-editor');
    if (!modal) return;
    const list = document.getElementById('notif-template-list');
    if (!list) return;

    // 確保模板編輯器能顯示完整模板（舊資料會自動補齊缺漏 key）
    if (FirebaseService._seedNotifTemplates) {
      try {
        await FirebaseService._seedNotifTemplates();
      } catch (err) {
        console.warn('[TemplateEditor] 補齊模板失敗:', err);
      }
    }

    const placeholderHints = {
      welcome: '{userName}',
      signup_success: '{eventName} {date} {location} {status}',
      cancel_signup: '{eventName} {date} {location} {status}',
      waitlist_promoted: '{eventName} {date} {location}',
      waitlist_demoted: '{eventName} {date} {location}',
      event_cancelled: '{eventName} {date} {location}',
      role_upgrade: '{userName} {roleName}',
      event_changed: '{eventName} {date} {location}',
      event_relisted: '{eventName} {date} {location}',
    };
    const order = Object.keys(placeholderHints);
    const templates = [...ApiService.getNotifTemplates()].sort((a, b) => {
      const ia = order.indexOf(a.key);
      const ib = order.indexOf(b.key);
      if (ia === -1 && ib === -1) return String(a.key || '').localeCompare(String(b.key || ''));
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
    list.innerHTML = templates.map(t => `
      <div class="form-card" style="margin-bottom:.6rem">
        <div style="font-size:.82rem;font-weight:700;margin-bottom:.3rem">${escapeHTML(t.key)}</div>
        <div style="font-size:.72rem;color:var(--text-muted);margin-bottom:.4rem">佔位符：${escapeHTML(placeholderHints[t.key] || '無')}</div>
        <div class="form-row"><label>標題</label><input type="text" data-tpl-key="${t.key}" data-tpl-field="title" value="${escapeHTML(t.title)}" maxlength="12"></div>
        <div class="form-row"><label>內容</label><textarea data-tpl-key="${t.key}" data-tpl-field="body" rows="4" maxlength="300">${escapeHTML(t.body)}</textarea></div>
      </div>
    `).join('');
    document.body.appendChild(modal);
    modal.style.webkitBackdropFilter = 'blur(10px)';
    modal.style.display = 'flex';
  },

  hideTemplateEditor() {
    const modal = document.getElementById('notif-template-editor');
    if (modal) modal.style.display = 'none';
  },

  saveAllTemplates() {
    const inputs = document.querySelectorAll('[data-tpl-key][data-tpl-field]');
    const updates = {};
    inputs.forEach(el => {
      const key = el.dataset.tplKey;
      const field = el.dataset.tplField;
      if (!updates[key]) updates[key] = {};
      updates[key][field] = el.value;
    });
    Object.keys(updates).forEach(key => {
      ApiService.updateNotifTemplate(key, updates[key]);
    });
    this.hideTemplateEditor();
    this.showToast('通知模板已儲存');
  },

});
