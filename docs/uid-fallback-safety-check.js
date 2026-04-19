/**
 * UID Fallback 移除安全檢查腳本
 * 目的：驗證是否可以安全移除 scan-process.js / event-manage-attendance.js 中的 userName fallback
 *
 * 使用方式：在瀏覽器 console 中貼上並執行（需以 super_admin 登入正式版）
 *
 * 檢查項目：
 * 1. 所有 registrations 是否都有 userId（子集合 collectionGroup）
 * 2. 所有 attendanceRecords 是否都有 uid
 * 3. 所有 activityRecords 是否都有 uid
 * 4. 是否有同活動內同 userName 不同 userId 的情境（這是「同暱稱互相干擾」的實際樣本）
 * 5. event.participants[] 字串陣列是否還在使用（影響 _buildConfirmedParticipantSummary fallback）
 *
 * 決策輸出：最後會印出 "SAFE TO REMOVE FALLBACK" 或 "NOT SAFE"
 */
(async function runUidFallbackSafetyCheck() {
  console.log('%c=== UID Fallback 移除安全檢查 ===', 'color:#2563eb;font-size:14px;font-weight:bold');
  var blockers = [];

  // 工具：子集合 collectionGroup 去重（過濾掉可能殘留的根集合舊資料）
  async function loadSubcollection(name) {
    var snap = await db.collectionGroup(name).get();
    return snap.docs
      .filter(function (d) { return d.ref.parent.parent !== null; })
      .map(function (d) { return Object.assign({}, d.data(), { _docId: d.id, _path: d.ref.path }); });
  }

  // --- 1. registrations.userId ---
  console.log('\n%c[1] registrations.userId 完整性', 'color:#d97706;font-weight:bold');
  var regs = await loadSubcollection('registrations');
  var regsMissingUid = regs.filter(function (r) { return !r.userId; });
  console.log('  total: ' + regs.length + ', missing userId: ' + regsMissingUid.length);
  if (regsMissingUid.length > 0) {
    console.warn('  sample (first 10):');
    console.table(regsMissingUid.slice(0, 10).map(function (r) {
      return { userName: r.userName, status: r.status, eventId: r.eventId, _path: r._path };
    }));
    blockers.push('registrations 缺 userId: ' + regsMissingUid.length + ' 筆');
  } else {
    console.log('  %cOK: 所有 registrations 都有 userId', 'color:#16a34a');
  }

  // --- 2. attendanceRecords.uid ---
  console.log('\n%c[2] attendanceRecords.uid 完整性', 'color:#d97706;font-weight:bold');
  var atts = await loadSubcollection('attendanceRecords');
  var attsMissingUid = atts.filter(function (a) { return !a.uid; });
  console.log('  total: ' + atts.length + ', missing uid: ' + attsMissingUid.length);
  if (attsMissingUid.length > 0) {
    console.warn('  sample (first 10):');
    console.table(attsMissingUid.slice(0, 10).map(function (a) {
      return { userName: a.userName, type: a.type, eventId: a.eventId, _path: a._path };
    }));
    blockers.push('attendanceRecords 缺 uid: ' + attsMissingUid.length + ' 筆');
  } else {
    console.log('  %cOK: 所有 attendanceRecords 都有 uid', 'color:#16a34a');
  }

  // --- 3. activityRecords.uid ---
  console.log('\n%c[3] activityRecords.uid 完整性', 'color:#d97706;font-weight:bold');
  var acts = await loadSubcollection('activityRecords');
  var actsMissingUid = acts.filter(function (a) { return !a.uid; });
  console.log('  total: ' + acts.length + ', missing uid: ' + actsMissingUid.length);
  if (actsMissingUid.length > 0) {
    console.warn('  sample (first 10):');
    console.table(actsMissingUid.slice(0, 10).map(function (a) {
      return { userName: a.userName, type: a.type, eventId: a.eventId, _path: a._path };
    }));
    blockers.push('activityRecords 缺 uid: ' + actsMissingUid.length + ' 筆');
  } else {
    console.log('  %cOK: 所有 activityRecords 都有 uid', 'color:#16a34a');
  }

  // --- 4. 同活動內同 userName 不同 userId（實際干擾樣本）---
  console.log('\n%c[4] 同活動同 userName 不同 userId（同暱稱干擾樣本）', 'color:#d97706;font-weight:bold');
  var dupByEvent = {};
  regs.forEach(function (r) {
    if (!r.userId || !r.userName || r.status === 'cancelled' || r.status === 'removed') return;
    if (r.participantType === 'companion') return;
    var key = r.eventId + '|' + r.userName;
    if (!dupByEvent[key]) dupByEvent[key] = new Set();
    dupByEvent[key].add(r.userId);
  });
  var dupSamples = [];
  Object.keys(dupByEvent).forEach(function (key) {
    if (dupByEvent[key].size > 1) {
      var parts = key.split('|');
      dupSamples.push({
        eventId: parts[0],
        userName: parts[1],
        distinctUids: Array.from(dupByEvent[key]).join(', ')
      });
    }
  });
  if (dupSamples.length > 0) {
    console.warn('  found ' + dupSamples.length + ' 組同活動同暱稱不同 UID：');
    console.table(dupSamples.slice(0, 20));
    console.log('  （這就是同暱稱干擾的實際發生案例；移除 fallback 可徹底解決）');
  } else {
    console.log('  目前資料庫尚無同活動同暱稱樣本，但不代表未來不會發生');
  }

  // --- 5. event.participants[] 使用狀況 ---
  console.log('\n%c[5] event.participants[] 字串陣列（影響 _buildConfirmedParticipantSummary fallback）', 'color:#d97706;font-weight:bold');
  var events = FirebaseService._cache.events || [];
  var eventsWithParticipants = events.filter(function (e) {
    return Array.isArray(e.participants) && e.participants.length > 0;
  });
  console.log('  events 總數: ' + events.length + ', 含 participants[] 的活動: ' + eventsWithParticipants.length);
  if (eventsWithParticipants.length > 0) {
    console.log('  sample (first 5):');
    console.table(eventsWithParticipants.slice(0, 5).map(function (e) {
      return { title: e.title, id: e.id, status: e.status, participantsCount: e.participants.length };
    }));
    console.log('  注意：此欄位仍在使用，_buildConfirmedParticipantSummary 的 fallback 暫時不能移除');
  } else {
    console.log('  %cOK: event.participants[] 已無活躍活動使用', 'color:#16a34a');
  }

  // --- 決策輸出 ---
  console.log('\n%c=== 決策 ===', 'color:#2563eb;font-size:14px;font-weight:bold');
  var scanFallbackSafe = regsMissingUid.length === 0;
  var attMatcherSafe = regsMissingUid.length === 0 && attsMissingUid.length === 0;
  var summaryFallbackSafe = eventsWithParticipants.length === 0;

  console.log('  scan-process.js:59 fallback 可移除：' + (scanFallbackSafe ? '%cYES' : '%cNO'),
    scanFallbackSafe ? 'color:#16a34a;font-weight:bold' : 'color:#dc2626;font-weight:bold');
  console.log('  event-manage-attendance.js:51 fallback 可移除：' + (attMatcherSafe ? '%cYES' : '%cNO'),
    attMatcherSafe ? 'color:#16a34a;font-weight:bold' : 'color:#dc2626;font-weight:bold');
  console.log('  event-manage-noshow.js:64-70 fallback 可移除：' + (summaryFallbackSafe ? '%cYES' : '%cNO'),
    summaryFallbackSafe ? 'color:#16a34a;font-weight:bold' : 'color:#dc2626;font-weight:bold');

  if (blockers.length > 0) {
    console.warn('\n  blockers:');
    blockers.forEach(function (b) { console.warn('    - ' + b); });
  }
  console.log('\n  同活動同暱稱實際案例數：' + dupSamples.length);
  return {
    registrations: { total: regs.length, missingUid: regsMissingUid.length },
    attendanceRecords: { total: atts.length, missingUid: attsMissingUid.length },
    activityRecords: { total: acts.length, missingUid: actsMissingUid.length },
    duplicateUserNameCases: dupSamples.length,
    eventsWithParticipantsArray: eventsWithParticipants.length,
    verdict: {
      scanFallbackSafe: scanFallbackSafe,
      attMatcherSafe: attMatcherSafe,
      summaryFallbackSafe: summaryFallbackSafe
    }
  };
})();
