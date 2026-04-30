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

  _setupDataSyncToolLayout(access = {}) {
    const pane = document.getElementById('repair-pane-data-sync');
    const noShowPane = document.getElementById('repair-pane-no-show');
    if (!pane) return;

    const findRunCard = (op) => {
      const btn = pane.querySelector(`button[onclick="App.runDataSyncOp('${op}')"]`)
        || document.querySelector(`button[onclick="App.runDataSyncOp('${op}')"]`);
      return btn?.closest('.form-card') || null;
    };
    const findDirectCard = (handler) => {
      const btn = pane.querySelector(`button[onclick="App.${handler}()"]`)
        || document.querySelector(`button[onclick="App.${handler}()"]`);
      return btn?.closest('.form-card') || null;
    };
    const noShowCard = findRunCard('noShowCount');
    if (noShowCard) {
      noShowCard.id = 'no-show-resync-card';
      noShowCard.style.display = access.dataSync ? '' : 'none';
      if (noShowPane && noShowCard.parentElement !== noShowPane) {
        const anchor = noShowPane.querySelector('.form-card');
        noShowPane.insertBefore(noShowCard, anchor?.nextElementSibling || null);
      }
    }

    const fullCard = document.getElementById('data-sync-full-btn')?.closest('.form-card');
    if (fullCard) fullCard.style.display = 'none';

    if (pane.dataset.toolLayoutReady === '1') return;

    const progressCard = document.getElementById('data-sync-progress')?.closest('.form-card');
    const introCard = pane.querySelector('.form-card');
    if (introCard && !introCard.querySelector('.data-sync-password-note')) {
      const note = document.createElement('div');
      note.className = 'data-sync-password-note';
      note.style.cssText = 'margin-top:.55rem;font-size:.74rem;color:var(--warning);line-height:1.55';
      note.textContent = '所有功能按鈕執行前都會先輸入密碼，並由後端驗證通過後才開始處理。';
      introCard.appendChild(note);
    }

    const makeSection = (id, title, desc) => {
      const section = document.createElement('div');
      section.id = id;
      section.className = 'data-sync-tool-section';
      section.style.marginBottom = '.8rem';
      const head = document.createElement('div');
      head.style.cssText = 'font-weight:700;font-size:.84rem;margin:.2rem 0 .45rem;color:var(--text-primary)';
      head.textContent = title;
      const sub = document.createElement('div');
      sub.style.cssText = 'font-size:.72rem;color:var(--text-muted);line-height:1.55;margin:-.2rem 0 .5rem';
      sub.textContent = desc;
      section.appendChild(head);
      section.appendChild(sub);
      return section;
    };

    const daily = makeSection('data-sync-daily-tools', '日常修復', '常用且低風險的資料重算工具。');
    const health = makeSection('data-sync-health-tools', '健康檢查', '用來檢查 UID 與活動名單一致性，不直接修改正式資料。');
    const advanced = document.createElement('details');
    advanced.id = 'data-sync-advanced-tools';
    advanced.style.cssText = 'margin-bottom:.8rem;border:1px solid var(--border);border-radius:var(--radius-md, 12px);background:var(--bg-elevated);padding:.65rem .65rem .2rem';
    const summary = document.createElement('summary');
    summary.style.cssText = 'cursor:pointer;font-weight:700;font-size:.84rem;color:var(--warning);margin-bottom:.55rem';
    summary.textContent = '進階 / 歷史工具';
    const advancedDesc = document.createElement('div');
    advancedDesc.style.cssText = 'font-size:.72rem;color:var(--text-muted);line-height:1.55;margin:.1rem 0 .6rem';
    advancedDesc.textContent = '較少使用或影響範圍較大的舊資料工具，僅在明確需要修復時執行。';
    advanced.appendChild(summary);
    advanced.appendChild(advancedDesc);

    const insertBefore = progressCard || pane.lastElementChild;
    pane.insertBefore(daily, insertBefore);
    pane.insertBefore(health, insertBefore);
    pane.insertBefore(advanced, insertBefore);

    ['teamMembers', 'userTeam'].forEach((op) => {
      const card = findRunCard(op);
      if (card) daily.appendChild(card);
    });
    ['checkPU', 'uidFallbackCheck'].forEach((op) => {
      const card = findRunCard(op);
      if (card) health.appendChild(card);
    });
    [
      findRunCard('achievement'),
      findRunCard('orphan'),
      findRunCard('uidMigration'),
      findDirectCard('_scanUserRegions'),
      findDirectCard('_backfillEventRegion'),
      findRunCard('backfillPU'),
      findRunCard('forceRebuildPU'),
    ].filter(Boolean).forEach((card) => advanced.appendChild(card));

    pane.dataset.toolLayoutReady = '1';
  },

  async _verifyDataSyncActionPassword(actionTitle) {
    if (!this.hasPermission?.('admin.repair.data_sync')) {
      this.showToast('權限不足，無法執行資料同步。');
      return '';
    }
    if (typeof this._promptDataSyncPassword !== 'function') {
      this.showToast('密碼驗證功能尚未載入，請重新整理後再試。');
      return '';
    }
    const password = await this._promptDataSyncPassword(actionTitle || '系統資料同步');
    if (!password) {
      this.showToast('已取消，操作沒有執行。');
      return '';
    }
    try {
      const callable = firebase.app().functions('asia-east1').httpsCallable('verifyDataSyncPassword');
      await callable({ password });
      return password;
    } catch (err) {
      const message = typeof this._getDataSyncGuardErrorMessage === 'function'
        ? this._getDataSyncGuardErrorMessage(err, '密碼驗證失敗，操作沒有執行。')
        : '密碼驗證失敗，操作沒有執行。';
      console.error('[verifyDataSyncPassword]', err);
      this.showToast(message);
      return '';
    }
  },

  async _ensureDataSyncPassword(actionTitle, verifiedPassword) {
    return verifiedPassword || this._verifyDataSyncActionPassword(actionTitle);
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
      const password = await this._verifyDataSyncActionPassword('成就進度同步');
      if (!password) return;
      return this.runAchievementBatchUpdate();
    }

    if (op === 'noShowCount') {
      const password = await this._verifyDataSyncActionPassword('放鴿子次數重算');
      if (!password) return;
      return this._syncNoShowCount(password);
    }

    if (op === 'uidFallbackCheck') {
      const password = await this._verifyDataSyncActionPassword('同暱稱 UID 偵測');
      if (!password) return;
      return this._checkUidFallbackSafety(password);
    }

    if (op === 'backfillPU') {
      const password = await this._verifyDataSyncActionPassword('participantsWithUid 資料遷移');
      if (!password) return;
      return this._backfillParticipantsWithUid(password);
    }

    if (op === 'checkPU') {
      const password = await this._verifyDataSyncActionPassword('participantsWithUid 一致性檢查');
      if (!password) return;
      return this._checkParticipantsConsistency(password);
    }

    if (op === 'forceRebuildPU') {
      const password = await this._verifyDataSyncActionPassword('participantsWithUid 強制重算');
      if (!password) return;
      return this._forceRebuildParticipantsWithUid(password);
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
    const password = await this._verifyDataSyncActionPassword(config.label);
    if (!password) return;

    this._dataSyncRunning = true;
    const ui = this._dataSyncUI();
    ui.show();
    const startTime = Date.now();

    try {
      await this[config.fn](ui, password);
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
  async _syncUidMigration(ui, verifiedPassword) {
    ui.log('開始 UID 欄位修正...');
    ui.log('呼叫 Cloud Function（dry-run 預覽）...');

    const fn = firebase.app().functions('asia-east1').httpsCallable('migrateUidFields');
    const passwordPayload = verifiedPassword ? { password: verifiedPassword } : {};
    let dryResult;
    try {
      const resp = await fn({ dryRun: true, collection: 'both', ...passwordPayload });
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
      const resp = await fn({ dryRun: false, collection: 'both', ...passwordPayload });
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

  // ── ⑦ 活動地區批次設定（全部設為中部 + 縣市全選）──
  async _backfillEventRegion(verifiedPassword) {
    if (!this.hasPermission?.('admin.repair.data_sync')) {
      this.showToast('權限不足');
      return;
    }
    if (this._dataSyncRunning) {
      this.showToast('同步作業正在執行中');
      return;
    }

    const password = await this._ensureDataSyncPassword('活動地區批次設定', verifiedPassword);
    if (!password) return;

    var CENTRAL_CITIES = ['台中市', '苗栗縣', '彰化縣', '南投縣', '雲林縣'];
    var ok = await this.appConfirm(
      '確定要將所有活動（不分狀態）的地區設定為「中部」，並勾選全部中部縣市嗎？\n\n' +
      '縣市：' + CENTRAL_CITIES.join('、') + '\n\n' +
      '此操作會覆寫所有活動現有的地區設定。'
    );
    if (!ok) return;

    this._dataSyncRunning = true;
    var ui = this._dataSyncUI();
    ui.show();
    ui.log('開始活動地區批次設定...');
    var startTime = Date.now();

    try {
      ui.log('從 Firestore 載入所有活動...');
      var snap = await db.collection('events').get();
      ui.log('共 ' + snap.size + ' 筆活動');

      var updated = 0;
      var skipped = 0;
      var docs = snap.docs;
      for (var i = 0; i < docs.length; i++) {
        var doc = docs[i];
        var data = doc.data();
        var curRegion = (data.region || '').trim();
        var curEnabled = data.regionEnabled;
        var curCities = Array.isArray(data.cities) ? data.cities.slice().sort().join(',') : '';
        var targetCities = CENTRAL_CITIES.slice().sort().join(',');

        if (curEnabled === true && curRegion === '中部' && curCities === targetCities) {
          skipped++;
        } else {
          await db.collection('events').doc(doc.id).update({
            regionEnabled: true,
            region: '中部',
            cities: CENTRAL_CITIES,
          });
          updated++;
          ui.log('已更新：' + (data.title || data.name || doc.id));
        }
        ui.setProgress(i + 1, docs.length);
        if (i % 10 === 0) await new Promise(function(r) { setTimeout(r, 0); });
      }

      var elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      ui.log('\n=== 活動地區批次設定完成（' + elapsed + ' 秒）===');
      ui.log('已更新 ' + updated + ' 筆，跳過 ' + skipped + ' 筆（已正確）');
      this.showToast('活動地區設定完成：更新 ' + updated + ' 筆');

      if (updated > 0) {
        ApiService._writeOpLog?.('data_sync', '活動地區批次設定', '全部設為中部+縣市全選，更新 ' + updated + '/' + docs.length + ' 筆');
      }

      // 同步本地快取
      var cachedEvents = ApiService.getEvents?.() || [];
      cachedEvents.forEach(function(e) {
        e.regionEnabled = true;
        e.region = '中部';
        e.cities = CENTRAL_CITIES.slice();
      });
    } catch (err) {
      ui.log('錯誤：' + (err.message || err));
      this.showToast('活動地區設定失敗');
    } finally {
      this._dataSyncRunning = false;
    }
  },

  // ── ⑥ 用戶地區掃描 ──
  async _scanUserRegions(verifiedPassword) {
    if (this._dataSyncRunning) {
      this.showToast('同步作業正在執行中');
      return;
    }
    if (!this.hasPermission?.('admin.repair.data_sync')) {
      this.showToast('權限不足');
      return;
    }
    const password = await this._ensureDataSyncPassword('用戶地區掃描', verifiedPassword);
    if (!password) return;
    var regions = typeof TW_REGIONS !== 'undefined' ? TW_REGIONS : [];
    if (!regions.length) { this.showToast('TW_REGIONS 未定義'); return; }
    this._dataSyncRunning = true;
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
    } finally {
      this._dataSyncRunning = false;
    }
  },

  // ── ⑥ 用戶地區強制補正 ──
  async _fixUserRegions(verifiedPassword) {
    if (this._dataSyncRunning) {
      this.showToast('同步作業正在執行中');
      return;
    }
    if (!this.hasPermission?.('admin.repair.data_sync')) {
      this.showToast('權限不足');
      return;
    }
    const password = await this._ensureDataSyncPassword('用戶地區補正', verifiedPassword);
    if (!password) return;
    var regions = typeof TW_REGIONS !== 'undefined' ? TW_REGIONS : [];
    if (!regions.length) { this.showToast('TW_REGIONS \u672A\u5B9A\u7FA9'); return; }
    var defaultRegion = '\u53F0\u4E2D\u5E02'; // 台中市
    // 先掃描確認數量
    this._dataSyncRunning = true;
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
      // 用可滾動彈窗取代 appConfirm（名單可能上百人）
      var confirmed = await new Promise(function(resolve) {
        var ov = document.createElement('div');
        ov.className = 'edu-info-overlay';
        ov.onclick = function(e) { if (e.target === ov) { ov.remove(); resolve(false); } };
        ov.innerHTML = '<div class="edu-info-dialog" style="max-width:400px;max-height:calc(100vh - 2rem);display:flex;flex-direction:column">'
          + '<div class="edu-info-dialog-title" style="flex-shrink:0">\u5730\u5340\u88DC\u6B63\u78BA\u8A8D</div>'
          + '<div class="edu-info-dialog-body" style="overflow-y:auto;-webkit-overflow-scrolling:touch;flex:1;min-height:0">'
          + '<div style="font-size:.8rem;margin-bottom:.4rem">\u5373\u5C07\u5C07 <b>' + targets.length + '</b> \u4F4D\u7528\u6236\u7684\u5730\u5340\u88DC\u6B63\u70BA\u300C<b>' + escapeHTML(defaultRegion) + '</b>\u300D\uFF1A</div>'
          + '<pre style="white-space:pre-wrap;font-size:.72rem;line-height:1.5;margin:0;color:var(--text-secondary)">' + escapeHTML(names.join('\n')) + '</pre>'
          + '</div>'
          + '<div style="display:flex;gap:.5rem;margin-top:.6rem;flex-shrink:0">'
          + '<button class="outline-btn" style="flex:1" onclick="this.closest(\'.edu-info-overlay\').remove();App._fixRegionResolve&&App._fixRegionResolve(false)">\u53D6\u6D88</button>'
          + '<button class="primary-btn" style="flex:1" onclick="this.closest(\'.edu-info-overlay\').remove();App._fixRegionResolve&&App._fixRegionResolve(true)">\u78BA\u5B9A\u88DC\u6B63</button>'
          + '</div></div>';
        App._fixRegionResolve = resolve;
        document.body.appendChild(ov);
      });
      delete App._fixRegionResolve;
      if (!confirmed) return;
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
    } finally {
      this._dataSyncRunning = false;
    }
  },

  // ── ⑧ 放鴿子次數重算（呼叫 Cloud Function）──
  async _syncNoShowCount(verifiedPassword) {
    if (this._dataSyncRunning) {
      this.showToast('同步作業正在執行中');
      return;
    }
    if (!this.hasPermission?.('admin.repair.data_sync')) {
      this.showToast('權限不足');
      return;
    }
    const password = await this._ensureDataSyncPassword('放鴿子次數重算', verifiedPassword);
    if (!password) return;
    var ok = await this.appConfirm(
      '確定要重算全站放鴿子次數嗎？\n\n' +
      '將呼叫 Cloud Function 重新掃描所有已結束活動的報名與簽到紀錄，\n' +
      '計算結果會直接寫回每位用戶的文件。\n\n' +
      '預估耗時：數秒至十數秒'
    );
    if (!ok) return;

    this._dataSyncRunning = true;
    var ui = this._dataSyncUI();
    ui.show();
    ui.log('呼叫 Cloud Function calcNoShowCountsManual ...');
    var startTime = Date.now();

    try {
      var fn = firebase.app().functions('asia-east1');
      var callable = fn.httpsCallable('calcNoShowCountsManual');
      var resp = await callable({ password: password });
      var r = resp.data || {};
      var elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      ui.log('掃描活動：' + (r.scannedEvents || 0) + ' 個已結束活動');
      ui.log('報名紀錄：' + (r.totalRegs || 0) + ' 筆');
      ui.log('簽到紀錄：' + (r.totalCheckins || 0) + ' 筆');
      ui.log('更新用戶：' + (r.updatedUsers || 0) + ' 位');
      ui.log('\n=== 放鴿子次數重算完成（' + elapsed + ' 秒）===');
      this.showToast('放鴿子重算完成，更新 ' + (r.updatedUsers || 0) + ' 位用戶');
    } catch (err) {
      ui.log('錯誤：' + (err.message || err));
      console.error('[_syncNoShowCount]', err);
      this.showToast('放鴿子重算失敗');
    } finally {
      this._dataSyncRunning = false;
    }
  },

  // ── ⑨ 同暱稱用戶偵測（唯讀，無寫入）──
  // 列出 users 集合中同名用戶組，標記 _userByName.set() 的「勝者 UID」，
  // 並對每組同名顯示：活動 participants[] 受污染範圍、各 UID 報名數、放鴿子次數。
  async _checkUidFallbackSafety(verifiedPassword) {
    if (this._dataSyncRunning) { this.showToast('同步作業正在執行中'); return; }
    if (!this.hasPermission?.('admin.repair.data_sync')) { this.showToast('權限不足'); return; }
    const password = await this._ensureDataSyncPassword('同暱稱 UID 偵測', verifiedPassword);
    if (!password) return;

    this._dataSyncRunning = true;
    var ui = this._dataSyncUI();
    ui.show();
    var startTime = Date.now();

    try {
      ui.log('=== 同暱稱用戶偵測 ===');

      // Step 1：從 adminUsers 找同名組（模擬 _userByName.set() 的覆蓋行為）
      ui.log('\n[1] 掃描 users 集合尋找同名組');
      ui.setProgress(1, 4);
      var users = ApiService.getAdminUsers() || [];
      var byName = new Map();
      users.forEach(function (u) {
        var n = String(u.displayName || u.name || '').trim();
        if (!n) return;
        if (!byName.has(n)) byName.set(n, []);
        byName.get(n).push(u);
      });
      var dupGroups = [];
      byName.forEach(function (arr, name) {
        if (arr.length > 1) dupGroups.push({ name: name, members: arr });
      });
      ui.log('  users 總數: ' + users.length + ', 同名組數: ' + dupGroups.length);
      if (dupGroups.length === 0) {
        ui.log('  OK: 沒有同暱稱用戶，_buildConfirmedParticipantSummary fallback 不會誤配');
        var elapsed0 = ((Date.now() - startTime) / 1000).toFixed(1);
        ui.log('\n=== 檢查完成（' + elapsed0 + ' 秒）===');
        this.showToast('同暱稱檢查完成：無同名組');
        return;
      }

      // Step 2：載入 registrations 計算各 UID 活躍度
      ui.log('\n[2] 載入 registrations 計算各 UID 報名數');
      ui.setProgress(2, 4);
      var regSnap = await db.collectionGroup('registrations').get();
      var regDocs = regSnap.docs.filter(function (d) { return d.ref.parent.parent !== null; });
      var regCountByUid = {};
      regDocs.forEach(function (d) {
        var uid = String(d.data().userId || '').trim();
        if (!uid) return;
        regCountByUid[uid] = (regCountByUid[uid] || 0) + 1;
      });
      ui.log('  registrations 總數: ' + regDocs.length);

      // Step 3：對每組同名，分析污染範圍
      ui.log('\n[3] 每組同名的污染分析');
      ui.setProgress(3, 4);
      var events = FirebaseService._cache.events || [];
      dupGroups.forEach(function (group, idx) {
        ui.log('\n  === 第 ' + (idx + 1) + ' 組：「' + group.name + '」 (' + group.members.length + ' 人) ===');
        // _userByName.set() 的覆蓋勝者 = members 陣列最後一個
        var winner = group.members[group.members.length - 1];
        var winnerUid = String(winner.uid || winner.lineUserId || '').trim();
        // 掃描 events.participants[] 包含此 name 的活動
        var affectedEvents = events.filter(function (e) {
          return Array.isArray(e.participants) && e.participants.indexOf(group.name) >= 0;
        });
        ui.log('  受影響活動數（participants[] 含此暱稱）: ' + affectedEvents.length);
        if (affectedEvents.length > 0) {
          affectedEvents.slice(0, 5).forEach(function (e) {
            ui.log('    - ' + (e.title || '?') + ' (status=' + e.status + ')');
          });
          if (affectedEvents.length > 5) ui.log('    ...還有 ' + (affectedEvents.length - 5) + ' 個活動');
        }
        ui.log('  成員列表（勝者標示 [WIN]，受害者標示 [LOSE]）:');
        group.members.forEach(function (u) {
          var uid = String(u.uid || u.lineUserId || '').trim();
          var isWin = uid === winnerUid;
          var regCount = regCountByUid[uid] || 0;
          var noShow = Number(u.noShowCount || 0);
          var lastLogin = u.lastLogin || u.lastActive || '';
          var lastStr = lastLogin ? (' lastActive=' + String(lastLogin).slice(0, 10)) : '';
          ui.log('    ' + (isWin ? '[WIN] ' : '[LOSE]') + ' uid=' + uid + ' | 報名=' + regCount + ' 次 | 放鴿子=' + noShow + ' 次' + lastStr);
        });
        if (affectedEvents.length > 0) {
          ui.log('  ⚠️ bug 行為：顯示「' + group.name + '」的放鴿子次數時，全部會顯示為 [WIN] uid=' + winnerUid + ' 的值（' + (Number(winner.noShowCount || 0)) + ' 次）');
        }
      });

      // Step 4：建議
      ui.log('\n[4] 建議');
      ui.setProgress(4, 4);
      ui.log('  根本解法（推薦）：改用 event.participantsWithUid[] 物件陣列（{uid, name}），消除 name 反查');
      ui.log('  快速解法：請同名組中的「受害者」改暱稱（至少一位改名即可破解衝突）');
      ui.log('  Patch 解法：在 _buildConfirmedParticipantSummary fallback 偵測同名時跳過該 participant（顯示但不發 uid）');

      var elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      ui.log('\n=== 檢查完成（' + elapsed + ' 秒）===');
      this.showToast('同暱稱檢查完成：' + dupGroups.length + ' 組');
    } catch (err) {
      ui.log('錯誤：' + (err.message || err));
      console.error('[_checkUidFallbackSafety]', err);
      this.showToast('同暱稱檢查失敗');
    } finally {
      this._dataSyncRunning = false;
    }
  },

  // ── ⑩ participantsWithUid 資料遷移（Phase 2）──
  // 為所有現存 events 補齊 participantsWithUid / waitlistWithUid 欄位
  // 策略：從 registrations 子集合重建（不從 participants[] 字串反查 UID，避免同名挑錯）
  // Race 緩解：double-check schemaVersion 避免 overwrite Phase 1 路徑的新寫入
  async _backfillParticipantsWithUid(verifiedPassword) {
    if (this._dataSyncRunning) { this.showToast('同步作業正在執行中'); return; }
    if (!this.hasPermission?.('admin.repair.data_sync')) { this.showToast('權限不足'); return; }
    const password = await this._ensureDataSyncPassword('participantsWithUid 資料遷移', verifiedPassword);
    if (!password) return;

    var events = FirebaseService._cache.events || [];
    var est = {
      reads: events.length * 3 + 100,  // 每個 event: 2 reads(event) + 1 query(registrations) + safety buffer
      writes: events.length,
    };
    var cost = ((est.reads * 0.06 / 100000) + (est.writes * 0.18 / 100000)).toFixed(4);
    var ok = await this.appConfirm(
      '確定執行 participantsWithUid 遷移嗎？\n\n' +
      '總 events: ' + events.length + '\n' +
      '預估讀取：~' + est.reads.toLocaleString() + ' 次\n' +
      '預估寫入：至多 ~' + est.writes.toLocaleString() + ' 次\n' +
      '預估費用：~$' + cost + ' USD\n\n' +
      '說明：從每個 event 的 registrations 子集合重建 UID 欄位。\n' +
      '已升級（schemaVersion=2）者會跳過。請勿關閉頁面。'
    );
    if (!ok) return;

    this._dataSyncRunning = true;
    var ui = this._dataSyncUI();
    ui.show();
    var startTime = Date.now();
    var migrated = 0, skipped = 0, failed = 0;

    try {
      ui.log('=== participantsWithUid 資料遷移 ===');
      ui.log('總 events: ' + events.length);

      for (var i = 0; i < events.length; i++) {
        var event = events[i];
        var docId = event._docId;
        if (!docId) {
          ui.log('[skip] no _docId: ' + (event.title || '?'));
          skipped++;
          continue;
        }

        try {
          // Step 1: Read event（server fresh）
          var eventDoc = await db.collection('events').doc(docId).get({ source: 'server' });
          var ed = eventDoc.data();

          // Step 2: 跳過已升級者
          if (ed.schemaVersion === 2
            && Array.isArray(ed.participantsWithUid)
            && ed.participantsWithUid.length === (ed.current || 0)) {
            ui.log('[pwu] skip (migrated): ' + (ed.title || docId));
            skipped++;
            ui.setProgress(i + 1, events.length);
            continue;
          }

          // Step 3: 讀 registrations 子集合
          var regsSnap = await db.collection('events').doc(docId)
            .collection('registrations').get();
          var allRegs = regsSnap.docs.map(function (d) {
            var data = d.data();
            // Timestamp 轉 ISO（避免排序問題）
            if (data.registeredAt && typeof data.registeredAt.toDate === 'function') {
              data.registeredAt = data.registeredAt.toDate().toISOString();
            }
            return Object.assign({}, data, { _docId: d.id });
          });

          // Step 4: 第二次 read 減少 race 窗口
          var verify = await db.collection('events').doc(docId).get({ source: 'server' });
          if (verify.data().schemaVersion === 2
            && Array.isArray(verify.data().participantsWithUid)) {
            ui.log('[pwu] skip (race detected): ' + (ed.title || docId));
            skipped++;
            ui.setProgress(i + 1, events.length);
            continue;
          }

          // Step 5: 重算並 update
          var occupancy = FirebaseService._rebuildOccupancy(ed, allRegs);
          await db.collection('events').doc(docId).update({
            current: occupancy.current,
            realCurrent: occupancy.realCurrent,
            waitlist: occupancy.waitlist,
            participants: occupancy.participants,
            waitlistNames: occupancy.waitlistNames,
            participantsWithUid: occupancy.participantsWithUid,
            waitlistWithUid: occupancy.waitlistWithUid,
            teamReservationSummaries: occupancy.teamReservationSummaries,
            status: occupancy.status,
            schemaVersion: 2,
          });
          ui.log('[pwu] migrated: ' + (ed.title || docId)
            + ' (p=' + occupancy.participantsWithUid.length
            + ', w=' + occupancy.waitlistWithUid.length + ')');
          migrated++;
        } catch (err) {
          ui.log('[ERROR] ' + (event.title || docId) + ': ' + (err.message || err));
          console.error('[_backfillParticipantsWithUid]', docId, err);
          failed++;
        }

        ui.setProgress(i + 1, events.length);
        // 避免 Firestore 併發過多
        await new Promise(function (r) { setTimeout(r, 50); });
      }

      var elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      ui.log('\n=== 遷移完成（' + elapsed + ' 秒）===');
      ui.log('已遷移: ' + migrated + ' / 跳過: ' + skipped + ' / 失敗: ' + failed);
      this.showToast('遷移完成：' + migrated + ' 筆');
      ApiService._writeOpLog?.('data_sync', 'participantsWithUid 遷移',
        '遷移 ' + migrated + '/' + events.length + '，跳過 ' + skipped + '，失敗 ' + failed);
    } catch (err) {
      ui.log('致命錯誤：' + (err.message || err));
      console.error('[_backfillParticipantsWithUid]', err);
      this.showToast('遷移失敗');
    } finally {
      this._dataSyncRunning = false;
    }
  },

  // ── ⑪ participantsWithUid 一致性檢查（Phase 4，唯讀）──
  // 比對每個 event 的 participantsWithUid 與從 registrations 重算結果
  async _checkParticipantsConsistency(verifiedPassword) {
    if (this._dataSyncRunning) { this.showToast('同步作業正在執行中'); return; }
    if (!this.hasPermission?.('admin.repair.data_sync')) { this.showToast('權限不足'); return; }
    const password = await this._ensureDataSyncPassword('participantsWithUid 一致性檢查', verifiedPassword);
    if (!password) return;

    this._dataSyncRunning = true;
    var ui = this._dataSyncUI();
    ui.show();
    var startTime = Date.now();
    var events = FirebaseService._cache.events || [];
    var inconsistent = [];
    var checked = 0;

    try {
      ui.log('=== participantsWithUid 一致性檢查 ===');
      ui.log('總 events: ' + events.length);

      for (var i = 0; i < events.length; i++) {
        var event = events[i];
        var docId = event._docId;
        if (!docId) continue;

        try {
          var regsSnap = await db.collection('events').doc(docId)
            .collection('registrations').get();
          var allRegs = regsSnap.docs.map(function (d) {
            var data = d.data();
            if (data.registeredAt && typeof data.registeredAt.toDate === 'function') {
              data.registeredAt = data.registeredAt.toDate().toISOString();
            }
            return Object.assign({}, data, { _docId: d.id });
          });
          var expected = FirebaseService._rebuildOccupancy(event, allRegs);
          var actualP = Array.isArray(event.participantsWithUid) ? event.participantsWithUid : [];
          var actualW = Array.isArray(event.waitlistWithUid) ? event.waitlistWithUid : [];

          var issue = null;
          if (actualP.length !== expected.participantsWithUid.length) {
            issue = 'p 長度差 (expected=' + expected.participantsWithUid.length + ', actual=' + actualP.length + ')';
          } else if (actualW.length !== expected.waitlistWithUid.length) {
            issue = 'w 長度差 (expected=' + expected.waitlistWithUid.length + ', actual=' + actualW.length + ')';
          } else {
            // 逐筆 uid 比對
            for (var j = 0; j < expected.participantsWithUid.length; j++) {
              if (actualP[j]?.uid !== expected.participantsWithUid[j].uid) {
                issue = 'p[' + j + '] uid 不符';
                break;
              }
            }
          }
          if (event.schemaVersion !== 2 && !issue) {
            issue = 'schemaVersion 未升級';
          }

          checked++;
          if (issue) {
            inconsistent.push({ docId: docId, title: event.title || docId, issue: issue });
            ui.log('[INCONSISTENT] ' + (event.title || docId) + ': ' + issue);
          }
        } catch (err) {
          ui.log('[ERROR] ' + (event.title || docId) + ': ' + (err.message || err));
        }

        ui.setProgress(i + 1, events.length);
        await new Promise(function (r) { setTimeout(r, 30); });
      }

      var elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      ui.log('\n=== 檢查完成（' + elapsed + ' 秒）===');
      ui.log('檢查 ' + checked + ' 筆 / 不一致 ' + inconsistent.length + ' 筆');
      if (inconsistent.length > 0) {
        ui.log('\n⚠️ 不一致清單（複製 docId 至 ⑫ 強制重算）：');
        inconsistent.slice(0, 20).forEach(function (x) {
          ui.log('  - ' + x.docId + ' | ' + x.title + ' | ' + x.issue);
        });
        if (inconsistent.length > 20) ui.log('  ...還有 ' + (inconsistent.length - 20) + ' 筆');
      } else {
        ui.log('✅ 所有 events 一致');
      }
      this.showToast('檢查完成：' + inconsistent.length + ' 筆不一致');
    } catch (err) {
      ui.log('致命錯誤：' + (err.message || err));
      console.error('[_checkParticipantsConsistency]', err);
      this.showToast('檢查失敗');
    } finally {
      this._dataSyncRunning = false;
    }
  },

  // ── ⑫ participantsWithUid 強制重算（Phase 4，寫入，含權限守衛）──
  async _forceRebuildParticipantsWithUid(verifiedPassword) {
    if (this._dataSyncRunning) { this.showToast('同步作業正在執行中'); return; }
    if (!this.hasPermission?.('admin.repair.data_sync')) { this.showToast('權限不足'); return; }
    const password = await this._ensureDataSyncPassword('participantsWithUid 強制重算', verifiedPassword);
    if (!password) return;

    var events = FirebaseService._cache.events || [];
    var ok = await this.appConfirm(
      '確定強制重算所有 events 的 participantsWithUid 嗎？\n\n' +
      '⚠️ 此操作會 overwrite 現有 participantsWithUid / waitlistWithUid 欄位。\n' +
      '已一致者會自動跳過（double-check 機制）。\n\n' +
      '總 events: ' + events.length + '\n' +
      '用於修復 Phase 2 遷移後仍不一致的活動（含已結束活動）。\n' +
      '請勿關閉頁面。'
    );
    if (!ok) return;

    this._dataSyncRunning = true;
    var ui = this._dataSyncUI();
    ui.show();
    var startTime = Date.now();
    var rebuilt = 0, skipped = 0, failed = 0;

    try {
      ui.log('=== participantsWithUid 強制重算 ===');

      for (var i = 0; i < events.length; i++) {
        var event = events[i];
        var docId = event._docId;
        if (!docId) continue;

        try {
          // Read 1: event server fresh
          var beforeDoc = await db.collection('events').doc(docId).get({ source: 'server' });
          var ed = beforeDoc.data();

          // Read 2: registrations
          var regsSnap = await db.collection('events').doc(docId)
            .collection('registrations').get();
          var allRegs = regsSnap.docs.map(function (d) {
            var data = d.data();
            if (data.registeredAt && typeof data.registeredAt.toDate === 'function') {
              data.registeredAt = data.registeredAt.toDate().toISOString();
            }
            return Object.assign({}, data, { _docId: d.id });
          });

          // Read 3: verify event 仍不一致（double-check）
          var verifyDoc = await db.collection('events').doc(docId).get({ source: 'server' });
          var expected = FirebaseService._rebuildOccupancy(verifyDoc.data(), allRegs);
          var actualP = verifyDoc.data().participantsWithUid || [];

          var matchLen = actualP.length === expected.participantsWithUid.length;
          var matchUids = matchLen && JSON.stringify(actualP.map(function (x) { return x.uid; }))
                       === JSON.stringify(expected.participantsWithUid.map(function (x) { return x.uid; }));
          if (matchUids && verifyDoc.data().schemaVersion === 2) {
            ui.log('[pwu] skip (already healed): ' + (ed.title || docId));
            skipped++;
            ui.setProgress(i + 1, events.length);
            continue;
          }

          // 寫入
          await db.collection('events').doc(docId).update({
            current: expected.current,
            realCurrent: expected.realCurrent,
            waitlist: expected.waitlist,
            participants: expected.participants,
            waitlistNames: expected.waitlistNames,
            participantsWithUid: expected.participantsWithUid,
            waitlistWithUid: expected.waitlistWithUid,
            teamReservationSummaries: expected.teamReservationSummaries,
            status: expected.status,
            schemaVersion: 2,
          });
          ui.log('[pwu] force rebuilt: ' + (ed.title || docId)
            + ' (p=' + expected.participantsWithUid.length + ')');
          rebuilt++;
        } catch (err) {
          ui.log('[ERROR] ' + (event.title || docId) + ': ' + (err.message || err));
          failed++;
        }

        ui.setProgress(i + 1, events.length);
        await new Promise(function (r) { setTimeout(r, 50); });
      }

      var elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      ui.log('\n=== 強制重算完成（' + elapsed + ' 秒）===');
      ui.log('重算 ' + rebuilt + ' / 跳過 ' + skipped + ' / 失敗 ' + failed);
      this.showToast('強制重算完成：' + rebuilt + ' 筆');
      ApiService._writeOpLog?.('data_sync', 'participantsWithUid 強制重算',
        '重算 ' + rebuilt + '，跳過 ' + skipped + '，失敗 ' + failed);
    } catch (err) {
      ui.log('致命錯誤：' + (err.message || err));
      console.error('[_forceRebuildParticipantsWithUid]', err);
      this.showToast('強制重算失敗');
    } finally {
      this._dataSyncRunning = false;
    }
  },

});
