/**
 * SportHub 資料一致性診斷腳本
 * 使用方式：在瀏覽器 console 中貼上並執行（需以 super_admin 登入正式版）
 *
 * 檢查項目：
 * 1. 孤兒報名紀錄（活動不存在或已刪除）
 * 2. 重複報名紀錄（同一 uid+eventId 多筆 registered）
 * 3. 孤兒簽到紀錄（無對應報名）
 * 4. 放鴿子計算 vs 出席統計一致性
 * 5. 過期補正紀錄（raw count 已變但 correction 未更新）
 */
(function runDataIntegrityCheck() {
  console.log('%c═══ SportHub 資料一致性檢查 ═══', 'color:#2563eb;font-size:14px;font-weight:bold');

  const events = ApiService.getEvents() || [];
  const activityRecords = ApiService.getActivityRecords() || [];
  const attendanceRecords = ApiService.getAttendanceRecords() || [];
  const corrections = ApiService.getUserCorrections() || [];
  const eventMap = new Map(events.map(e => [e.id, e]));

  console.log(`📊 資料量：活動 ${events.length}、報名紀錄 ${activityRecords.length}、簽到紀錄 ${attendanceRecords.length}、補正 ${corrections.length}`);

  const issues = [];

  // ─── 1. 孤兒報名紀錄 ───
  console.log('\n%c[1] 孤兒報名紀錄（活動不存在）', 'color:#d97706;font-weight:bold');
  const orphanRegs = activityRecords.filter(r => {
    if (r.status === 'removed' || r.status === 'cancelled') return false;
    return !eventMap.has(r.eventId);
  });
  if (orphanRegs.length > 0) {
    console.warn(`⚠️ 發現 ${orphanRegs.length} 筆報名紀錄的活動不存在：`);
    const grouped = {};
    orphanRegs.forEach(r => { grouped[r.eventId] = (grouped[r.eventId] || 0) + 1; });
    console.table(grouped);
    issues.push({ type: '孤兒報名', count: orphanRegs.length, detail: grouped });
  } else {
    console.log('✅ 無孤兒報名紀錄');
  }

  // ─── 2. 重複報名紀錄 ───
  console.log('\n%c[2] 重複報名紀錄（同 uid+eventId 多筆 registered）', 'color:#d97706;font-weight:bold');
  const regKeys = new Map();
  const duplicates = [];
  activityRecords.forEach(r => {
    if (r.status !== 'registered') return;
    const key = `${r.uid}::${r.eventId}`;
    regKeys.set(key, (regKeys.get(key) || 0) + 1);
  });
  regKeys.forEach((count, key) => {
    if (count > 1) duplicates.push({ key, count });
  });
  if (duplicates.length > 0) {
    console.warn(`⚠️ 發現 ${duplicates.length} 組重複報名：`);
    console.table(duplicates);
    issues.push({ type: '重複報名', count: duplicates.length, detail: duplicates });
  } else {
    console.log('✅ 無重複報名紀錄');
  }

  // ─── 3. 孤兒簽到紀錄（無對應 registered 報名） ───
  console.log('\n%c[3] 孤兒簽到紀錄（有簽到但無正式報名）', 'color:#d97706;font-weight:bold');
  const regSet = new Set();
  activityRecords.forEach(r => {
    if (r.status === 'registered') regSet.add(`${r.uid}::${r.eventId}`);
  });
  const orphanAtt = [];
  const seenAttKeys = new Set();
  attendanceRecords.forEach(r => {
    if (r.companionId || r.participantType === 'companion') return;
    const key = `${r.uid}::${r.eventId}`;
    if (seenAttKeys.has(key)) return;
    seenAttKeys.add(key);
    if (!regSet.has(key)) {
      orphanAtt.push({ uid: r.uid, eventId: r.eventId, type: r.type });
    }
  });
  if (orphanAtt.length > 0) {
    console.warn(`⚠️ 發現 ${orphanAtt.length} 筆簽到紀錄無對應正式報名：`);
    console.table(orphanAtt.slice(0, 20));
    if (orphanAtt.length > 20) console.log(`... 還有 ${orphanAtt.length - 20} 筆`);
    issues.push({ type: '孤兒簽到', count: orphanAtt.length });
  } else {
    console.log('✅ 無孤兒簽到紀錄');
  }

  // ─── 4. 放鴿子 vs 出席統計一致性 ───
  console.log('\n%c[4] 放鴿子 vs 出席統計一致性', 'color:#d97706;font-weight:bold');
  const noShowByUid = App._buildRawNoShowCountByUid();
  const mismatchUsers = [];

  // 取得所有有報名紀錄的 uid
  const allUids = new Set();
  activityRecords.forEach(r => { if (r.uid) allUids.add(r.uid); });

  const stats = App._getAchievementStats?.();
  if (stats) {
    allUids.forEach(uid => {
      const result = stats.getParticipantAttendanceStats({
        uid,
        registrations: ApiService.getActivityRecords(uid),
        attendanceRecords: ApiService.getAttendanceRecords(),
        eventMap,
        now: new Date(),
        isEventEnded: (event) => event?.status === 'ended',
      });
      const rawNoShow = noShowByUid.get(uid) || 0;
      const calculatedNoShow = result.expectedCount - result.attendedCount;
      if (rawNoShow !== calculatedNoShow) {
        mismatchUsers.push({
          uid: uid.slice(0, 12) + '...',
          expectedCount: result.expectedCount,
          attendedCount: result.attendedCount,
          completedCount: result.completedCount,
          rawNoShow,
          calculatedNoShow,
          diff: rawNoShow - calculatedNoShow,
        });
      }
    });
    if (mismatchUsers.length > 0) {
      console.warn(`⚠️ 發現 ${mismatchUsers.length} 位用戶放鴿子數與出席差值不一致（可能因 companion 紀錄）：`);
      console.table(mismatchUsers.slice(0, 20));
      issues.push({ type: '放鴿子不一致', count: mismatchUsers.length, detail: mismatchUsers });
    } else {
      console.log('✅ 所有用戶放鴿子數與出席統計一致');
    }
  } else {
    console.log('⏭ 無法取得 stats 模組，跳過此項');
  }

  // ─── 5. 補正紀錄檢查 ───
  console.log('\n%c[5] 補正紀錄一致性', 'color:#d97706;font-weight:bold');
  const staleCorrections = [];
  corrections.forEach(doc => {
    const uid = String(doc?.uid || doc?._docId || '').trim();
    if (!uid || !doc?.noShow) return;
    const rawCount = noShowByUid.get(uid) || 0;
    const baseRaw = Number(doc.noShow.baseRawCount || 0);
    const adjustment = Number(doc.noShow.adjustment || 0);
    const targetCount = Number(doc.noShow.targetCount || 0);
    const effectiveNow = Math.max(0, rawCount + adjustment);
    if (baseRaw !== rawCount) {
      staleCorrections.push({
        uid: uid.slice(0, 12) + '...',
        baseRawWhenSet: baseRaw,
        currentRaw: rawCount,
        adjustment,
        targetWhenSet: targetCount,
        effectiveNow,
        note: rawCount > baseRaw ? '活動結束後 raw 增加' : 'raw 減少（活動刪除或重開）',
      });
    }
  });
  if (staleCorrections.length > 0) {
    console.warn(`⚠️ 發現 ${staleCorrections.length} 筆補正紀錄的 baseRawCount 已過時：`);
    console.table(staleCorrections);
    issues.push({ type: '過時補正', count: staleCorrections.length, detail: staleCorrections });
  } else {
    console.log('✅ 所有補正紀錄一致');
  }

  // ─── 6. 已結束活動無任何簽到紀錄 ───
  console.log('\n%c[6] 已結束活動但無任何簽到紀錄', 'color:#d97706;font-weight:bold');
  const endedEvents = events.filter(e => e.status === 'ended');
  const eventsWithCheckin = new Set();
  attendanceRecords.forEach(r => {
    if (r.type === 'checkin') eventsWithCheckin.add(r.eventId);
  });
  const noCheckinEvents = endedEvents.filter(e => {
    const hasRegs = activityRecords.some(r => r.eventId === e.id && r.status === 'registered');
    return hasRegs && !eventsWithCheckin.has(e.id);
  });
  if (noCheckinEvents.length > 0) {
    console.warn(`⚠️ 發現 ${noCheckinEvents.length} 個已結束活動有報名但零簽到（所有人都放鴿子？）：`);
    console.table(noCheckinEvents.map(e => ({
      id: e.id,
      title: e.title,
      date: e.date,
      status: e.status,
    })));
    issues.push({ type: '零簽到活動', count: noCheckinEvents.length });
  } else {
    console.log('✅ 所有已結束活動都有簽到紀錄');
  }

  // ─── 總結 ───
  console.log('\n%c═══ 診斷結果總結 ═══', 'color:#2563eb;font-size:14px;font-weight:bold');
  if (issues.length === 0) {
    console.log('%c✅ 所有檢查通過，資料一致性良好！', 'color:#15803d;font-size:13px');
  } else {
    console.warn(`%c⚠️ 發現 ${issues.length} 類問題需要注意：`, 'color:#dc2626;font-size:13px');
    issues.forEach((issue, i) => {
      console.log(`  ${i + 1}. ${issue.type}：${issue.count} 筆`);
    });
    console.log('\n💡 建議處理方式：');
    console.log('  - 孤兒報名：可能是活動被刪除後報名紀錄殘留，可安全忽略或清理');
    console.log('  - 重複報名：需手動檢查並移除多餘紀錄');
    console.log('  - 孤兒簽到：可能是管理員手動簽到但用戶未正式報名，通常無害');
    console.log('  - 放鴿子不一致：差異通常來自 companion 紀錄，屬正常現象');
    console.log('  - 過時補正：建議到「放鴿子補正」頁面重新確認受影響用戶的數值');
    console.log('  - 零簽到活動：確認是否忘記執行簽到流程');
  }

  return { issues, summary: issues.length === 0 ? '全部通過' : `${issues.length} 類問題` };
})();
