(function() {
  var body = document.getElementById('event-reg-log-body');
  if (!body) { alert('not found'); return; }
  var items = body.children;
  var msg = '';
  for (var i = 0; i < items.length; i++) {
    var cls = items[i].querySelector('.event-reg-log-action');
    var type = cls ? cls.textContent.trim() : '?';
    if (type !== '報名' && type !== '取消') {
      var msEl = items[i].getAttribute('data-ms');
      msg += '[' + i + '] ms=' + msEl + ' ' + type + '\n';
    }
  }
  if (!msg) msg = 'no promote/demote found';
  msg += '\n--- first 3 ---\n';
  for (var j = 0; j < 3 && j < items.length; j++) {
    msg += '[' + j + '] ms=' + items[j].getAttribute('data-ms') + '\n';
  }
  alert(msg);
})();
