/**
 * SportHub 報名系統一致性驗證腳本
 * 使用方式：在瀏覽器 console 中貼上並執行（需以 super_admin 登入正式版）
 *
 * 檢查項目：
 * 1. event.current 與實際 confirmed registrations 數量是否一致
 * 2. event.waitlist 與實際 waitlisted registrations 數量是否一致
 * 3. 是否有超收（confirmed > max）
 * 4. 是否有重複報名（同 userId+eventId 多筆 active）
 * 5. event.status 與 current/max 是否一致
 * 6. 候補順序是否正確（registeredAt 排序）
 */
(function runRegistrationIntegrityCheck() {
  console.log('%c=== 報名系統一致性驗證 ===', 'color:#2563eb;font-size:14px;font-weight:bold');

  var events = FirebaseService._cache.events || [];
  var regs = FirebaseService._cache.registrations || [];
  var issues = [];

  // --- 1. current / waitlist 一致性 ---
  console.log('\n%c[1] event.current / event.waitlist 一致性', 'color:#d97706;font-weight:bold');
  var currentMismatch = [];
  events.forEach(function(e) {
    var confirmed = regs.filter(function(r) {
      return r.eventId === e.id && r.status === 'confirmed';
    }).length;
    var waitlisted = regs.filter(function(r) {
      return r.eventId === e.id && r.status === 'waitlisted';
    }).length;
    if (e.current !== confirmed || (e.waitlist || 0) !== waitlisted) {
      currentMismatch.push({
        title: e.title,
        id: e.id,
        'e.current': e.current,
        actualConfirmed: confirmed,
        'e.waitlist': e.waitlist || 0,
        actualWaitlisted: waitlisted
      });
    }
  });
  if (currentMismatch.length > 0) {
    console.warn('found ' + currentMismatch.length + ' events with mismatched counts:');
    console.table(currentMismatch);
    issues.push({ type: 'current/waitlist mismatch', count: currentMismatch.length, detail: currentMismatch });
  } else {
    console.log('OK: all events match');
  }

  // --- 2. overcapacity ---
  console.log('\n%c[2] overcapacity check (confirmed > max)', 'color:#d97706;font-weight:bold');
  var overcap = [];
  events.forEach(function(e) {
    if (!e.max || e.max <= 0) return;
    var confirmed = regs.filter(function(r) {
      return r.eventId === e.id && r.status === 'confirmed';
    }).length;
    if (confirmed > e.max) {
      overcap.push({ title: e.title, id: e.id, confirmed: confirmed, max: e.max, over: confirmed - e.max });
    }
  });
  if (overcap.length > 0) {
    console.warn('found ' + overcap.length + ' overcapacity events:');
    console.table(overcap);
    issues.push({ type: 'overcapacity', count: overcap.length, detail: overcap });
  } else {
    console.log('OK: no overcapacity');
  }

  // --- 3. duplicate registrations ---
  console.log('\n%c[3] duplicate active registrations (same userId+eventId)', 'color:#d97706;font-weight:bold');
  var regKeys = {};
  var dupes = [];
  regs.forEach(function(r) {
    if (r.status === 'cancelled' || r.status === 'removed') return;
    var key = (r.userId || '') + '::' + (r.eventId || '') + '::' + (r.participantType || 'self');
    if (r.participantType === 'companion') {
      key += '::' + (r.companionId || '');
    }
    regKeys[key] = (regKeys[key] || 0) + 1;
  });
  Object.keys(regKeys).forEach(function(key) {
    if (regKeys[key] > 1) {
      dupes.push({ key: key, count: regKeys[key] });
    }
  });
  if (dupes.length > 0) {
    console.warn('found ' + dupes.length + ' duplicate registrations:');
    console.table(dupes);
    issues.push({ type: 'duplicates', count: dupes.length, detail: dupes });
  } else {
    console.log('OK: no duplicates');
  }

  // --- 4. status consistency ---
  console.log('\n%c[4] event.status consistency', 'color:#d97706;font-weight:bold');
  var statusIssues = [];
  events.forEach(function(e) {
    if (e.status === 'ended' || e.status === 'cancelled' || e.status === 'upcoming') return;
    var confirmed = regs.filter(function(r) {
      return r.eventId === e.id && r.status === 'confirmed';
    }).length;
    var expectedStatus = (e.max > 0 && confirmed >= e.max) ? 'full' : 'open';
    if (e.status !== expectedStatus) {
      statusIssues.push({ title: e.title, id: e.id, 'e.status': e.status, expected: expectedStatus, confirmed: confirmed, max: e.max });
    }
  });
  if (statusIssues.length > 0) {
    console.warn('found ' + statusIssues.length + ' status mismatches:');
    console.table(statusIssues);
    issues.push({ type: 'status mismatch', count: statusIssues.length, detail: statusIssues });
  } else {
    console.log('OK: all statuses consistent');
  }

  // --- 5. waitlist ordering ---
  console.log('\n%c[5] waitlist ordering (registeredAt)', 'color:#d97706;font-weight:bold');
  var orderIssues = [];
  events.forEach(function(e) {
    var waitlisted = regs.filter(function(r) {
      return r.eventId === e.id && r.status === 'waitlisted';
    }).sort(function(a, b) {
      return (a.promotionOrder || 0) - (b.promotionOrder || 0);
    });
    for (var i = 1; i < waitlisted.length; i++) {
      var prev = new Date(waitlisted[i - 1].registeredAt).getTime();
      var curr = new Date(waitlisted[i].registeredAt).getTime();
      if (curr < prev) {
        orderIssues.push({
          eventTitle: e.title,
          position: i,
          laterRegisteredAt: waitlisted[i - 1].registeredAt,
          earlierRegisteredAt: waitlisted[i].registeredAt
        });
        break;
      }
    }
  });
  if (orderIssues.length > 0) {
    console.warn('found ' + orderIssues.length + ' waitlist ordering issues:');
    console.table(orderIssues);
    issues.push({ type: 'waitlist order', count: orderIssues.length, detail: orderIssues });
  } else {
    console.log('OK: waitlist ordering correct');
  }

  // --- 6. participants array vs registrations ---
  console.log('\n%c[6] participants array vs registrations sync', 'color:#d97706;font-weight:bold');
  var syncIssues = [];
  events.forEach(function(e) {
    var confirmedRegs = regs.filter(function(r) {
      return r.eventId === e.id && r.status === 'confirmed';
    });
    var regNames = confirmedRegs.map(function(r) {
      return r.participantType === 'companion' ? (r.companionName || r.userName || '') : (r.userName || '');
    }).filter(Boolean).sort();
    var partNames = (e.participants || []).slice().sort();
    if (confirmedRegs.length > 0 && regNames.join(',') !== partNames.join(',')) {
      syncIssues.push({
        title: e.title,
        id: e.id,
        regCount: regNames.length,
        partCount: partNames.length,
        regNames: regNames.join(', '),
        partNames: partNames.join(', ')
      });
    }
  });
  if (syncIssues.length > 0) {
    console.warn('found ' + syncIssues.length + ' participants array out of sync:');
    syncIssues.forEach(function(s) {
      console.log('  ' + s.title + ': regs=' + s.regCount + ' parts=' + s.partCount);
    });
    issues.push({ type: 'participants sync', count: syncIssues.length });
  } else {
    console.log('OK: participants arrays in sync');
  }

  // --- Summary ---
  console.log('\n%c=== verification complete ===', 'color:#2563eb;font-size:14px;font-weight:bold');
  if (issues.length === 0) {
    console.log('%cALL CHECKS PASSED', 'color:#15803d;font-size:13px;font-weight:bold');
  } else {
    console.warn(issues.length + ' issue types found:');
    issues.forEach(function(issue, i) {
      console.log('  ' + (i + 1) + '. ' + issue.type + ': ' + issue.count);
    });
  }

  return { issues: issues, passed: issues.length === 0 };
})();
