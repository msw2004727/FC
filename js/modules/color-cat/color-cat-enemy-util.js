/* ColorCat — 敵人戰鬥工具函式（點擊判定、受傷、搜尋、擊退）
   依賴：color-cat-enemy.js */
;(function() {
var E = window.ColorCatEnemy;
var VIS_W = E.VIS_W, VIS_H = E.VIS_H;

function getClicked(cx, cy) {
  var all = E.getAll();
  for (var i = all.length - 1; i >= 0; i--) {
    var e = all[i]; if (e.dead || e.action === 'falling' || e.action === 'spawning') continue;
    var hw = VIS_W / 2;
    if (cx >= e.x - hw && cx <= e.x + hw && cy >= e.y - VIS_H && cy <= e.y) return i;
  }
  return -1;
}

function getInRange(left, right) {
  var all = E.getAll(), r = [];
  for (var i = 0; i < all.length; i++) {
    var e = all[i]; if (e.dead || e.action === 'falling' || e.action === 'spawning') continue;
    if (e.x >= left && e.x <= right) r.push(i);
  }
  return r;
}

function dealDamage(idx, dmg) {
  var e = E.getAll()[idx]; if (!e || e.dead) return;
  if (e.action === 'falling' || e.action === 'spawning') return;
  var actualDmg = (e.action === 'block' || e.blocking) ? Math.floor(dmg * 0.5) : dmg;
  e.blocking = false;
  e.hp = Math.max(0, e.hp - actualDmg);
  // 飄字
  if (window.ColorCatDamageNumber) {
    window.ColorCatDamageNumber.spawn(e.x, e.y - E.VIS_H, actualDmg, '#FFDD33');
  }
  if (e.hp <= 0) {
    e.dead = true; e.action = 'death'; e.sf = 0; e.st = 0; e.deathTimer = 0;
  } else {
    e.action = 'hurt'; e.sf = 0; e.st = 0;
  }
}

function findNearest(charX) {
  var all = E.getAll(), best = -1, bestD = Infinity;
  for (var i = 0; i < all.length; i++) {
    if (all[i].dead) continue;
    var d = Math.abs(all[i].x - charX);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

function knockbackEnemy(idx) {
  var e = E.getAll()[idx];
  if (!e || e.dead || e.action === 'falling' || e.action === 'spawning' || e.inKnockback) return;
  e.action = 'jump_fall'; e.sf = 0; e.st = 0;
  e.inKnockback = true;
  e.knockVx = -(3 + Math.random() * 2);
  e.knockVy = -(3.5 + Math.random() * 2);
}

function hasAlive() {
  var all = E.getAll();
  for (var i = 0; i < all.length; i++) {
    if (!all[i].dead) return true;
  }
  return false;
}

// ── 濃霧驚嚇：所有活著的敵人冒驚嘆號後往右跑出場景 ──
function scareAll() {
  var all = E.getAll();
  for (var i = 0; i < all.length; i++) {
    var e = all[i];
    if (e.dead || e.action === 'falling' || e.action === 'spawning') continue;
    e.action = 'walk'; e.sf = 0; e.st = 0;
    e.facing = 1;
    e.scared = true;
    e.scaredTimer = 25;  // 驚嘆號顯示幀數
  }
}

// 覆蓋 stub
E.getClicked = getClicked;
E.getInRange = getInRange;
E.dealDamage = dealDamage;
E.findNearest = findNearest;
E.hasAlive = hasAlive;
E.knockback = knockbackEnemy;
E.scareAll = scareAll;

})();
