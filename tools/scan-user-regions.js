/* 用戶地區掃描腳本 — 在 toosterx.com console 執行：
   fetch('/tools/scan-user-regions.js').then(r=>r.text()).then(eval)
*/
(async function scanRegions() {
  var TW = [
    '\u53F0\u5317\u5E02','\u65B0\u5317\u5E02','\u57FA\u9686\u5E02','\u6843\u5712\u5E02',
    '\u65B0\u7AF9\u5E02','\u65B0\u7AF9\u7E23','\u82D7\u6817\u7E23','\u53F0\u4E2D\u5E02',
    '\u5F70\u5316\u7E23','\u5357\u6295\u7E23','\u96F2\u6797\u7E23','\u5609\u7FA9\u5E02',
    '\u5609\u7FA9\u7E23','\u53F0\u5357\u5E02','\u9AD8\u96C4\u5E02','\u5C4F\u6771\u7E23',
    '\u5B9C\u862D\u7E23','\u82B1\u84EE\u7E23','\u53F0\u6771\u7E23','\u6F8E\u6E56\u7E23',
    '\u91D1\u9580\u7E23','\u9023\u6C5F\u7E23'
  ];
  var snap = await firebase.firestore().collection('users').get();
  var empty = [], invalid = [], valid = [];
  snap.forEach(function(doc) {
    var d = doc.data();
    var name = d.displayName || d.name || doc.id;
    var region = (d.region || '').trim();
    if (!region) { empty.push(name); }
    else if (TW.indexOf(region) === -1) { invalid.push({name: name, region: region}); }
    else { valid.push(name); }
  });
  console.log('%c=== 總用戶：' + snap.size, 'font-weight:bold;font-size:14px');
  console.log('%c已填有效地區：' + valid.length, 'color:green;font-weight:bold');
  console.log('%c未填地區：' + empty.length, 'color:orange;font-weight:bold');
  empty.forEach(function(n) { console.log('  - ' + n); });
  console.log('%c非法地區值：' + invalid.length, 'color:red;font-weight:bold');
  invalid.forEach(function(i) { console.log('  - ' + i.name + ' \u2192 \u300C' + i.region + '\u300D'); });
})();
