(function() {
  var logs = ApiService.getOperationLogs();
  var pLogs = [];
  for (var i = 0; i < logs.length; i++) {
    if (logs[i].type === 'auto_promote' || logs[i].type === 'force_promote') {
      pLogs.push(logs[i]);
    }
  }
  var msg = 'opLogs loaded: ' + logs.length + '\npromote: ' + pLogs.length + '\n\n';

  if (pLogs.length > 0) {
    var l = pLogs[0];
    msg += '_docId: ' + l._docId + '\n';
    msg += 'createdAt type: ' + typeof l.createdAt + '\n';
    if (l.createdAt && typeof l.createdAt === 'object') {
      msg += 'createdAt keys: ' + Object.keys(l.createdAt).join(',') + '\n';
      msg += 'seconds: ' + l.createdAt.seconds + '\n';
      msg += '_seconds: ' + l.createdAt._seconds + '\n';
      msg += 'toMillis: ' + typeof l.createdAt.toMillis + '\n';
    }
  }

  // 測試 registration 時間
  var regs = ApiService._src('registrations');
  if (regs.length > 0) {
    var r = regs[0];
    msg += '\n--- reg[0] ---\n';
    msg += 'registeredAt type: ' + typeof r.registeredAt + '\n';
    if (r.registeredAt && typeof r.registeredAt === 'object') {
      msg += 'keys: ' + Object.keys(r.registeredAt).join(',') + '\n';
      msg += 'toMillis: ' + typeof r.registeredAt.toMillis + '\n';
    } else {
      msg += 'value: ' + String(r.registeredAt).substring(0, 30) + '\n';
    }
  }

  alert(msg);
})();
