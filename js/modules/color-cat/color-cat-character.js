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
  action: 'idle',  // idle / chase / kick / test / goToBox / sleeping / dash / jumpOff
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
  ColorCatSprite.init();
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
var _comboBoxInfo = null;   // { x, topY } 紙箱資訊
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
      if (_comboStep === 0) return 'walk';
      if (_comboStep === 1) return 'climb';
      if (_comboStep === 2) return 'idle';
    }
    return 'idle';
  }
  if (character.action === 'jumpOff') return 'jump';
  if (character.action === 'chase') return 'run';
  if (character.action === 'dash') return 'run';
  if (character.action === 'goToBox') return 'walk';
  if (character.action === 'kick') return 'attack';
  if (character.action === 'sleeping') return 'idle';
  if (!character.onGround) return 'jump';
  return 'idle';
}

// ── 測試動作 ──
function testAction(key) {
  var defs = ColorCatSprite.getDefs();
  var def = defs[key];
  if (!def) return;
  if (testMode === key) { stopTest(); return; }
  testMode = key;
  character.spriteFrame = 0;
  character.spriteTimer = 0;
  character.action = 'test';
  if (def.jumpVy && character.onGround) {
    character.vy = def.jumpVy;
    character.onGround = false;
  }
}

function stopTest() {
  testMode = null;
  character.action = 'idle';
  character.spriteFrame = 0;
  character.spriteTimer = 0;
}

// ── 結束 combo（回到地面） ──
function endCombo() {
  _comboStep = -1;
  _comboType = '';
  character.y = C.CHAR_GROUND_Y;
  character.onGround = true;
}

// ── 開始追球 ──
function startChase() {
  if (testMode) stopTest();
  if (character.action === 'sleeping') return;
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
  character.actionFrame = 0;
  character.spriteFrame = 0;
  character.spriteTimer = 0;
}

// ── 走向紙箱 ──
function startGoToBox(boxX) {
  if (testMode) stopTest();
  if (character.action === 'sleeping') return;
  _boxTargetX = boxX;
  character.action = 'goToBox';
  character.spriteFrame = 0;
  character.spriteTimer = 0;
}

// ── 點擊角色觸發短跑 ──
function tapCharacter(sceneWidth) {
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
}

// ── 爬邊牆：跑到右邊 → 跳躍 → 攀緣待機2秒 → 攀緣著地 → 落下 ──
function startComboWall(sceneWidth) {
  if (testMode) stopTest();
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
function startComboBox(sceneWidth, boxX, boxTopY) {
  if (testMode) stopTest();
  if (character.action !== 'idle') return;
  _comboType = 'box';
  _comboSceneW = sceneWidth;
  _comboBoxInfo = { x: boxX, topY: boxTopY };
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
  character.x = boxX;
  character.spriteFrame = 0;
  character.spriteTimer = 0;
}

// ── 行為更新（每 frame 呼叫） ──
// 回傳 true 表示踢到球
function updateCharacter(sceneWidth, ballState) {
  var sw = sceneWidth;
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
    character.vy += 0.25;
    character.y += character.vy;
    if (character.y >= C.CHAR_GROUND_Y) {
      character.y = C.CHAR_GROUND_Y;
      character.vy = 0;
      character.onGround = true;
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

  // ── 睡覺中不做任何事 ──
  if (character.action === 'sleeping') return false;

  // ── 從紙箱跳下 ──
  if (character.action === 'jumpOff') {
    character.vy += 0.25;
    character.y += character.vy;
    character.x += 1.5; // 往右移動
    if (character.y >= C.CHAR_GROUND_Y) {
      character.y = C.CHAR_GROUND_Y;
      character.vy = 0;
      character.onGround = true;
      // 落地後接追球
      character.action = 'chase';
      character.actionFrame = 0;
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
        // Step 0：散步到紙箱前
        var targetX = bi.x;
        var bDist = targetX - character.x;
        if (bDist > 2) character.facing = 1;
        else if (bDist < -2) character.facing = -1;
        if (Math.abs(bDist) > 4) {
          character.x += (bDist > 0 ? 1 : -1) * (character.speed * 0.6);
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
          character.facing = 1;
          character.spriteFrame = 0;
          character.spriteTimer = 0;
        }
      } else if (_comboStep === 2) {
        // Step 2：站在紙箱上面 idle 面朝右
        character.y = standY;
        character.facing = 1;
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
      character.x += (boxDist > 0 ? 1 : -1) * (character.speed * 0.6);
    } else {
      // 到達開口，進入睡覺
      character.action = 'sleeping';
      character.spriteFrame = 0;
      character.spriteTimer = 0;
    }
    return false;
  }

  // ── 短跑 ──
  if (character.action === 'dash') {
    var dashDist = _dashTargetX - character.x;
    if (Math.abs(dashDist) > 3) {
      character.x += (dashDist > 0 ? 1 : -1) * character.speed;
    } else {
      character.action = 'idle';
      character.spriteFrame = 0;
      character.spriteTimer = 0;
    }
    return false;
  }

  // ── 正常遊戲 AI ──
  if (character.action === 'chase') {
    var kickOffset = character.facing >= 0 ? -18 : 18;
    var targetX = ballState.x + kickOffset;
    var dist = targetX - character.x;

    if (dist > 2) character.facing = 1;
    else if (dist < -2) character.facing = -1;

    if (Math.abs(dist) > 4) {
      character.x += (dist > 0 ? 1 : -1) * character.speed;
    } else {
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
  }

  return false;
}

// ── 繪製（委派給 ColorCatSprite） ──
function drawCharacter(ctx) {
  if (character.action === 'sleeping') return;
  var key = getSpriteKey();
  var noShadow = (character.action === 'combo' && _comboType === 'box' && _comboStep >= 1) || character.action === 'jumpOff';
  ColorCatSprite.draw(ctx, key, character.spriteFrame, character.x, character.y, character.facing, noShadow);
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
};

})();
