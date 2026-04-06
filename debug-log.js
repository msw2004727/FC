(function() {
  var body = document.getElementById('event-reg-log-body');
  if (!body) { alert('Log body not found'); return; }
  var items = body.children;
  var msg = 'total: ' + items.length + '\n\n';
  for (var i = 0; i < items.length; i++) {
    var cls = items[i].querySelector('.event-reg-log-action');
    var type = cls ? cls.textContent.trim() : '?';
    var time = items[i].querySelector('.event-reg-log-time');
    var t = time ? time.textContent.trim() : '?';
    if (type !== '報名' && type !== '取消') {
      msg += '>>> [' + i + '] ' + t + ' ' + type + '\n';
    } else if (i < 3 || i > items.length - 4 || (i > 15 && i < 19)) {
      msg += '[' + i + '] ' + t + ' ' + type + '\n';
    }
  }
  alert(msg);
})();
