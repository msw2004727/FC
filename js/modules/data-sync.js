/* ================================================
   SportHub - Data Sync Operations
   球隊成員數重算、用戶球隊欄位驗證、孤兒記錄清理
   ================================================ */

Object.assign(App, {

  _dataSyncRunning: false,

  _dataSyncUI() {
    const progressWrap = document.getElementById('data-sync-progress');
    const bar = document.getElementById('data-sync-bar');
    const percentEl = document.getElementById('data-sync-percent');
    const logEl = document.getElementById('data-sync-log');
    return {
      progressWrap, bar, percentEl, logEl,
      show() {
        if (progressWrap) progressWrap.style.display = '';
        if (logEl) { logEl.style.display = ''; logEl.textContent = ''; }
      },
      log(msg) {
        if (!logEl) return;
        const time = new Date().toLocaleTimeString('zh-TW', { hour12: false });
        logEl.textContent += `[${time}] ${msg}\n`;
        logEl.scrollTop = logEl.scrollHeight;
      },
      setProgress(current, total) {
        const pct = total > 0 ? Math.round((current / total) * 100) : 0;
        if (bar) bar.style.width = pct + '%';
        if (percentEl) percentEl.textContent = `${pct}%`;
      },
    };
  },

  async runDataSyncOp(op) {
    if (this._dataSyncRunning || this._achBatchRunning) {
      this.showToast('同步作業正在執行中');
      return;
    }
    if (!this.hasPermission?.('admin.repair.data_sync')) {
      this.showToast('權限不足');
      return;
    }

    if (op === 'achievement') {
      return this.runAchievementBatchUpdate();
    }

    const opMap = {
      teamMembers: { label: '球隊成員數重算', fn: '_syncTeamMembers' },
      userTeam: { label: '用戶球隊欄位驗證', fn: '_syncUserTeamFields' },
      orphan: { label: '孤兒記錄清理', fn: '_syncOrphanCleanup' },
      all: { label: '全部同步', fn: '_syncAll' },
    };
    const config = opMap[op];
    if (!config) return;

    const est = this._estimateDataSyncCost(op);
    const ok = await this.appConfirm(
      `確定要執行「${config.label}」嗎？\n\n` +
      est.summary + '\n\n' +
      `預估讀取：~${est.reads.toLocaleString()} 次\n` +
      `預估寫入：至多 ~${est.writes.toLocaleString()} 次\n` +
      `預估費用：~$${est.cost} USD\n\n` +
      '請勿關閉頁面。'
    );
    if (!ok) return;

    this._dataSyncRunning = true;
    const ui = this._dataSyncUI();
    ui.show();
    const startTime = Date.now();

    try {
      await this[config.fn](ui);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      ui.log(`\n=== ${config.label}完成（${elapsed} 秒）===`);
      this.showToast(`${config.label}完成`);
    } catch (err) {
      ui.log(`致命錯誤：${err.message || err}`);
      console.error('[DataSync]', op, err);
      this.showToast(`${config.label}失敗`);
    } finally {
      this._dataSyncRunning = false;
    }
  },

  _estimateDataSyncCost(op) {
    const users = ApiService.getAdminUsers?.() || [];
    const teams = ApiService.getTeams?.() || [];
    const events = ApiService.getEvents?.() || [];
    const U = users.length;
    const T = teams.length;
    const E = events.length;
    const R = FirebaseService._cache?.registrations?.length || 0;
    const Act = FirebaseService._cache?.activityRecords?.length || 0;
    const Att = FirebaseService._cache?.attendanceRecords?.length || 0;

    let reads = 0, writes = 0, summary = '';
    if (op === 'teamMembers') {
      reads = 0; writes = T;
      summary = `球隊 ${T} 支、用戶 ${U} 位（從快取計算，無額外讀取）`;
    } else if (op === 'userTeam') {
      reads = 0; writes = U;
      summary = `用戶 ${U} 位、球隊 ${T} 支（從快取比對，無額外讀取）`;
    } else if (op === 'orphan') {
      const E = (ApiService.getEvents?.() || []).length;
      reads = E + R + Act + Att;
      writes = Math.round((R + Act + Att) * 0.05);
      summary = `活動 ${E}+、報名 ${R}、活動紀錄 ${Act}、出席紀錄 ${Att}\n（會直接查 Firestore 完整 events 集合；預估 5% 為孤兒）`;
    } else if (op === 'all') {
      const achU = U;
      const achA = (ApiService.getAchievements?.() || []).filter(a => a && a.status !== 'archived' && a.condition).length;
      reads = (achU * 3) + R + Act + Att + R + Act + Att;
      writes = (achU * achA) + R + T + U + Math.round((R + Act + Att) * 0.05);
      summary = `用戶 ${U} 位、成就 ${achA} 個、球隊 ${T} 支\n報名 ${R}、活動紀錄 ${Act}、出席紀錄 ${Att}`;
    }
    const cost = ((reads * 0.06 / 100000) + (writes * 0.18 / 100000)).toFixed(4);
    return { reads, writes, cost, summary };
  },

  // ── ② 球隊成員數重算 ──
  async _syncTeamMembers(ui) {
    ui.log('開始球隊成員數重算...');
    const teams = ApiService.getTeams?.() || [];
    const users = ApiService.getAdminUsers?.() || [];
    if (!teams.length) { ui.log('找不到球隊資料'); return; }

    let updated = 0;
    for (let i = 0; i < teams.length; i++) {
      const team = teams[i];
      const teamId = String(team?.id || team?._docId || '').trim();
      if (!teamId) continue;

      const computed = typeof this._calcTeamMemberCountByTeam === 'function'
        ? this._calcTeamMemberCountByTeam(team, users)
        : users.filter(u => {
            const tId = String(u?.teamId || '').trim();
            const tIds = Array.isArray(u?.teamIds) ? u.teamIds : [];
            return tId === teamId || tIds.includes(teamId);
          }).length;

      const stored = team.members || 0;
      if (computed !== stored) {
        try {
          await db.collection('teams').doc(teamId).update({ members: computed });
          ui.log(`${team.name || teamId}：${stored} → ${computed}`);
          updated++;
        } catch (err) {
          ui.log(`錯誤 [${team.name || teamId}]：${err.message}`);
        }
      }
      ui.setProgress(i + 1, teams.length);
      if (i % 5 === 0) await new Promise(r => setTimeout(r, 0));
    }
    ui.log(`球隊成員數：更新 ${updated}/${teams.length} 支`);
  },

  // ── ③ 用戶球隊欄位驗證 ──
  async _syncUserTeamFields(ui) {
    ui.log('開始用戶球隊欄位驗證...');
    const users = ApiService.getAdminUsers?.() || [];
    const teams = ApiService.getTeams?.() || [];
    const validTeamIds = new Set(
      teams.map(t => String(t?.id || t?._docId || '').trim()).filter(Boolean)
    );
    if (!users.length) { ui.log('找不到用戶資料'); return; }

    let updated = 0;
    for (let i = 0; i < users.length; i++) {
      const user = users[i];
      const uid = String(user?.uid || user?._docId || '').trim();
      if (!uid) continue;

      const teamId = String(user.teamId || '').trim();
      const teamIds = Array.isArray(user.teamIds) ? user.teamIds.map(id => String(id || '').trim()).filter(Boolean) : [];
      const teamNames = Array.isArray(user.teamNames) ? user.teamNames : [];

      const cleanTeamId = teamId && validTeamIds.has(teamId) ? teamId : '';
      const cleanTeamIds = teamIds.filter(id => validTeamIds.has(id));
      const cleanTeamNames = cleanTeamIds.length === teamIds.length ? teamNames : [];

      const needsUpdate = cleanTeamId !== teamId
        || cleanTeamIds.length !== teamIds.length;

      if (needsUpdate) {
        try {
          const updates = { teamId: cleanTeamId || null };
          if (Array.isArray(user.teamIds)) updates.teamIds = cleanTeamIds;
          if (Array.isArray(user.teamNames) && cleanTeamNames.length !== teamNames.length) {
            updates.teamNames = cleanTeamNames;
          }
          await db.collection('users').doc(uid).update(updates);
          const name = user.displayName || user.name || uid;
          ui.log(`${name}：移除無效球隊引用`);
          updated++;
        } catch (err) {
          ui.log(`錯誤 [${uid}]：${err.message}`);
        }
      }
      ui.setProgress(i + 1, users.length);
      if (i % 5 === 0) await new Promise(r => setTimeout(r, 0));
    }
    ui.log(`用戶球隊欄位：修正 ${updated}/${users.length} 位`);
  },

  // ── ④ 孤兒記錄清理 ──
  async _syncOrphanCleanup(ui) {
    ui.log('開始孤兒記錄清理...');
    // 直接從 Firestore 查所有 events（不用快取，避免 limit 截斷導致誤刪）
    ui.log('從 Firestore 載入完整活動清單...');
    let validEventIds;
    try {
      const eventsSnap = await db.collection('events').get();
      validEventIds = new Set(
        eventsSnap.docs.map(d => String(d.id || '').trim()).filter(Boolean)
      );
    } catch (err) {
      ui.log('錯誤：無法載入 events 集合，中止清理（' + err.message + '）');
      return;
    }
    ui.log(`有效活動 ${validEventIds.size} 個，開始掃描集合...`);

    const collections = [
      { name: 'registrations', label: '報名記錄' },
      { name: 'activityRecords', label: '活動紀錄' },
      { name: 'attendanceRecords', label: '出席紀錄' },
    ];

    let totalDeleted = 0;
    for (const col of collections) {
      ui.log(`掃描 ${col.label}...`);
      let orphanCount = 0;
      try {
        const snap = await db.collection(col.name).get();
        const orphans = [];
        snap.docs.forEach(doc => {
          const data = doc.data();
          const eventId = String(data?.eventId || '').trim();
          if (eventId && !validEventIds.has(eventId)) {
            orphans.push(doc.id);
          }
        });

        // Batch delete in chunks of 450
        for (let s = 0; s < orphans.length; s += 450) {
          const chunk = orphans.slice(s, s + 450);
          const batch = db.batch();
          chunk.forEach(docId => batch.delete(db.collection(col.name).doc(docId)));
          await batch.commit();
          orphanCount += chunk.length;
        }

        ui.log(`${col.label}：刪除 ${orphanCount} 筆孤兒（共 ${snap.size} 筆）`);
        totalDeleted += orphanCount;
      } catch (err) {
        ui.log(`錯誤 [${col.label}]：${err.message}`);
      }
      ui.setProgress(collections.indexOf(col) + 1, collections.length);
    }
    ui.log(`孤兒記錄清理完成：共刪除 ${totalDeleted} 筆`);
  },

  // ── 一鍵全部同步 ──
  async _syncAll(ui) {
    ui.log('========== 開始全部同步 ==========\n');

    // 1. Achievement batch
    ui.log('【① 成就進度 + 報名徽章】');
    try {
      await this.runAchievementBatchUpdate(document.getElementById('data-sync-log'));
    } catch (err) {
      ui.log(`成就同步錯誤：${err.message}`);
    }

    ui.log('\n【② 球隊成員數重算】');
    await this._syncTeamMembers(ui);

    ui.log('\n【③ 用戶球隊欄位驗證】');
    await this._syncUserTeamFields(ui);

    ui.log('\n【④ 孤兒記錄清理】');
    await this._syncOrphanCleanup(ui);
  },

});
