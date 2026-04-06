(function() {
  var p = document.querySelectorAll('.event-reg-log-action.promote').length;
  var d = document.querySelectorAll('.event-reg-log-action.demote').length;
  var body = document.getElementById('event-reg-log-body');
  var items = body ? body.children : [];
  var first = items[0] ? items[0].textContent.trim() : 'none';
  var last = items[items.length - 1] ? items[items.length - 1].textContent.trim() : 'none';
  alert(
    'promote: ' + p + '\ndemote: ' + d +
    '\ntotal: ' + items.length +
    '\n\nFIRST: ' + first +
    '\nLAST: ' + last
  );
})();
