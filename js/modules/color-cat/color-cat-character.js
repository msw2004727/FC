/* ================================================
   ColorCat — 角色 AI 行為與狀態
   負責：角色狀態、追球/踢球/idle AI、測試模式、動畫 frame 推進
   依賴：color-cat-config.js (ColorCatConfig), color-cat-sprite.js (ColorCatSprite)
   ================================================ */
;(function() {

var C = window.ColorCatConfig;

// ── 角色狀態 ──
var character = {
  x: 0,
  y: C.CHAR_GROUND_Y,
  vy: 0,
  speed: 2.5,
  facing: 1,       // 1=右, -1=左
  action: 'idle',  // idle / chase / kick / test / goToBox / sleeping / dash / jumpOff / biteBall
  actionFrame: 0,
  spriteFrame: 0,
  spriteTimer: 0,
  onGround: true,
};

// ── 測試模式 ──
var testMode = null;

// ── 初始化 ──
function initCharacter(sceneWidth) {
  character.x = sceneWidth * 0.35;
  character.y = C.CHAR_GROUND_Y;
  character.vy = 0;
  character.action = 'idle';
  character.onGround = true;
  character.spriteFrame = 0;
  character.spriteTimer = 0;
  _stamina = _staminaMax;
  _weakLevel = 0;
  ColorCatSprite.init();
  aiResetCooldown();
}

// ── 紙箱目標位置 ──
var _boxTargetX = 0;

// ── 短跑目標位置 ──
var _dashTargetX = 0;

// ── 連續動作（combo） ──
var _comboType = '';        // 'wall' 或 'box'
var _comboStep = -1;
var _comboTimer = 0;
var _comboSceneW = 0;
var _comboBoxInfo = null;   // { x, topY, halfW } 紙箱資訊
var _boxJumpsLeft = 0;      // 紙箱上原地跳躍剩餘次數
var _pendingGoToBox = 0;    // jumpOff 後要去紙箱的目標 X（0=無）
var _suppressGroundShadow = false; // 場景控制：紙箱重疊時隱藏地面影子

// ── 咬球跑 ──
var _biteBallPhase = 0;     // 0=跑向球, 1=咬住跑, 2=放下
var _biteBallTimer = 0;
var _biteBallTargetX = 0;   // 咬球後跑去的目標

// ── 體力系統 ──
var _stamina = 100;          // 0~100
var _staminaMax = 100;
// 每 frame 消耗 / 恢復量（@30fps）
var STAMINA_DRAIN    = 0.18; // 運動時消耗
var STAMINA_REGEN_SLEEP = 0.35; // 睡覺恢復（最快）
var STAMINA_REGEN_IDLE  = 0.15; // 待機/站著
var STAMINA_REGEN_WEAK  = 0.10; // 虛弱喘氣
var STAMINA_REGEN_WALK  = 0.05; // 散步（goToBox）

// ── 自主 AI ──
var _aiTimer = 0;
var _aiCooldown = 0;         // 下次行動前等待的 frame 數
var _aiSceneInfo = null;     // { sw, boxX, boxTopY, boxW, openingX }

function aiSetSceneInfo(info) { _aiSceneInfo = info; }

// ── 體力更新 ──
function updateStamina() {
  var act = character.action;
  // 消耗型動作
  var draining = (act === 'chase' || act === 'kick' || act === 'dash' ||
                  act === 'biteBall' || act === 'jumpOff' ||
                  (act === 'combo') ||
                  (act === 'test' && testMode));
  // 散步（走向紙箱）
  var walking = (act === 'goToBox');

  if (draining) {
    _stamina = Math.max(0, _stamina - STAMINA_DRAIN);
  } else if (act === 'sleeping') {
    _stamina = Math.min(_staminaMax, _stamina + STAMINA_REGEN_SLEEP);
  } else if (act === 'weak') {
    _stamina = Math.min(_staminaMax, _stamina + STAMINA_REGEN_WEAK);
  } else if (walking) {
    _stamina = Math.min(_staminaMax, _stamina + STAMINA_REGEN_WALK);
  } else {
    // idle / 站著
    _stamina = Math.min(_staminaMax, _stamina + STAMINA_REGEN_IDLE);
  }

  // 虛弱觸發（體力 < 40%）— 但不中斷 sleeping
  var pct = _stamina / _staminaMax * 100;
  if (act !== 'sleeping' && act !== 'weak' && act !== 'goToBox') {
    if (pct <= 20) {
      // 虛弱等級 2：原地喘氣到全滿
      releaseBall();
      if (act === 'combo') endCombo();
      _weakLevel = 2;
      character.action = 'weak';
      character.y = C.CHAR_GROUND_Y;
      character.onGround = true;
      character.spriteFrame = 0;
      character.spriteTimer = 0;
    } else if (pct <= 30) {
      // 虛弱等級 1
      releaseBall();
      if (act === 'combo') endCombo();
      _weakLevel = 1;
      character.action = 'weak';
      character.y = C.CHAR_GROUND_Y;
      character.onGround = true;
      character.spriteFrame = 0;
      character.spriteTimer = 0;
    }
  }

  // 虛弱2：必須全滿才能恢復
  if (act === 'weak' && _weakLevel === 2) {
    if (_stamina >= _staminaMax) {
      _weakLevel = 0;
      character.action = 'idle';
      character.spriteFrame = 0;
      character.spriteTimer = 0;
      aiResetCooldown();
    }
    return; // 虛弱2 鎖定不做其他事
  }

  // 虛弱1：體力回到 40% 以上恢復
  if (act === 'weak' && _weakLevel === 1) {
    if (pct > 40) {
      _weakLevel = 0;
      character.action = 'idle';
      character.spriteFrame = 0;
      character.spriteTimer = 0;
      aiResetCooldown();
    }
  }
}

// ── 繪製體力條 ──
function drawStaminaBar(ctx) {
  if (character.action === 'sleeping') return;
  var barW = 24;
  var barH = 3;
  var bx = character.x - barW / 2;
  var by = character.y - C.SPRITE_DRAW + 4;
  var pct = _stamina / _staminaMax;

  // 背景
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(bx - 0.5, by - 0.5, barW + 1, barH + 1);

  // 體力條顏色：綠→黃→紅
  var r, g;
  if (pct > 0.5) { r = Math.floor((1 - pct) * 2 * 255); g = 200; }
  else { r = 255; g = Math.floor(pct * 2 * 200); }
  ctx.fillStyle = 'rgb(' + r + ',' + g + ',50)';
  ctx.fillRect(bx, by, barW * pct, barH);
}

function aiResetCooldown() {
  // 隨機等待 2~6 秒（60~180 frame @30fps）
  _aiCooldown = 60 + Math.floor(Math.random() * 120);
  _aiTimer = 0;
}

function startBiteBall(sw) {
  if (testMode) stopTest();
  if (character.action === 'combo') endCombo();
  character.action = 'biteBall';
  _biteBallPhase = 0;
  _biteBallTimer = 0;
  character.spriteFrame = 0;
  character.spriteTimer = 0;
}

function aiPickAction(sw, ballState) {
  if (!_aiSceneInfo) return;
  var info = _aiSceneInfo;
  var pct = _stamina / _staminaMax * 100;

  // 體力越低，去睡覺的機率越高
  var sleepBonus = 0;
  if (pct < 60) sleepBonus = (60 - pct) * 0.8; // 最高 +48%

  // 加權隨機（基礎：咬球50%, 追球15%, 亂跑12%, 爬紙箱10%, 爬牆7%, 睡覺6%）
  var baseSleep = 6 + sleepBonus;
  var total = 94 + baseSleep;
  var roll = Math.random() * total;

  if (roll < 50) {
    startBiteBall(sw);
  } else if (roll < 65) {
    startChase();
  } else if (roll < 77) {
    tapCharacter(sw);
  } else if (roll < 87) {
    startComboBox(sw, info.boxX, info.boxTopY, info.boxW);
  } else if (roll < 94) {
    startComboWall(sw);
  } else {
    startGoToBox(info.openingX);
  }
}
var COMBO_LEDGE_Y = 73;    // 爬邊牆：攀緣 Y 位置
var FOOT_OFFSET = 7;       // 精靈圖底部留白修正（像素）

// ── 取得當前精靈 key ──
function getSpriteKey() {
  if (testMode) return testMode;
  if (character.action === 'combo') {
    if (_comboType === 'wall') {
      if (_comboStep === 0) return 'run';
      if (_comboStep === 1) return 'jump';
      if (_comboStep === 2) return 'ledge_idle';
      if (_comboStep === 3) return 'ledge_land';
      if (_comboStep === 4) return 'jump';
    } else if (_comboType === 'box') {
      if (_comboStep === 0) return 'run';
      if (_comboStep === 1) return 'climb';
      if (_comboStep === 2) return 'idle';
      if (_comboStep === 3) return 'jump';
    }
    return 'idle';
  }
  if (character.action === 'jumpOff') return 'jump';
  if (character.action === 'chase') return 'run';
  if (character.action === 'dash') return 'roll';
  if (character.action === 'goToBox') return 'run';
  if (character.action === 'biteBall') return 'run';
  if (character.action === 'kick') return 'attack';
  if (character.action === 'sleeping') return 'idle';
  if (character.action === 'weak') return 'idle';
  if (!character.onGround) return 'jump';
  return 'idle';
}

// ── 測試動作 ──
function testAction(key) {
  var defs = ColorCatSprite.getDefs();
  var def = defs[key];
  if (!def) return;
  if (testMode === key) { stopTest(); return; }
  releaseBall();
  var wasOnBox = character.action === 'combo' && _comboType === 'box' && _comboStep >= 2;
  // 在紙箱上 → 跳躍類在原地跳，其他離開紙箱
  if (character.action === 'combo' && _comboType === 'box') {
    if (def.jumpVy) {
      // 跳躍動作：保留紙箱高度，在上面跳
      character._testBoxY = character.y;
    } else {
      _comboStep = -1;
      _comboType = '';
      if (character.y < C.CHAR_GROUND_Y) {
        character.onGround = false;
        character.vy = 0;
      }
      character._testBoxY = 0;
    }
  } else {
    character._testBoxY = 0;
  }
  testMode = key;
  character.spriteFrame = 0;
  character.spriteTimer = 0;
  character.action = 'test';
  if (def.jumpVy) {
    character.vy = def.jumpVy;
    character.onGround = false;
  }
}

function stopTest() {
  testMode = null;
  character.action = 'idle';
  character.spriteFrame = 0;
  character.spriteTimer = 0;
  // _testBoxY 在落地後清除，不在這裡清
}

// ── 結束 combo（回到地面） ──
function endCombo() {
  _comboStep = -1;
  _comboType = '';
  character.y = C.CHAR_GROUND_Y;
  character.onGround = true;
}

// ── 放下球（中斷咬球） ──
function releaseBall() {
  if (character.action === 'biteBall') {
    ColorCatBall.setCarried(false);
  }
}

// ── 開始追球 ──
function startChase() {
  if (testMode) stopTest();
  releaseBall();
  if (character.action === 'sleeping') {
    character.action = 'chase';
    character.x = character.x + C.SPRITE_DRAW / 3;
    character.actionFrame = 0;
    character.spriteFrame = 0;
    character.spriteTimer = 0;
    return;
  }
  // 站在紙箱上 → 先往右跳下來再追球
  if (character.action === 'combo' && _comboType === 'box' && _comboStep === 2) {
    _comboStep = -1;
    _comboType = '';
    character.action = 'jumpOff';
    character.facing = 1;
    character.vy = -3;
    character.onGround = false;
    character.spriteFrame = 0;
    character.spriteTimer = 0;
    return;
  }
  if (character.action === 'combo') endCombo();
  character.action = 'chase';
  character._chaseFacing = 0; // 重新偵測方向
  character.actionFrame = 0;
  character.spriteFrame = 0;
  character.spriteTimer = 0;
}

// ── 走向紙箱 ──
function startGoToBox(boxX) {
  if (testMode) stopTest();
  releaseBall();
  if (character.action === 'sleeping') return;
  // 站在紙箱上 → 先跳下來，落地後再跑去紙箱
  if (character.action === 'combo' && _comboType === 'box' && _comboStep === 2) {
    _pendingGoToBox = boxX;
    _comboStep = -1;
    _comboType = '';
    character.action = 'jumpOff';
    character.facing = 1;
    character.vy = -3;
    character.onGround = false;
    character.spriteFrame = 0;
    character.spriteTimer = 0;
    return;
  }
  if (character.action === 'combo') endCombo();
  _boxTargetX = boxX;
  character.action = 'goToBox';
  character.spriteFrame = 0;
  character.spriteTimer = 0;
}

// ── 點擊角色觸發短跑 ──
function tapCharacter(sceneWidth) {
  // 在紙箱上 → 短跑（可能跑出邊緣墜落）
  if (character.action === 'combo' && _comboType === 'box' && _comboStep === 2) {
    var bi = _comboBoxInfo;
    var dir = Math.random() < 0.5 ? -1 : 1;
    var dist = 15 + Math.random() * 20;
    _dashTargetX = character.x + dir * dist;
    // 限制不超出紙箱邊緣太多（讓邊緣檢測處理墜落）
    var edgeL = bi.x - bi.halfW - 5;
    var edgeR = bi.x + bi.halfW + 5;
    if (_dashTargetX < edgeL) _dashTargetX = edgeL;
    if (_dashTargetX > edgeR) _dashTargetX = edgeR;
    character.facing = dir;
    character.action = 'dash';
    character.spriteFrame = 0;
    character.spriteTimer = 0;
    // 記住紙箱高度，dash 中使用
    character._onBoxY = bi.topY + FOOT_OFFSET;
    return;
  }
  // chase/kick 可被中斷
  if (character.action === 'chase' || character.action === 'kick') {
    character.action = 'idle';
  }
  if (character.action !== 'idle') return; // 忙碌中禁止
  var dir = Math.random() < 0.5 ? -1 : 1;
  var dist = 40 + Math.random() * 50; // 跑 40~90 px
  _dashTargetX = character.x + dir * dist;
  // 限制在場景範圍內
  if (_dashTargetX < 30) _dashTargetX = 30;
  if (_dashTargetX > sceneWidth - 30) _dashTargetX = sceneWidth - 30;
  character.facing = dir;
  character.action = 'dash';
  character.spriteFrame = 0;
  character.spriteTimer = 0;
  character._onBoxY = 0;
}

// ── 爬邊牆：跑到右邊 → 跳躍 → 攀緣待機2秒 → 攀緣著地 → 落下 ──
function startComboWall(sceneWidth) {
  if (testMode) stopTest();
  releaseBall();
  if (character.action === 'chase' || character.action === 'kick') character.action = 'idle';
  if (character.action !== 'idle') return;
  _comboType = 'wall';
  _comboSceneW = sceneWidth;
  _comboStep = 0;
  _comboTimer = 0;
  character.action = 'combo';
  character.facing = 1;
  character.spriteFrame = 0;
  character.spriteTimer = 0;
}

// ── 爬紙箱：走到紙箱前 → 爬梯子往上 → 站在紙箱上面朝右 ──
function startComboBox(sceneWidth, boxX, boxTopY, boxW) {
  if (testMode) stopTest();
  releaseBall();
  // 已經在紙箱上了，不重複
  if (character.action === 'combo' && _comboType === 'box' && _comboStep === 2) return;
  if (character.action === 'chase' || character.action === 'kick') character.action = 'idle';
  if (character.action !== 'idle') return;
  _comboType = 'box';
  _comboSceneW = sceneWidth;
  _comboBoxInfo = { x: boxX, topY: boxTopY, halfW: (boxW || 51) / 2 };
  _comboStep = 0;
  _comboTimer = 0;
  character.action = 'combo';
  character.spriteFrame = 0;
  character.spriteTimer = 0;
}

// ── 從紙箱醒來 ──
function wakeUp(boxX) {
  if (character.action !== 'sleeping') return;
  character.action = 'idle';
  character.x = boxX + C.SPRITE_DRAW / 3;
  character.spriteFrame = 0;
  character.spriteTimer = 0;
}

// ── 行為更新（每 frame 呼叫） ──
// 回傳 true 表示踢到球
function updateCharacter(sceneWidth, ballState) {
  var sw = sceneWidth;
  updateStamina();
  var defs = ColorCatSprite.getDefs();
  var key = getSpriteKey();
  var def = defs[key];

  // 精靈動畫 frame 推進
  if (def) {
    character.spriteTimer += def.speed;
    if (character.spriteTimer >= 1) {
      character.spriteTimer -= 1;
      character.spriteFrame++;
      if (character.spriteFrame >= def.frames) {
        character.spriteFrame = 0;
        if (testMode) {
          var testDef = defs[testMode];
          if (testDef.type === 'once') { stopTest(); return false; }
        }
      }
    }
  }

  // 垂直物理（跳躍/下落）— combo/jumpOff 自行處理，跳過
  if (!character.onGround && character.action !== 'combo' && character.action !== 'jumpOff') {
    var floorY = character._testBoxY || C.CHAR_GROUND_Y;
    character.vy += 0.25;
    character.y += character.vy;
    if (character.y >= floorY) {
      character.y = floorY;
      character.vy = 0;
      character.onGround = true;
      // 落回紙箱上 → 恢復紙箱 idle
      if (character._testBoxY) {
        character._testBoxY = 0;
        character.action = 'combo';
        _comboType = 'box';
        _comboStep = 2;
        _comboTimer = 0;
        character.spriteFrame = 0;
        character.spriteTimer = 0;
      }
    }
  }

  // 測試模式：移動類動作
  if (testMode) {
    var testDef = defs[testMode];
    if (testDef.type === 'move' && testDef.moveSpeed) {
      character.x += testDef.moveSpeed * character.facing;
      if (character.x < C.SPRITE_DRAW / 2) {
        character.x = C.SPRITE_DRAW / 2;
        character.facing = 1;
      }
      if (character.x > sw - C.SPRITE_DRAW / 2) {
        character.x = sw - C.SPRITE_DRAW / 2;
        character.facing = -1;
      }
    }
    return false;
  }

  // ── 睡覺中：AI 計時後自動醒來 ──
  if (character.action === 'sleeping') {
    if (!testMode && _aiSceneInfo) {
      _aiTimer++;
      // 睡 5~10 秒後自動醒來
      if (_aiTimer >= 150 + Math.floor(Math.random() * 150)) {
        wakeUp(_aiSceneInfo.openingX);
        _aiTimer = 0;
        aiResetCooldown();
      }
    }
    return false;
  }

  // ── 從紙箱跳下 ──
  if (character.action === 'jumpOff') {
    character.vy += 0.25;
    character.y += character.vy;
    character.x += 1.5; // 往右移動
    if (character.y >= C.CHAR_GROUND_Y) {
      character.y = C.CHAR_GROUND_Y;
      character.vy = 0;
      character.onGround = true;
      // 落地後：有待執行的紙箱目標 → 跑去紙箱；否則追球
      if (_pendingGoToBox) {
        _boxTargetX = _pendingGoToBox;
        _pendingGoToBox = 0;
        character.action = 'goToBox';
      } else {
        character.action = 'chase';
        character.actionFrame = 0;
      }
      character.spriteFrame = 0;
      character.spriteTimer = 0;
    }
    return false;
  }

  // ── 連續動作 ──
  if (character.action === 'combo') {
    if (_comboType === 'wall') {
      // ── 爬邊牆 ──
      var rightEdge = sw - 9;
      if (_comboStep === 0) {
        character.facing = 1;
        if (character.x < rightEdge) {
          character.x += character.speed * 1.2;
        } else {
          character.x = rightEdge;
          _comboStep = 1;
          character.vy = -4;
          character.onGround = false;
          character.spriteFrame = 0;
          character.spriteTimer = 0;
        }
      } else if (_comboStep === 1) {
        character.vy += 0.15;
        character.y += character.vy;
        if (character.y <= COMBO_LEDGE_Y || character.vy >= 0) {
          character.y = COMBO_LEDGE_Y;
          character.vy = 0;
          _comboStep = 2;
          _comboTimer = 0;
          character.spriteFrame = 0;
          character.spriteTimer = 0;
        }
      } else if (_comboStep === 2) {
        character.y = COMBO_LEDGE_Y;
        _comboTimer++;
        if (_comboTimer >= 60) {
          _comboStep = 3;
          _comboTimer = 0;
          character.spriteFrame = 0;
          character.spriteTimer = 0;
        }
      } else if (_comboStep === 3) {
        character.y = COMBO_LEDGE_Y;
        _comboTimer++;
        var landDef = defs.ledge_land;
        var landTotal = landDef ? Math.ceil(landDef.frames / landDef.speed) : 20;
        if (_comboTimer >= landTotal) {
          _comboStep = 4;
          character.onGround = false;
          character.vy = 0;
          character.spriteFrame = 0;
          character.spriteTimer = 0;
        }
      } else if (_comboStep === 4) {
        character.vy += 0.25;
        character.y += character.vy;
        if (character.y >= C.CHAR_GROUND_Y) {
          character.y = C.CHAR_GROUND_Y;
          character.vy = 0;
          character.onGround = true;
          character.action = 'idle';
          _comboStep = -1;
          character.spriteFrame = 0;
          character.spriteTimer = 0;
        }
      }
    } else if (_comboType === 'box') {
      // ── 爬紙箱 ──
      var bi = _comboBoxInfo;
      var standY = bi.topY + FOOT_OFFSET; // 修正精靈圖底部留白
      if (_comboStep === 0) {
        // Step 0：跑到紙箱前
        var targetX = bi.x;
        var bDist = targetX - character.x;
        if (bDist > 2) character.facing = 1;
        else if (bDist < -2) character.facing = -1;
        if (Math.abs(bDist) > 4) {
          character.x += (bDist > 0 ? 1 : -1) * character.speed;
        } else {
          character.x = targetX;
          _comboStep = 1;
          character.facing = 1;
          character.spriteFrame = 0;
          character.spriteTimer = 0;
        }
      } else if (_comboStep === 1) {
        // Step 1：爬梯子動作往上
        character.y -= 0.8;
        if (character.y <= standY) {
          character.y = standY;
          _comboStep = 2;
          _comboTimer = 0;
          _boxJumpsLeft = 0;
          character.facing = 1;
          character.spriteFrame = 0;
          character.spriteTimer = 0;
        }
      } else if (_comboStep === 2) {
        // Step 2：站在紙箱上面 idle 面朝右
        character.y = standY;
        character.facing = 1;
        // AI：站一陣子後決定行動
        if (!testMode) {
          _comboTimer++;
          if (_comboTimer >= 90 + Math.floor(Math.random() * 60)) {
            // 50% 機率原地跳 1~3 次
            if (_boxJumpsLeft === 0 && Math.random() < 0.5) {
              _boxJumpsLeft = 1 + Math.floor(Math.random() * 3);
            }
            if (_boxJumpsLeft > 0) {
              // 原地跳躍
              _comboStep = 3;
              character.vy = -3.5;
              character.spriteFrame = 0;
              character.spriteTimer = 0;
              _comboTimer = 0;
              return false;
            }
            // 跳下紙箱
            _comboStep = -1;
            _comboType = '';
            character.action = 'jumpOff';
            character.facing = 1;
            character.vy = -3;
            character.onGround = false;
            character.spriteFrame = 0;
            character.spriteTimer = 0;
            aiResetCooldown();
            return false;
          }
        }
        // 邊緣檢測：超出紙箱範圍 → 墜落
        var edgeL = bi.x - bi.halfW;
        var edgeR = bi.x + bi.halfW;
        if (character.x < edgeL || character.x > edgeR) {
          _comboStep = -1;
          _comboType = '';
          character.onGround = false;
          character.vy = 0;
          character.action = 'jumpOff';
          character.spriteFrame = 0;
          character.spriteTimer = 0;
        }
      } else if (_comboStep === 3) {
        // Step 3：紙箱上原地跳躍
        character.vy += 0.3;
        character.y += character.vy;
        if (character.y >= standY) {
          character.y = standY;
          character.vy = 0;
          _boxJumpsLeft--;
          _comboStep = 2;
          _comboTimer = 0;
          character.spriteFrame = 0;
          character.spriteTimer = 0;
        }
      }
    }
    return false;
  }

  // ── 走向紙箱 ──
  if (character.action === 'goToBox') {
    // 目標是紙箱開口位置（由 scene 傳入）
    var boxDist = _boxTargetX - character.x;
    if (boxDist > 2) character.facing = 1;
    else if (boxDist < -2) character.facing = -1;

    if (Math.abs(boxDist) > 8) {
      character.x += (boxDist > 0 ? 1 : -1) * character.speed;
    } else {
      // 到達開口，進入睡覺
      character.action = 'sleeping';
      character.spriteFrame = 0;
      character.spriteTimer = 0;
      _aiTimer = 0;
    }
    return false;
  }

  // ── 咬球跑 ──
  if (character.action === 'biteBall') {
    if (_biteBallPhase === 0) {
      // Phase 0：跑向球（鎖定方向，不反覆翻轉）
      var toBall = ballState.x - character.x;
      character.facing = toBall >= 0 ? 1 : -1;
      if (Math.abs(toBall) > 6) {
        character.x += character.facing * character.speed * 1.2;
      } else {
        // 咬住球
        _biteBallPhase = 1;
        _biteBallTimer = 0;
        ColorCatBall.setCarried(true);
        // 隨機選一個跑去的目標（確保有足夠距離）
        var runDist = 60 + Math.random() * 80;
        var runDir = Math.random() < 0.5 ? 1 : -1;
        _biteBallTargetX = character.x + runDir * runDist;
        if (_biteBallTargetX < 30) _biteBallTargetX = 30;
        if (_biteBallTargetX > sw - 30) _biteBallTargetX = sw - 30;
        character.facing = _biteBallTargetX > character.x ? 1 : -1;
      }
    } else if (_biteBallPhase === 1) {
      // Phase 1：咬著球跑
      var toTarget = _biteBallTargetX - character.x;
      character.facing = toTarget >= 0 ? 1 : -1;
      // 球跟著角色嘴巴位置
      var mouthX = character.x + character.facing * 20;
      var mouthY = character.y - C.SPRITE_DRAW * 0.3;
      ColorCatBall.setPosition(mouthX, mouthY);

      if (Math.abs(toTarget) > 5) {
        character.x += character.facing * character.speed;
        _biteBallTimer++;
      }
      // 跑到目標或超過 4 秒
      if (Math.abs(toTarget) <= 5 || _biteBallTimer > 120) {
        _biteBallPhase = 2;
      }
    } else {
      // Phase 2：放下球
      ColorCatBall.setCarried(false);
      character.action = 'idle';
      character.spriteFrame = 0;
      character.spriteTimer = 0;
      aiResetCooldown();
    }
    return false;
  }

  // ── 短跑 ──
  if (character.action === 'dash') {
    var dashDist = _dashTargetX - character.x;
    if (Math.abs(dashDist) > 3) {
      character.x += (dashDist > 0 ? 1 : -1) * character.speed;
    } else {
      // 在紙箱上短跑結束 → 回到紙箱 idle
      if (character._onBoxY) {
        character.action = 'combo';
        _comboType = 'box';
        _comboStep = 2;
        character.y = character._onBoxY;
        character._onBoxY = 0;
      } else {
        character.action = 'idle';
      }
      character.spriteFrame = 0;
      character.spriteTimer = 0;
    }
    // 在紙箱上短跑 → 維持高度 + 邊緣墜落
    if (character._onBoxY) {
      character.y = character._onBoxY;
      var bi = _comboBoxInfo;
      if (bi && (character.x < bi.x - bi.halfW || character.x > bi.x + bi.halfW)) {
        character._onBoxY = 0;
        character.action = 'jumpOff';
        character.onGround = false;
        character.vy = 0;
        character.spriteFrame = 0;
        character.spriteTimer = 0;
      }
    }
    return false;
  }

  // ── 正常遊戲 AI ──
  if (character.action === 'chase') {
    // 鎖定追球方向（用球的位置決定，避免抖動）
    if (!character._chaseFacing) {
      character._chaseFacing = (ballState.x >= character.x) ? 1 : -1;
    }
    var kickOffset = character._chaseFacing >= 0 ? -18 : 18;
    var targetX = ballState.x + kickOffset;
    var dist = targetX - character.x;

    character.facing = character._chaseFacing;

    if (Math.abs(dist) > 4) {
      character.x += (dist > 0 ? 1 : -1) * character.speed;
    } else {
      character._chaseFacing = 0;
      character.action = 'kick';
      character.actionFrame = 0;
      character.spriteFrame = 0;
      character.spriteTimer = 0;
      character._kicked = false; // 尚未出手
    }
  } else if (character.action === 'kick') {
    character.actionFrame++;
    var attackDef = defs.attack;
    var totalFrames = Math.ceil(attackDef.frames / attackDef.speed);

    // 攻擊動畫播到第 3 格（出手瞬間）才讓球飛
    var hitFrame = 3;
    if (!character._kicked && character.spriteFrame >= hitFrame) {
      character._kicked = true;
      return true; // 這一幀踢到球
    }

    if (character.actionFrame > totalFrames) {
      character.action = 'idle';
      character.actionFrame = 0;
      character.spriteFrame = 0;
      character.spriteTimer = 0;
    }
  } else {
    // idle：面向球
    if (ballState.x > character.x + 5) character.facing = 1;
    else if (ballState.x < character.x - 5) character.facing = -1;

    // 自主 AI：閒置計時 → 隨機行動
    if (!testMode && _aiSceneInfo) {
      _aiTimer++;
      if (_aiTimer >= _aiCooldown) {
        aiPickAction(sw, ballState);
        aiResetCooldown();
      }
    }
  }

  return false;
}

// ── 跑步煙塵粒子 ──
var _dustParticles = [];
var _dustTimer = 0;
var DUST_SPAWN_INTERVAL = 3;  // 每 3 幀產生一組

function isRunning() {
  if (character.action === 'chase' || character.action === 'dash' || character.action === 'goToBox') return true;
  if (character.action === 'biteBall') return true;
  if (character.action === 'combo' && _comboStep === 0) return true;
  if (testMode === 'run') return true;
  return false;
}

function spawnDust() {
  var footX = character.x - character.facing * 8; // 腳後方
  var footY = character.y - FOOT_OFFSET - 4;      // 對齊實際腳底再往上
  for (var i = 0; i < 3; i++) {
    _dustParticles.push({
      x: footX + (Math.random() - 0.5) * 8,
      y: footY + (Math.random() - 0.5) * 4,
      vx: -character.facing * (0.4 + Math.random() * 0.6),
      vy: -(0.4 + Math.random() * 0.5),
      life: 1,
      decay: 0.03 + Math.random() * 0.02,
      size: 2.5 + Math.random() * 2.5,
    });
  }
}

function updateDust() {
  if (isRunning() && character.onGround) {
    _dustTimer++;
    if (_dustTimer >= DUST_SPAWN_INTERVAL) {
      _dustTimer = 0;
      spawnDust();
    }
  } else {
    _dustTimer = 0;
  }
  for (var i = _dustParticles.length - 1; i >= 0; i--) {
    var p = _dustParticles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy *= 0.95;
    p.life -= p.decay;
    p.size *= 0.97;
    if (p.life <= 0) _dustParticles.splice(i, 1);
  }
}

function drawDust(ctx, light) {
  if (_dustParticles.length === 0) return;
  ctx.save();
  for (var i = 0; i < _dustParticles.length; i++) {
    var p = _dustParticles[i];
    var alpha = p.life * 0.4;
    ctx.fillStyle = light
      ? 'rgba(180,160,130,' + alpha + ')'
      : 'rgba(200,190,170,' + alpha + ')';
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ── 虛弱喘氣粒子 ──
var _breathParticles = [];
var _breathTimer = 0;
var _weakLevel = 0; // 0=正常, 1=輕微, 2=中等, 3=嚴重
var BREATH_WAVE_INTERVAL = 28; // 每 28 幀噴一波（接近 1 秒一波）

function updateBreath() {
  if (character.action === 'weak' && _weakLevel > 0) {
    _breathTimer++;
    if (_breathTimer >= BREATH_WAVE_INTERVAL) {
      _breathTimer = 0;
      // 等級1: 3~4顆, 等級2: 2倍(6~8), 等級3: 4倍(12~16)
      var mult = _weakLevel === 1 ? 1 : (_weakLevel === 2 ? 2 : 4);
      var baseCount = 3 + Math.floor(Math.random() * 2);
      var count = baseCount * mult;
      var mouthX = character.x + character.facing * (C.SPRITE_DRAW * 0.18);
      var mouthY = character.y - C.SPRITE_DRAW * 0.35 - 3;
      for (var i = 0; i < count; i++) {
        _breathParticles.push({
          x: mouthX + (Math.random() - 0.3) * 4 * mult,
          y: mouthY + (Math.random() - 0.5) * 3 * mult,
          vx: character.facing * (0.3 + Math.random() * 0.4),
          vy: -(0.2 + Math.random() * 0.3),
          life: 1,
          decay: 0.02 + Math.random() * 0.015,
          size: 1.5 + Math.random() * 2,
        });
      }
    }
  } else {
    _breathTimer = 0;
  }
  for (var i = _breathParticles.length - 1; i >= 0; i--) {
    var p = _breathParticles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vx *= 0.97;
    p.vy *= 0.95;
    p.size += 0.03;
    p.life -= p.decay;
    if (p.life <= 0) _breathParticles.splice(i, 1);
  }
}

function drawBreath(ctx) {
  if (_breathParticles.length === 0) return;
  ctx.save();
  for (var i = 0; i < _breathParticles.length; i++) {
    var p = _breathParticles[i];
    var alpha = p.life * 0.5;
    ctx.fillStyle = 'rgba(255,255,255,' + alpha + ')';
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ── 繪製（委派給 ColorCatSprite） ──
function drawCharacter(ctx, light) {
  updateDust();
  updateBreath();
  drawDust(ctx, light !== undefined ? light : true);
  if (character.action === 'sleeping') return;
  var key = getSpriteKey();
  var noShadow = _suppressGroundShadow || (character.action === 'combo' && _comboType === 'box' && _comboStep >= 1) || character.action === 'jumpOff';
  ColorCatSprite.draw(ctx, key, character.spriteFrame, character.x, character.y, character.facing, noShadow);
  drawBreath(ctx);
  drawStaminaBar(ctx);
}

// ── 角色點擊判定 ──
function isCharClicked(cx, cy) {
  if (character.action === 'sleeping') return false;
  var halfW = C.SPRITE_DRAW / 2;
  var charTop = character.y - C.SPRITE_DRAW;
  return cx >= character.x - halfW && cx <= character.x + halfW &&
         cy >= charTop && cy <= character.y;
}

// ── 公開 API ──
window.ColorCatCharacter = {
  state: character,
  init: initCharacter,
  update: updateCharacter,
  draw: drawCharacter,
  startChase: startChase,
  switchSkin: function(sk) { ColorCatSprite.switchSkin(sk); },
  testAction: testAction,
  stopTest: stopTest,
  getSkin: function() { return ColorCatSprite.getSkin(); },
  getTestMode: function() { return testMode; },
  startGoToBox: startGoToBox,
  wakeUp: wakeUp,
  isSleeping: function() { return character.action === 'sleeping'; },
  isClicked: isCharClicked,
  tap: tapCharacter,
  startComboWall: startComboWall,
  startComboBox: startComboBox,
  startBiteBall: startBiteBall,
  getSpriteKey: getSpriteKey,
  setSuppressGroundShadow: function(v) { _suppressGroundShadow = !!v; },
  setSceneInfo: aiSetSceneInfo,
  setWeak: function(level) {
    // level: 0/false=關閉, 1=輕微, 2=中等, 3=嚴重
    var lv = level === true ? 1 : (parseInt(level) || 0);
    if (lv > 0) {
      _weakLevel = Math.min(lv, 3);
      character.action = 'weak'; character.spriteFrame = 0; character.spriteTimer = 0;
    } else {
      _weakLevel = 0;
      if (character.action === 'weak') { character.action = 'idle'; character.spriteFrame = 0; character.spriteTimer = 0; }
    }
  },
  isWeak: function() { return character.action === 'weak'; },
  getWeakLevel: function() { return _weakLevel; },
  getStamina: function() { return _stamina; },
  getStaminaMax: function() { return _staminaMax; },
};

})();
