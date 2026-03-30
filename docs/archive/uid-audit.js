/**
 * UID 欄位一致性審計腳本
 * 用途：在瀏覽器 console 執行，檢查 attendanceRecords / activityRecords 中
 *       uid 欄位是否為合法 LINE userId，或誤存為 displayName
 *
 * 使用方式：以管理員身份登入後，在 console 貼上此腳本執行
 * 前置條件：需要 adminUsers 快取已載入（正常登入後即可）
 */
(function uidAudit() {
  'use strict';

  const users = ApiService.getAdminUsers() || [];
  if (!users.length) {
    console.error('[UID Audit] adminUsers 未載入，請確認已登入管理員帳號');
    return;
  }

  // 建立合法 UID 集合（uid / lineUserId）
  const validUids = new Set();
  // 建立 displayName → uid 對照
  const nameToUid = new Map();

  users.forEach(u => {
    const uid = String(u?.uid || u?.lineUserId || '').trim();
    if (!uid) return;
    validUids.add(uid);
    if (u.lineUserId) validUids.add(u.lineUserId);

    [u?.displayName, u?.name].forEach(n => {
      const name = String(n || '').trim();
      if (name && name !== uid) {
        if (nameToUid.has(name) && nameToUid.get(name) !== uid) {
          console.warn(`[UID Audit] 重名警告: "${name}" 對應多個 uid: ${nameToUid.get(name)}, ${uid}`);
        }
        nameToUid.set(name, uid);
      }
    });
  });

  console.log(`[UID Audit] 用戶數: ${users.length}, 合法 UID 數: ${validUids.size}, displayName 映射數: ${nameToUid.size}`);

  function auditCollection(records, collectionName, uidField) {
    const stats = { total: 0, validUid: 0, isDisplayName: 0, unmapped: 0 };
    const unmappedSamples = [];
    const displayNameSamples = [];

    (records || []).forEach(doc => {
      const uid = String(doc?.[uidField] || '').trim();
      if (!uid) return;
      stats.total++;

      if (validUids.has(uid)) {
        stats.validUid++;
      } else if (nameToUid.has(uid)) {
        stats.isDisplayName++;
        if (displayNameSamples.length < 10) {
          displayNameSamples.push({
            docId: doc.id || doc._docId || '?',
            currentUid: uid,
            correctUid: nameToUid.get(uid),
            eventId: doc.eventId || '?',
            userName: doc.userName || '?',
          });
        }
      } else {
        stats.unmapped++;
        if (unmappedSamples.length < 10) {
          unmappedSamples.push({
            docId: doc.id || doc._docId || '?',
            currentUid: uid,
            eventId: doc.eventId || '?',
            userName: doc.userName || '?',
          });
        }
      }
    });

    const pct = (n) => stats.total > 0 ? (n / stats.total * 100).toFixed(1) + '%' : '0%';

    console.group(`[UID Audit] ${collectionName} (uid field: "${uidField}")`);
    console.log(`總筆數: ${stats.total}`);
    console.log(`合法 UID: ${stats.validUid} (${pct(stats.validUid)})`);
    console.log(`是 displayName: ${stats.isDisplayName} (${pct(stats.isDisplayName)})`);
    console.log(`無法映射: ${stats.unmapped} (${pct(stats.unmapped)})`);

    if (displayNameSamples.length > 0) {
      console.log('--- displayName 樣本 ---');
      console.table(displayNameSamples);
    }
    if (unmappedSamples.length > 0) {
      console.log('--- 無法映射樣本 ---');
      console.table(unmappedSamples);
    }
    console.groupEnd();

    return stats;
  }

  // 審計 attendanceRecords
  const attRecords = ApiService.getAttendanceRecords();
  const attStats = auditCollection(attRecords, 'attendanceRecords', 'uid');

  // 審計 activityRecords
  const actRecords = (typeof FirebaseService !== 'undefined' && FirebaseService._cache)
    ? FirebaseService._cache.activityRecords || []
    : ApiService._src?.('activityRecords') || [];
  const actStats = auditCollection(actRecords, 'activityRecords', 'uid');

  // 總結報告
  console.group('[UID Audit] 總結');
  console.log('='.repeat(50));
  console.log(`attendanceRecords: ${attStats.isDisplayName} 筆需修正, ${attStats.unmapped} 筆無法映射`);
  console.log(`activityRecords:   ${actStats.isDisplayName} 筆需修正, ${actStats.unmapped} 筆無法映射`);
  console.log(`合計需修正: ${attStats.isDisplayName + actStats.isDisplayName} 筆`);
  console.log(`合計無法映射: ${attStats.unmapped + actStats.unmapped} 筆`);
  console.log('='.repeat(50));
  if (attStats.isDisplayName + actStats.isDisplayName === 0) {
    console.log('所有 UID 欄位均正確，無需遷移。');
  } else {
    console.log('建議執行 UID 欄位遷移（Phase 2 Cloud Function）。');
  }
  console.groupEnd();

  return {
    attendanceRecords: attStats,
    activityRecords: actStats,
    userCount: users.length,
    validUidCount: validUids.size,
    nameMapCount: nameToUid.size,
  };
})();
