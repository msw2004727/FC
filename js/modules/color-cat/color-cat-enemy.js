/* ColorCat — 敵人系統（10 種角色個性、AI 戰鬥、繪製、HP）
   精靈圖：No_Shadows + 手繪橢圓陰影，依賴：config.js, character.js */
;(function() {
var C = window.ColorCatConfig;
var SZ = 96;           // 精靈圖原始畫框
var SCALE = 1.7;       // 放大倍率（縮小 15%）
var FRAME = SZ * SCALE; // 163 完整畫框繪製尺寸
var FOOT_ROW = 82;     // 精靈圖中角色腳觸地行
var FOOT_OFFSET = 34;  // 額外下移像素
var VIS_H = 41;        // 可見角色高度（像素），用於點擊/HP 條
var VIS_W = 34;        // 可見角色寬度（像素），用於點擊/AI
var MAX_ENEMIES = 5;

var SKINS = {
  humanBow:     { folder: 'Human_Bow',                  name: '弓箭手' },
  humanMage:    { folder: 'Human_Mage',                 name: '法師' },
  humanMace:    { folder: 'Human_Soldier_Mace_Shield',   name: '錘盾兵' },
  humanPolearm: { folder: 'Human_Soldier_Polearm',       name: '長槍兵' },
  humanSword:   { folder: 'Human_Soldier_Sword_Shield',  name: '劍盾兵' },
  goblinBow:    { folder: 'Monster_Goblin_Bow',          name: '哥布林弓手' },
  orcAxe:       { folder: 'Monster_Orc_Axe',             name: '獸人斧手' },
  orcFist:      { folder: 'Monster_Orc_Fist',            name: '獸人拳手' },
  orcShield:    { folder: 'Monster_Orc_Shield',           name: '獸人盾兵' },
  slime:        { folder: 'Monster_Slime',                name: '史萊姆' },
};

var ACTIONS = {
  idle:      { suffix: 'Idle',      frames: 6,  speed: 0.12, type: 'loop', label: '待機' },
  walk:      { suffix: 'Walk',      frames: 8,  speed: 0.15, type: 'move', label: '巡邏/追蹤' },
  attack1:   { suffix: 'Attack1',   frames: 8,  speed: 0.20, type: 'once', label: '普攻' },
  attack2:   { suffix: 'Attack2',   frames: 8,  speed: 0.20, type: 'once', label: '重擊' },
  block:     { suffix: 'Block',     frames: 6,  speed: 0.15, type: 'once', label: '格擋' },
  hurt:      { suffix: 'Hurt',      frames: 4,  speed: 0.15, type: 'once', label: '受傷' },
  death:     { suffix: 'Death',     frames: 10, speed: 0.12, type: 'once', label: '死亡' },
  jump_fall: { suffix: 'Jump_Fall', frames: 6,  speed: 0.15, type: 'once', label: '跳躍' },
};

// ── 角色個性檔案 ──
// w = [attack1%, attack2%, block%, jump%]
var PROFILES = {
  humanBow:     { hp: 80,  spd: 1.5, cdMin: 20, cdMax: 50, dmg1: 8,  dmg2: 12, w: [60,20,5,15], ranged: true, projType: 'arrow' },
  humanMage:    { hp: 70,  spd: 0.8, cdMin: 40, cdMax: 80, dmg1: 12, dmg2: 20, w: [30,50,10,10], ranged: true, projType: 'magic' },
  humanMace:    { hp: 120, spd: 0.9, cdMin: 25, cdMax: 55, dmg1: 10, dmg2: 14, w: [25,25,40,10] },
  humanPolearm: { hp: 100, spd: 1.1, cdMin: 15, cdMax: 40, dmg1: 12, dmg2: 16, w: [50,30,10,10] },
  humanSword:   { hp: 110, spd: 1.2, cdMin: 20, cdMax: 45, dmg1: 10, dmg2: 15, w: [35,25,25,15] },
  goblinBow:    { hp: 60,  spd: 1.8, cdMin: 10, cdMax: 25, dmg1: 6,  dmg2: 10, w: [40,15,5,40], ranged: true, projType: 'arrow' },
  orcAxe:       { hp: 100, spd: 1.2, cdMin: 15, cdMax: 30, dmg1: 14, dmg2: 18, w: [45,45,0,10] },
  orcFist:      { hp: 90,  spd: 1.5, cdMin: 10, cdMax: 20, dmg1: 8,  dmg2: 12, w: [55,30,5,10] },
  orcShield:    { hp: 150, spd: 0.7, cdMin: 30, cdMax: 60, dmg1: 8,  dmg2: 12, w: [20,15,55,10] },
  slime:        { hp: 80,  spd: 0.8, cdMin: 20, cdMax: 50, dmg1: 5,  dmg2: 8,  w: [30,20,10,40] },
};

function spritePath(skinKey, actionKey) {
  var s = SKINS[skinKey], a = ACTIONS[actionKey];
  return s && a ? 'img/sprites/' + s.folder + '/No_Shadows/' + s.folder + '_' + a.suffix + '-Sheet.png' : '';
}

var _cache = {};
function loadSprites(skinKey, cb) {
  if (_cache[skinKey]) { if (cb) cb(); return; }
  _cache[skinKey] = {};
  var keys = Object.keys(ACTIONS), loaded = 0, total = keys.length;
  keys.forEach(function(ak) {
    var img = new Image();
    img.onload = img.onerror = function() {
      _cache[skinKey][ak] = img; loaded++;
      if (loaded === total && cb) cb();
    };
    img.src = spritePath(skinKey, ak);
  });
}

var enemies = [];
var _dust = [];
function spawnDust(x, y) {
  for (var i = 0; i < 30; i++) {
    var dir = i < 15 ? -1 : 1, sp = 1.5 + Math.random() * 4;
    var life = 20 + Math.floor(Math.random() * 15);
    _dust.push({ x: x + (Math.random()-0.5)*8, y: y - Math.random()*4,
      vx: dir*sp, vy: -(0.5+Math.random()*2), life: life, maxLife: life,
      size: 2+Math.random()*4 });
  }
}
function updateDust() {
  for (var i = _dust.length-1; i >= 0; i--) {
    var d = _dust[i]; d.x += d.vx; d.y += d.vy;
    d.vx *= 0.93; d.vy += 0.05; d.life--;
    if (d.life <= 0) _dust.splice(i, 1);
  }
}

function spawn(skinKey, sw) {
  if (!SKINS[skinKey] || enemies.length >= MAX_ENEMIES) return;
  var p = PROFILES[skinKey]; if (!p) return;
  loadSprites(skinKey, function() {
    var margin = VIS_W;
    var rx = margin + Math.random() * (sw - margin * 2);
    enemies.push({
      skin: skinKey, x: rx, y: -60,
      facing: Math.random() < 0.5 ? -1 : 1, action: 'falling',
      sf: 0, st: 0, fallVy: 2,
      hp: p.hp, maxHp: p.hp,
      aiTimer: 0, aiCD: p.cdMin + Math.floor(Math.random() * (p.cdMax - p.cdMin)),
      atkHit: false, blocking: false,
      dead: false, deathTimer: 0, fadeAlpha: 1,
      inKnockback: false, knockVx: 0, knockVy: 0,
    });
  });
}

function advanceSprite(e) {
  // 墜落中：從天空掉落
  if (e.action === 'falling') {
    var jf = ACTIONS.jump_fall;
    e.st += jf.speed;
    if (e.st >= 1) { e.st -= 1; e.sf = (e.sf + 1) % jf.frames; }
    e.fallVy = (e.fallVy || 2) + 0.3;
    e.y += e.fallVy;
    if (e.y >= C.CHAR_GROUND_Y) {
      e.y = C.CHAR_GROUND_Y; spawnDust(e.x, C.GROUND_Y + 12);
      e.action = 'spawning'; e.sf = ACTIONS.death.frames - 1; e.st = 0;
    }
    return;
  }
  // 召喚中：2倍速倒轉播放死亡動畫
  if (e.action === 'spawning') {
    var da = ACTIONS.death;
    e.st += da.speed * 2;
    if (e.st >= 1) {
      e.st -= 1; e.sf--;
      if (e.sf <= 0) {
        e.sf = 0; e.action = 'idle'; e.st = 0;
        var p = PROFILES[e.skin];
        e.aiTimer = 0; e.aiCD = p.cdMin + Math.floor(Math.random() * (p.cdMax - p.cdMin));
      }
    }
    return;
  }
  var ad = ACTIONS[e.action]; if (!ad) return;
  e.st += ad.speed;
  if (e.st >= 1) {
    e.st -= 1; e.sf++;
    if (e.sf >= ad.frames) {
      if (e.dead) { e.sf = ad.frames - 1; return; }
      if (ad.type === 'once') {
        var wasHurt = e.action === 'hurt';
        e.blocking = (e.action === 'block');
        e.action = 'idle'; e.sf = 0; e.st = 0;
        var p = PROFILES[e.skin];
        // 受傷後快速反擊（短冷卻），其他動作正常冷卻
        e.aiTimer = 0;
        e.aiCD = wasHurt ? Math.floor(p.cdMin * 0.3) : p.cdMin + Math.floor(Math.random() * (p.cdMax - p.cdMin));
      } else { e.sf = 0; }
    }
  }
}

function chooseAction(e, p) {
  var w = p.w, wt = w[0]+w[1]+w[2]+w[3], roll = Math.random() * wt;
  if (roll < w[0]) { e.action = 'attack1'; }
  else if (roll < w[0]+w[1]) { e.action = 'attack2'; }
  else if (roll < w[0]+w[1]+w[2]) { e.action = 'block'; e.blocking = true; }
  else { e.action = 'jump_fall'; }
  e.sf = 0; e.st = 0; e.atkHit = false;
}

function clampX(e, sw) {
  if (e.x < VIS_W / 2) e.x = VIS_W / 2;
  if (e.x > sw - VIS_W / 2) e.x = sw - VIS_W / 2;
}

// ── AI + 更新 ──
function updateAll(sw) {
  updateDust();
  var ch = ColorCatCharacter.state;
  var charDying = ch.action === 'dying' || ch.action === 'weak' || ch.action === 'sleeping';

  for (var i = enemies.length - 1; i >= 0; i--) {
    var e = enemies[i];
    advanceSprite(e);

    // 死亡：停留 → 淡出 → 移除
    if (e.dead) {
      e.deathTimer++;
      if (e.deathTimer >= 90) {
        e.fadeAlpha = Math.max(0, 1 - (e.deathTimer - 90) / 30);
        if (e.fadeAlpha <= 0) { enemies.splice(i, 1); }
      }
      continue;
    }
    // 面板彈飛拋物線
    if (e.inKnockback) {
      e.x += e.knockVx; e.knockVy += 0.25; e.y += e.knockVy;
      if (e.y >= C.CHAR_GROUND_Y) {
        e.y = C.CHAR_GROUND_Y; e.inKnockback = false;
        spawnDust(e.x, C.GROUND_Y + 12);
        e.action = 'idle'; e.sf = 0; e.st = 0;
        var p = PROFILES[e.skin];
        e.aiTimer = 0; e.aiCD = p.cdMin + Math.floor(Math.random() * (p.cdMax - p.cdMin));
      }
      continue;
    }
    if (e.action === 'falling' || e.action === 'spawning' || e.action === 'hurt' || e.action === 'jump_fall') continue;
    if (e.action === 'block') continue;
    if (e.action === 'attack1' || e.action === 'attack2') {
      if (!e.atkHit && e.sf >= 4) {
        e.atkHit = true;
        var p = PROFILES[e.skin];
        var dmg = e.action === 'attack1' ? p.dmg1 : p.dmg2;
        if (p.ranged) {
          // 遠程：發射投射物
          if (window.ColorCatEnemy.spawnProjectile) {
            window.ColorCatEnemy.spawnProjectile(e, dmg);
          }
        } else {
          // 近戰
          if (Math.abs(ch.x - e.x) < VIS_W && !charDying) {
            ColorCatCharacter.takeDamage(dmg);
          }
        }
      }
      continue;
    }

    // 入場：走入畫面
    if (e.x < 10) { e.x += 2; e.facing = 1; e.action = 'walk'; continue; }
    if (e.x > sw - 10) { e.x -= 2; e.facing = -1; e.action = 'walk'; continue; }

    if (e.action === 'idle') {
      e.aiTimer++;
      if (e.aiTimer >= e.aiCD) {
        e.aiTimer = 0;
        e.action = 'walk'; e.sf = 0; e.st = 0;
      }
    } else if (e.action === 'walk') {
      var p = PROFILES[e.skin];
      if (charDying) {
        e.x += e.facing * p.spd * 0.5;
        if (e.x < 30 || e.x > sw - 30) e.facing *= -1;
        e.aiTimer++;
        if (e.aiTimer > 90) { e.action = 'idle'; e.sf = 0; e.st = 0; e.aiTimer = 0; }
      } else if (p.ranged) {
        // 遠程 AI：保持在 80~235px 射程帶（命中率 ≥50%）
        var dx = ch.x - e.x;
        var dist = Math.abs(dx);
        e.facing = dx > 0 ? 1 : -1;
        if (dist < 80) {
          // 太近：快速逃離
          e.x += (dx > 0 ? -1 : 1) * p.spd * 1.5;
          clampX(e, sw);
        } else if (dist > 235) {
          // 太遠：跑向主角至射程內
          e.x += e.facing * p.spd;
          clampX(e, sw);
        } else {
          // 理想距離：選擇動作攻擊
          chooseAction(e, p);
        }
      } else {
        var dx = ch.x - e.x;
        if (e.skin === 'slime' && Math.random() < 0.5) {
          e.facing = Math.random() < 0.5 ? 1 : -1;
        } else {
          e.facing = dx > 0 ? 1 : -1;
        }
        if (Math.abs(dx) > VIS_W * 0.6) {
          e.x += e.facing * p.spd; clampX(e, sw);
        } else {
          chooseAction(e, p);
        }
      }
    }
  }
}

// ── 公開 API（戰鬥工具函式由 enemy-util.js 覆蓋） ──
window.ColorCatEnemy = {
  SKINS: SKINS, ACTIONS: ACTIONS, PROFILES: PROFILES,
  SZ: SZ, SCALE: SCALE, FRAME: FRAME, FOOT_ROW: FOOT_ROW, FOOT_OFFSET: FOOT_OFFSET,
  VIS_W: VIS_W, VIS_H: VIS_H, _cache: _cache,
  spawn: spawn, update: updateAll,
  draw: function() {}, drawBoxShadows: function() {},
  getClicked: function() { return -1; },
  getInRange: function() { return []; },
  dealDamage: function() {},
  getAll: function() { return enemies; },
  getDust: function() { return _dust; },
  findNearest: function() { return -1; },
  hasAlive: function() { return false; },
  knockback: function() {},
  clearAll: function() { enemies.length = 0; _dust.length = 0; },
  spawnProjectile: function() {},
  updateProjectiles: function() {},
  drawProjectiles: function() {},
  testAction: function(idx, act) {
    var e = enemies[idx]; if (!e || e.dead) return;
    e.action = act; e.sf = 0; e.st = 0;
  },
};

})();
