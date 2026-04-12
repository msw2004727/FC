/* ================================================
   SportHub - Achievement Batch Update
   一鍵為所有用戶重新計算成就進度，
   寫入 users/{uid}/achievements + registrations.displayBadges
   ================================================ */

Object.assign(App, {

  _achBatchRunning: false,

  async runAchievementBatchUpdate(externalLog) {
    if (this._achBatchRunning) {
      this.showToast('批次更新正在執行中');
      return;
    }
    if (!this.hasPermission?.('admin.repair.data_sync')) {
      this.showToast('權限不足');
      return;
    }

    // Cost estimation
    const allUsers = ApiService.getAdminUsers?.() || [];
    const achievements = (ApiService.getAchievements?.() || []).filter(
      a => a && a.status !== 'archived' && a.condition
    );
    const U = allUsers.length;
    const A = achievements.length;
    const estReads = (U * 3) + (FirebaseService._cache?.registrations?.length || 0)
      + (FirebaseService._cache?.activityRecords?.length || 0)
      + (FirebaseService._cache?.attendanceRecords?.length || 0);
    const estWrites = U * A + (FirebaseService._cache?.registrations?.length || 0);
    const estCost = ((estReads * 0.06 / 100000) + (estWrites * 0.18 / 100000)).toFixed(4);

    if (!externalLog) {
      const ok = await this.appConfirm(
        '確定要執行成就進度同步嗎？\n\n' +
        `用戶 ${U} 位 × 成就 ${A} 個\n` +
        `預估讀取：至少 ~${estReads.toLocaleString()} 次\n` +
        `預估寫入：至少 ~${estWrites.toLocaleString()} 次\n` +
        `預估費用：~$${estCost} USD\n\n` +
        '過程可能需要數分鐘，請勿關閉頁面。'
      );
      if (!ok) return;
    }

    this._achBatchRunning = true;
    const progressWrap = document.getElementById('data-sync-progress');
    const bar = document.getElementById('data-sync-bar');
    const percentEl = document.getElementById('data-sync-percent');
    const logEl = externalLog || document.getElementById('data-sync-log');

    if (progressWrap) progressWrap.style.display = '';
    if (logEl) { logEl.style.display = ''; logEl.textContent = ''; }

    const log = (msg) => {
      if (!logEl) return;
      const time = new Date().toLocaleTimeString('zh-TW', { hour12: false });
      logEl.textContent += `[${time}] ${msg}\n`;
      logEl.scrollTop = logEl.scrollHeight;
    };

    const setProgress = (current, total) => {
      const pct = total > 0 ? Math.round((current / total) * 100) : 0;
      if (bar) bar.style.width = pct + '%';
      if (percentEl) percentEl.textContent = `${current}/${total} (${pct}%)`;
    };

    const startTime = Date.now();
    let updatedUsers = 0;
    let updatedRegs = 0;
    let errorCount = 0;
    let skippedUsers = 0;

    try {
      // Step 1: 等待 achievement 模組載入
      log('等待成就模組載入...');
      const achReady = await this._waitForAchievementModule(5000);
      if (!achReady) {
        log('錯誤：成就模組載入超時');
        this.showToast('成就模組載入失敗');
        return;
      }

      // Step 2: 取得所有必要資料
      log('取得用戶、成就、徽章資料...');
      const allUsers = ApiService.getAdminUsers() || [];
      const achievements = (ApiService.getAchievements() || []).filter(
        a => a && a.status !== 'archived' && a.condition
      );
      const badges = ApiService.getBadges() || [];
      const allEvents = ApiService.getEvents() || [];
      const allTeams = ApiService.getTeams() || [];

      if (!allUsers.length) {
        log('錯誤：找不到用戶資料');
        this.showToast('找不到用戶資料');
        return;
      }
      if (!achievements.length) {
        log('錯誤：找不到有效成就');
        this.showToast('找不到有效成就');
        return;
      }

      log(`共 ${allUsers.length} 位用戶，${achievements.length} 個成就，${badges.length} 個徽章`);
      setProgress(0, allUsers.length);

      // Step 3: 逐一處理每個用戶
      for (let i = 0; i < allUsers.length; i++) {
        const user = allUsers[i];
        const uid = String(user?.uid || user?._docId || '').trim();
        if (!uid) {
          skippedUsers++;
          setProgress(i + 1, allUsers.length);
          continue;
        }

        try {
          const result = await this._processOneUserAchievements(
            uid, user, achievements, badges, allEvents, allTeams
          );
          if (result.achWritten > 0) updatedUsers++;
          updatedRegs += result.regWritten;

          if (result.achWritten > 0 || result.regWritten > 0) {
            log(`${user.displayName || user.name || uid}：成就 ${result.achWritten} 筆、徽章 ${result.regWritten} 筆`);
          }
        } catch (err) {
          errorCount++;
          log(`錯誤 [${user.displayName || user.name || uid}]：${err.message || err}`);
          console.warn('[AchBatch] user error:', uid, err);
        }

        setProgress(i + 1, allUsers.length);

        // Yield UI
        if (i % 3 === 0) {
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }

      // Step 4: 總結
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      log('');
      log(`=== 完成 ===`);
      log(`耗時：${elapsed} 秒`);
      log(`更新用戶：${updatedUsers}/${allUsers.length}`);
      log(`跳過用戶：${skippedUsers}`);
      log(`更新報名徽章：${updatedRegs} 筆`);
      if (errorCount > 0) log(`錯誤：${errorCount} 個`);

      this.showToast(`成就批次更新完成（${updatedUsers} 位用戶）`);

    } catch (err) {
      log(`致命錯誤：${err.message || err}`);
      console.error('[AchBatch] fatal:', err);
      this.showToast('成就批次更新失敗');
    } finally {
      this._achBatchRunning = false;
    }
  },

  async _waitForAchievementModule(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const evaluator = this._getAchievementEvaluator?.();
      const stats = this._getAchievementStats?.();
      const registry = this._getAchievementRegistry?.();
      if (evaluator && stats && registry) return true;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    return false;
  },

  async _processOneUserAchievements(uid, user, achievements, badges, allEvents, allTeams) {
    let achWritten = 0;
    let regWritten = 0;

    // Step A: 從 Firestore 查詢該用戶的完整資料
    const [regSnap, actSnap, attSnap] = await Promise.all([
      db.collectionGroup('registrations').where('userId', '==', uid).get(),
      db.collectionGroup('activityRecords').where('uid', '==', uid).get(),
      db.collectionGroup('attendanceRecords').where('uid', '==', uid).get(),
    ]);

    let registrations = regSnap.docs
      .filter(doc => doc.ref.parent.parent !== null)
      .map(doc => ({ ...doc.data(), _docId: doc.id }));
    let activityRecords = actSnap.docs
      .filter(doc => doc.ref.parent.parent !== null)
      .map(doc => ({ ...doc.data(), _docId: doc.id }));
    let attendanceRecords = attSnap.docs
      .filter(doc => doc.ref.parent.parent !== null)
      .map(doc => ({ ...doc.data(), _docId: doc.id }));

    // 歷史修正：displayName fallback for attendanceRecords
    if (attendanceRecords.length === 0) {
      const displayName = user.displayName || user.name;
      if (displayName) {
        const attByNameSnap = await db.collectionGroup('attendanceRecords')
          .where('userName', '==', displayName).get();
        attendanceRecords = attByNameSnap.docs
          .filter(doc => doc.ref.parent.parent !== null)
          .map(doc => {
            const data = doc.data();
            return { ...data, uid, _docId: doc.id };
          });
      }
    }

    // Step B: 暫時替換快取 → 呼叫 evaluator → 還原快取
    const savedCache = {
      registrations: FirebaseService._cache.registrations,
      activityRecords: FirebaseService._cache.activityRecords,
      attendanceRecords: FirebaseService._cache.attendanceRecords,
    };
    const savedStatsCache = { ...FirebaseService._userStatsCache };

    let evaluatedAchievements;
    try {
      FirebaseService._cache.registrations = registrations;
      FirebaseService._cache.activityRecords = activityRecords;
      FirebaseService._cache.attendanceRecords = attendanceRecords;
      FirebaseService._userStatsCache = {
        uid,
        activityRecords,
        attendanceRecords,
      };

      const evaluator = this._getAchievementEvaluator();
      evaluatedAchievements = evaluator.getEvaluatedAchievements({
        targetUid: uid,
        targetUser: user,
        achievements,
      });
    } finally {
      // 立即還原快取
      FirebaseService._cache.registrations = savedCache.registrations;
      FirebaseService._cache.activityRecords = savedCache.activityRecords;
      FirebaseService._cache.attendanceRecords = savedCache.attendanceRecords;
      FirebaseService._userStatsCache = savedStatsCache;
    }

    if (!evaluatedAchievements || !evaluatedAchievements.length) return { achWritten, regWritten };

    // Step C: 計算 earnedBadges
    const stats = this._getAchievementStats();
    const earnedBadges = stats
      ? stats.getEarnedBadgeViewModels(evaluatedAchievements, badges)
      : [];

    // Step D: 批次寫入 achievement_progress 子集合
    const achRef = db.collection('users').doc(uid).collection('achievements');
    const BATCH_LIMIT = 450;
    let batchOps = [];

    for (const ach of evaluatedAchievements) {
      const achId = String(ach?.id || '').trim();
      if (!achId) continue;
      // 只寫有條件的成就
      if (!ach.condition) continue;

      batchOps.push({
        ref: achRef.doc(achId),
        data: {
          achId,
          current: ach.current || 0,
          completedAt: ach.completedAt || null,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        },
      });
    }

    // 分批寫入
    for (let start = 0; start < batchOps.length; start += BATCH_LIMIT) {
      const chunk = batchOps.slice(start, start + BATCH_LIMIT);
      const batch = db.batch();
      for (const op of chunk) {
        batch.set(op.ref, op.data, { merge: true });
      }
      await batch.commit();
      achWritten += chunk.length;
    }

    // Step E: 更新有變動的 registrations.displayBadges
    const newDisplayBadges = earnedBadges
      .map(item => ({
        id: item.badge?.id || '',
        name: item.badge?.name || '',
        image: item.badge?.image || '',
      }))
      .filter(b => b.image);

    const newBadgeIds = newDisplayBadges.map(b => b.id).sort().join(',');

    // 找到該用戶的所有活動報名（本人、非取消）
    const activeRegs = registrations.filter(r => {
      const status = String(r.status || '').trim();
      if (status === 'cancelled' || status === 'removed') return false;
      if (r.companionId || r.participantType === 'companion') return false;
      return true;
    });

    for (const reg of activeRegs) {
      const docId = reg._docId;
      if (!docId) continue;

      const oldBadges = reg.displayBadges || [];
      const oldBadgeIds = oldBadges.map(b => b.id).sort().join(',');
      if (oldBadgeIds === newBadgeIds) continue;

      try {
        await db.collection('registrations').doc(docId).update({ displayBadges: newDisplayBadges });
        // [dual-write] registrations 子集合
        try {
          var _dwDocId = await FirebaseService._getEventDocIdAsync(reg.eventId);
          if (_dwDocId) {
            await db.collection('events').doc(_dwDocId).collection('registrations').doc(docId).update({ displayBadges: newDisplayBadges });
          } else {
            console.error('[dual-write] missing eventDocId for:', reg.eventId);
          }
        } catch (_e) { console.error('[dual-write] achBatch displayBadges:', _e); }
        regWritten++;
      } catch (err) {
        console.warn('[AchBatch] displayBadges update failed:', docId, err);
      }
    }

    return { achWritten, regWritten };
  },

});
