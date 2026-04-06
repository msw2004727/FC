(function() {
  // 模擬 _toMs
  function toMs(v) {
    if (!v) return 0;
    if (typeof v === 'number') return v;
    if (typeof v.toMillis === 'function') { try { return v.toMillis(); } catch(e) {} }
    if (typeof v.toDate === 'function') { try { return v.toDate().getTime(); } catch(e) {} }
    if (typeof v === 'object') {
      var s = v.seconds || v._seconds;
      if (typeof s === 'number') return (s * 1000) + Math.floor(((v.nanoseconds || v._nanoseconds || 0) / 1000000));
    }
    var t = new Date(v).getTime();
    return isFinite(t) ? t : 0;
  }

  // 測試 operation log
  var logs = ApiService.getOperationLogs();
  var sample = null;
  for (var i = 0; i < logs.length; i++) {
    if (logs[i].type === 'auto_promote') { sample = logs[i]; break; }
  }
  var msg = '';
  if (sample) {
    var ms1 = toMs(sample.createdAt);
    var docMatch = String(sample._docId || '').match(/op_(\d{13,})/);
    var ms2 = docMatch ? Number(docMatch[1]) : 0;
    msg += 'opLog ms via createdAt: ' + ms1 + '\n';
    msg += 'opLog ms via _docId: ' + ms2 + '\n';
    msg += 'date: ' + new Date(ms1 || ms2) + '\n\n';
  } else {
    msg += 'no auto_promote found\n\n';
  }

  // 測試 registration（用 Firestore 查的那場活動）
  var regs = ApiService._src('registrations');
  if (regs.length > 0) {
    var ms3 = toMs(regs[0].registeredAt);
    msg += 'reg[0] ms: ' + ms3 + '\n';
    msg += 'date: ' + new Date(ms3) + '\n';
    msg += 'type of registeredAt: ' + typeof regs[0].registeredAt + '\n';
    if (typeof regs[0].registeredAt === 'string') {
      msg += 'value: ' + regs[0].registeredAt.substring(0, 30) + '\n';
    }
  } else {
    msg += 'no registrations in cache\n';
  }

  alert(msg);
})();
