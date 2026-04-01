/* ================================================
   SportHub - Data Sync Operations
   俱樂部成員數重算、用戶俱樂部欄位驗證、孤兒記錄清理、UID 欄位修正
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
      teamMembers: { label: '俱樂部成員數重算', fn: '_syncTeamMembers' },
      userTeam: { label: '用戶俱樂部欄位驗證', fn: '_syncUserTeamFields' },
      orphan: { label: '孤兒記錄清理', fn: '_syncOrphanCleanup' },
      uidMigration: { label: 'UID 欄位修正', fn: '_syncUidMigration' },
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
    const U = users.length;
    const T = teams.length;
    const R = FirebaseService._cache?.registrations?.length || 0;
    const Act = FirebaseService._cache?.activityRecords?.length || 0;
    const Att = FirebaseService._cache?.attendanceRecords?.length || 0;

    let reads = 0, writes = 0, summary = '';
    if (op === 'teamMembers') {
      reads = 0; writes = T;
      summary = `俱樂部 ${T} 支、用戶 ${U} 位（從快取計算，無額外讀取）`;
    } else if (op === 'userTeam') {
      reads = 0; writes = U;
      summary = `用戶 ${U} 位、俱樂部 ${T} 支（從快取比對，無額外讀取）`;
    } else if (op === 'orphan') {
      const E = (ApiService.getEvents?.() || []).length;
      reads = E + R + Act + Att;
      writes = Math.round((R + Act + Att) * 0.05);
      summary = `活動 ${E}+、報名 ${R}、活動紀錄 ${Act}、出席紀錄 ${Att}\n（會直接查 Firestore 完整 events 集合；預估 5% 為孤兒）`;
    } else if (op === 'uidMigration') {
      reads = U + R + Act + Att;
      writes = Math.round((Act + Att) * 0.1);
      summary = `用戶 ${U} 位、出席紀錄 ${Att}、活動紀錄 ${Act}、報名 ${R}\n（透過 Cloud Function 執行，讀寫發生在伺服器端；含 dry-run 預覽）`;
    } else if (op === 'all') {
      const achU = U;
      const achA = (ApiService.getAchievements?.() || []).filter(a => a && a.status !== 'archived' && a.condition).length;
      reads = (achU * 3) + R + Act + Att;
      writes = (achU * achA) + R + T + U;
      summary = `用戶 ${U} 位、成就 ${achA} 個、俱樂部 ${T} 支\n報名 ${R}、活動紀錄 ${Act}、出席紀錄 ${Att}\n（僅執行 ①②③，不含 ④ 孤兒記錄清理）`;
    }
    const cost = ((reads * 0.06 / 100000) + (writes * 0.18 / 100000)).toFixed(4);
    return { reads, writes, cost, summary };
  },

  // ── ② 俱樂部成員數重算 ──
  async _syncTeamMembers(ui) {
    ui.log('開始俱樂部成員數重算...');
    const teams = ApiService.getTeams?.() || [];
    const users = ApiService.getAdminUsers?.() || [];
    if (!teams.length) { ui.log('找不到俱樂部資料'); return; }

    let updated = 0;
    for (let i = 0; i < teams.length; i++) {
      const team = teams[i];
      const teamCustomId = String(team?.id || '').trim();
      const teamDocId = String(team?._docId || '').trim();
      if (!teamCustomId && !teamDocId) continue;

      // 成員比對用自訂 ID（user.teamId 存的是 team.id）
      const matchId = teamCustomId || teamDocId;
      const computed = typeof this._calcTeamMemberCountByTeam === 'function'
        ? this._calcTeamMemberCountByTeam(team, users)
        : users.filter(u => {
            const tId = String(u?.teamId || '').trim();
            const tIds = Array.isArray(u?.teamIds) ? u.teamIds : [];
            return tId === matchId || tIds.includes(matchId);
          }).length;

      const stored = team.members || 0;
      if (computed !== stored) {
        // Firestore 寫入必須用 _docId（teams 用 .add() 建立，doc ID ≠ team.id）
        const writeId = teamDocId || teamCustomId;
        try {
          await db.collection('teams').doc(writeId).update({ members: computed });
          ui.log(`${team.name || matchId}：${stored} → ${computed}`);
          updated++;
        } catch (err) {
          ui.log(`錯誤 [${team.name || matchId}]：${err.message}`);
        }
      }
      ui.setProgress(i + 1, teams.length);
      if (i % 5 === 0) await new Promise(r => setTimeout(r, 0));
    }
    ui.log(`俱樂部成員數：更新 ${updated}/${teams.length} 支`);
    if (updated > 0) {
      ApiService._writeOpLog?.('data_sync', '俱樂部成員數重算', `更新 ${updated}/${teams.length} 支`);
    }
  },

  // ── ③ 用戶俱樂部欄位驗證 ──
  async _syncUserTeamFields(ui) {
    ui.log('開始用戶俱樂部欄位驗證...');
    const users = ApiService.getAdminUsers?.() || [];
    const teams = ApiService.getTeams?.() || [];
    const validTeamIds = new Set();
    teams.forEach(t => {
      const customId = String(t?.id || '').trim();
      const docId = String(t?._docId || '').trim();
      if (customId) validTeamIds.add(customId);
      if (docId) validTeamIds.add(docId);
    });
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
      // 保留有效 teamId 對應位置的 teamName；長度不一致時從 teams 快取查名稱
      const teamNameMap = new Map(teams.map(t => [String(t?.id || t?._docId || '').trim(), t?.name || '']));
      const cleanTeamNames = teamIds.length === teamNames.length
        ? teamIds.map((id, idx) => validTeamIds.has(id) ? teamNames[idx] : null).filter(n => n !== null)
        : cleanTeamIds.map(id => teamNameMap.get(id) || '');

      const needsUpdate = cleanTeamId !== teamId
        || cleanTeamIds.length !== teamIds.length;

      if (needsUpdate) {
        try {
          const updates = { teamId: cleanTeamId || null };
          if (Array.isArray(user.teamIds)) updates.teamIds = cleanTeamIds;
          if (Array.isArray(user.teamNames)) {
            updates.teamNames = cleanTeamNames;
          }
          await db.collection('users').doc(uid).update(updates);
          const name = user.displayName || user.name || uid;
          ui.log(`${name}：移除無效俱樂部引用`);
          updated++;
        } catch (err) {
          ui.log(`錯誤 [${uid}]：${err.message}`);
        }
      }
      ui.setProgress(i + 1, users.length);
      if (i % 5 === 0) await new Promise(r => setTimeout(r, 0));
    }
    ui.log(`用戶俱樂部欄位：修正 ${updated}/${users.length} 位`);
    if (updated > 0) {
      ApiService._writeOpLog?.('data_sync', '用戶俱樂部驗證', `修正 ${updated}/${users.length} 位`);
    }
  },

  // ── ④ 孤兒記錄清理（含 dry-run 安全機制）──
  async _syncOrphanCleanup(ui) {
    ui.log('開始孤兒記錄清理...');
    // 直接從 Firestore 查所有 events（不用快取，避免 limit 截斷導致誤刪）
    ui.log('從 Firestore 載入完整活動清單...');
    let validEventIds;
    try {
      const eventsSnap = await db.collection('events').get();
      validEventIds = new Set();
      eventsSnap.docs.forEach(d => {
        const data = d.data();
        // event.id（自訂 ID）是 registrations/activityRecords/attendanceRecords 的 eventId 欄位
        // 注意：event.id ≠ Firestore doc.id（自動產生的文件 ID）
        const customId = String(data.id || '').trim();
        if (customId) validEventIds.add(customId);
        // 也加入 Firestore doc.id 以防部分記錄用的是文件 ID
        const docId = String(d.id || '').trim();
        if (docId) validEventIds.add(docId);
      });
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

    // ── Dry-run：先掃描統計，不刪除 ──
    const dryRunResults = [];
    for (let ci = 0; ci < collections.length; ci++) {
      const col = collections[ci];
      ui.log(`掃描 ${col.label}...`);
      ui.setProgress(ci, collections.length * 2);
      try {
        const snap = await db.collection(col.name).get();
        const orphans = [];
        const sampleOrphans = [];
        snap.docs.forEach(doc => {
          const data = doc.data();
          const eventId = String(data?.eventId || '').trim();
          if (eventId && !validEventIds.has(eventId)) {
            orphans.push(doc.id);
            if (sampleOrphans.length < 3) {
              sampleOrphans.push({ docId: doc.id, eventId, userName: data.userName || data.uid || '?' });
            }
          }
        });
        dryRunResults.push({ col, total: snap.size, orphanCount: orphans.length, orphans, sampleOrphans });
        ui.log(`${col.label}：${orphans.length}/${snap.size} 筆為孤兒`);
        sampleOrphans.forEach(s => ui.log(`  樣本：${s.userName} (eventId=${s.eventId})`));
      } catch (err) {
        ui.log(`錯誤 [${col.label}]：${err.message}`);
        dryRunResults.push({ col, total: 0, orphanCount: 0, orphans: [], sampleOrphans: [] });
      }
    }

    // ── 安全檢查：孤兒比例 > 50% 時強制確認 ──
    const totalRecords = dryRunResults.reduce((s, r) => s + r.total, 0);
    const totalOrphans = dryRunResults.reduce((s, r) => s + r.orphanCount, 0);
    const orphanRatio = totalRecords > 0 ? totalOrphans / totalRecords : 0;

    if (orphanRatio > 0.5) {
      ui.log(`\n⚠️ 警告：孤兒比例 ${(orphanRatio * 100).toFixed(1)}% 超過 50%，可能有判斷錯誤！`);
      const forceOk = await this.appConfirm(
        `⚠️ 危險：孤兒比例 ${(orphanRatio * 100).toFixed(1)}% 超過 50%！\n\n` +
        dryRunResults.map(r => `${r.col.label}：${r.orphanCount}/${r.total} 筆`).join('\n') + '\n\n' +
        '這可能代表判斷邏輯有誤。確定要繼續刪除嗎？'
      );
      if (!forceOk) {
        ui.log('用戶取消操作（孤兒比例過高）');
        return;
      }
    }

    // ── 確認後再執行實際刪除 ──
    const confirmOk = await this.appConfirm(
      `孤兒掃描完成：\n\n` +
      dryRunResults.map(r => `${r.col.label}：將刪除 ${r.orphanCount}/${r.total} 筆`).join('\n') + '\n\n' +
      '確定要執行刪除嗎？'
    );
    if (!confirmOk) {
      ui.log('用戶取消刪除操作');
      return;
    }

    let totalDeleted = 0;
    for (const result of dryRunResults) {
      const { col, orphans } = result;
      let orphanCount = 0;
      try {
        for (let s = 0; s < orphans.length; s += 450) {
          const chunk = orphans.slice(s, s + 450);
          const batch = db.batch();
          chunk.forEach(docId => batch.delete(db.collection(col.name).doc(docId)));
          await batch.commit();
          orphanCount += chunk.length;
        }
        ui.log(`${col.label}：刪除 ${orphanCount} 筆孤兒（共 ${result.total} 筆）`);
        totalDeleted += orphanCount;
      } catch (err) {
        ui.log(`錯誤 [${col.label}]：${err.message}`);
      }
      ui.setProgress(collections.length + dryRunResults.indexOf(result) + 1, collections.length * 2);
    }
    ui.log(`孤兒記錄清理完成：共刪除 ${totalDeleted} 筆`);
    if (totalDeleted > 0) {
      const detail = dryRunResults.map(r => `${r.col.label} ${r.orphanCount}/${r.total}`).join('、');
      ApiService._writeOpLog?.('data_sync', '孤兒記錄清理', `刪除 ${totalDeleted} 筆（${detail}）`);
    }
  },

  // ── ⑤ UID 欄位修正（Cloud Function）──
  async _syncUidMigration(ui) {
    ui.log('開始 UID 欄位修正...');
    ui.log('呼叫 Cloud Function（dry-run 預覽）...');

    const fn = firebase.app().functions('asia-east1').httpsCallable('migrateUidFields');
    let dryResult;
    try {
      const resp = await fn({ dryRun: true, collection: 'both' });
      dryResult = resp.data;
    } catch (err) {
      ui.log('Cloud Function 呼叫失敗：' + (err.message || err));
      ui.setProgress(2, 2);
      return;
    }

    // 顯示 dry-run 報告
    ui.log('\n--- Dry-run 報告 ---');
    for (const [colName, stats] of Object.entries(dryResult.collections || {})) {
      ui.log(`${colName}：共 ${stats.total} 筆`);
      ui.log(`  已正確：${stats.alreadyCorrect}`);
      ui.log(`  可修正：${stats.fixed}`);
      ui.log(`  無法映射：${stats.unmapped}`);
      if (stats.fixedSamples?.length > 0) {
        ui.log('  修正樣本：');
        stats.fixedSamples.slice(0, 5).forEach(s => {
          ui.log(`    ${s.userName}: ${s.oldUid} -> ${s.newUid}`);
        });
      }
      if (stats.unmappedSamples?.length > 0) {
        ui.log('  無法映射樣本：');
        stats.unmappedSamples.slice(0, 5).forEach(s => {
          ui.log(`    ${s.userName}: uid=${s.uid}, event=${s.eventId}`);
        });
      }
    }
    if (dryResult.duplicateNames?.length > 0) {
      ui.log(`\n重名警告（已交叉比對 registrations）：${dryResult.duplicateNames.join(', ')}`);
    }
    ui.log(`\n合計：可修正 ${dryResult.totalFixed} 筆，無法映射 ${dryResult.totalUnmapped} 筆，已正確 ${dryResult.totalSkipped} 筆`);
    ui.setProgress(1, 2);

    if (dryResult.totalFixed === 0) {
      ui.log('\n所有 UID 欄位均正確，無需遷移。');
      ui.setProgress(2, 2);
      return;
    }

    // 確認後執行實際遷移
    const confirmOk = await this.appConfirm(
      `UID 欄位修正預覽：\n\n` +
      `可修正：${dryResult.totalFixed} 筆\n` +
      `無法映射：${dryResult.totalUnmapped} 筆\n\n` +
      '確定要執行修正嗎？（會自動備份至 _migrationBackups 集合）'
    );
    if (!confirmOk) {
      ui.log('用戶取消操作');
      ui.setProgress(2, 2);
      return;
    }

    ui.log('\n呼叫 Cloud Function（正式執行）...');
    try {
      const resp = await fn({ dryRun: false, collection: 'both' });
      const result = resp.data;
      ui.log(`\n修正完成：${result.totalFixed} 筆已更新，${result.totalUnmapped} 筆無法映射`);
      ui.log('備份已寫入 _migrationBackups 集合');
    } catch (err) {
      ui.log('Cloud Function 執行失敗：' + (err.message || err));
    }
    ui.setProgress(2, 2);
  },

  // ── 一鍵全部同步（僅安全操作，不含 ④ 孤兒記錄清理）──
  async _syncAll(ui) {
    ui.log('========== 開始全部同步（①②③）==========\n');
    ui.log('注意：④ 孤兒記錄清理因涉及不可逆刪除，需單獨執行。\n');

    // 1. Achievement batch
    ui.log('【① 成就進度 + 報名徽章】');
    try {
      await this.runAchievementBatchUpdate(document.getElementById('data-sync-log'));
    } catch (err) {
      ui.log(`成就同步錯誤：${err.message}`);
    }

    ui.log('\n【② 俱樂部成員數重算】');
    await this._syncTeamMembers(ui);

    ui.log('\n【③ 用戶俱樂部欄位驗證】');
    await this._syncUserTeamFields(ui);
  },

  // ── ⑥ 用戶地區掃描 ──
  async _scanUserRegions() {
    var regions = typeof TW_REGIONS !== 'undefined' ? TW_REGIONS : [];
    if (!regions.length) { this.showToast('TW_REGIONS 未定義'); return; }
    this.showToast('正在掃描...');
    try {
      var snap = await db.collection('users').get();
      var empty = [], invalid = [], valid = [];
      snap.forEach(function(doc) {
        var d = doc.data();
        var name = d.displayName || d.name || doc.id;
        var region = (d.region || '').trim();
        if (!region) empty.push(name);
        else if (regions.indexOf(region) === -1) invalid.push(name + ' \u2192 ' + region);
        else valid.push(name);
      });
      var lines = [];
      lines.push('\u7E3D\u7528\u6236\uFF1A' + snap.size);
      lines.push('\u6709\u6548\u5730\u5340\uFF1A' + valid.length);
      lines.push('\u672A\u586B\u5730\u5340\uFF1A' + empty.length);
      if (empty.length) lines.push(empty.join('\u3001'));
      lines.push('\u975E\u6CD5\u5730\u5340\uFF1A' + invalid.length);
      if (invalid.length) invalid.forEach(function(s) { lines.push(s); });
      var overlay = document.createElement('div');
      overlay.className = 'edu-info-overlay';
      overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
      overlay.innerHTML = '<div class="edu-info-dialog" style="max-width:400px;max-height:calc(100vh - 2rem);display:flex;flex-direction:column">'
        + '<div class="edu-info-dialog-title" style="flex-shrink:0">\u7528\u6236\u5730\u5340\u6383\u63CF\u7D50\u679C</div>'
        + '<div class="edu-info-dialog-body" style="overflow-y:auto;-webkit-overflow-scrolling:touch;flex:1;min-height:0"><pre style="white-space:pre-wrap;font-size:.78rem;line-height:1.6;margin:0">' + escapeHTML(lines.join('\n')) + '</pre></div>'
        + '<button class="primary-btn" style="width:100%;margin-top:.8rem;flex-shrink:0" onclick="this.closest(\'.edu-info-overlay\').remove()">\u95DC\u9589</button>'
        + '</div>';
      document.body.appendChild(overlay);
    } catch (err) {
      this.showToast('\u6383\u63CF\u5931\u6557\uFF1A' + (err.message || err));
    }
  },

  // ── ⑥ 用戶地區強制補正 ──
  async _fixUserRegions() {
    var regions = typeof TW_REGIONS !== 'undefined' ? TW_REGIONS : [];
    if (!regions.length) { this.showToast('TW_REGIONS \u672A\u5B9A\u7FA9'); return; }
    var defaultRegion = '\u53F0\u4E2D\u5E02'; // 台中市
    // 先掃描確認數量
    this.showToast('\u6B63\u5728\u6383\u63CF...');
    try {
      var snap = await db.collection('users').get();
      var targets = [];
      snap.forEach(function(doc) {
        var d = doc.data();
        var region = (d.region || '').trim();
        if (!region || regions.indexOf(region) === -1) {
          targets.push({ id: doc.id, name: d.displayName || d.name || doc.id, oldRegion: region || '(\u672A\u586B)' });
        }
      });
      if (!targets.length) {
        this.showToast('\u6240\u6709\u7528\u6236\u5730\u5340\u5747\u5DF2\u6709\u6548\uFF0C\u7121\u9700\u88DC\u6B63');
        return;
      }
      var names = targets.map(function(t) { return t.name + '(' + t.oldRegion + ')'; });
      if (!await this.appConfirm('\u5373\u5C07\u5C07 ' + targets.length + ' \u4F4D\u7528\u6236\u7684\u5730\u5340\u88DC\u6B63\u70BA\u300C' + defaultRegion + '\u300D\uFF1A\n\n' + names.join('\u3001') + '\n\n\u78BA\u5B9A\u57F7\u884C\uFF1F')) return;
      // 執行補正
      var batch = db.batch();
      var count = 0;
      targets.forEach(function(t) {
        batch.update(db.collection('users').doc(t.id), { region: defaultRegion });
        count++;
        // Firestore batch 上限 500
        if (count >= 490) return;
      });
      await batch.commit();
      // 同步本地快取
      var adminUsers = ApiService.getAdminUsers ? ApiService.getAdminUsers() : [];
      targets.forEach(function(t) {
        var u = adminUsers.find(function(u) { return u._docId === t.id || u.uid === t.id; });
        if (u) u.region = defaultRegion;
      });
      var currentUser = ApiService.getCurrentUser ? ApiService.getCurrentUser() : null;
      if (currentUser) {
        var isTarget = targets.some(function(t) { return t.id === currentUser.uid || t.id === currentUser.lineUserId; });
        if (isTarget) currentUser.region = defaultRegion;
      }
      this.showToast('\u5DF2\u5C07 ' + count + ' \u4F4D\u7528\u6236\u5730\u5340\u88DC\u6B63\u70BA ' + defaultRegion);
    } catch (err) {
      this.showToast('\u88DC\u6B63\u5931\u6557\uFF1A' + (err.message || err));
    }
  },

});
