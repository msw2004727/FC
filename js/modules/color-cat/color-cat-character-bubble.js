/* ================================================
   ColorCat — 角色對話泡泡（隨機冒泡說話）
   依賴：color-cat-character.js, dialogue/color-cat-dialogue-data.js
   ================================================ */
;(function() {

var C = window.ColorCatConfig;
var _ = window.ColorCatCharacter._;
var ch = _.char;

// ── 泡泡狀態 ──
var _text = '';
var _showTimer = 0;         // 剩餘顯示幀數
var _cooldown = 0;          // 下次觸發前的冷卻幀數
var SHOW_DURATION = 100;    // 顯示持續幀（約 3.3 秒 @30fps）
var FADE_FRAMES = 15;       // 淡出幀數
var CD_MIN = 240;           // 最短冷卻（約 8 秒）
var CD_MAX = 540;           // 最長冷卻（約 18 秒）

function resetCooldown() {
  // MBTI talkCdMultiplier 影響冷卻時間：E 型較短（愛說話），I 型較長（沉默）
  var cdMult = 1;
  var S = window.ColorCatStats;
  if (S && S.runtime.mbti && window.ColorCatMBTI) {
    var mw = ColorCatMBTI.getWeights(S.runtime.mbti);
    if (mw && mw.talkCdMultiplier) cdMult = mw.talkCdMultiplier;
  }
  var cdMin = Math.floor(CD_MIN * cdMult);
  var cdMax = Math.floor(CD_MAX * cdMult);
  _cooldown = cdMin + Math.floor(Math.random() * (cdMax - cdMin));
}

// 初始化隨機冷卻
resetCooldown();

// ── 動作映射到 MBTI 對話類別 ──
var ACTION_TO_DIALOGUE = {
  idle: 'idle', walking: 'idle', returnWalking: 'idle',
  sleeping: 'sleep', goToBox: 'sleep',
  chase: 'chase', biteBallRun: 'biteBall', kick: 'biteBall',
  dash: 'dash', dashBox: 'dash',
  climbBox: 'climbBox', boxIdle: 'climbBox', boxJump: 'climbBox',
  climbWall: 'climbWall', wallClimb: 'climbWall', wallTop: 'climbWall',
  watchFlower: 'watchFlower',
  attackEnemy: 'attackEnemy', chaseEnemy: 'attackEnemy',
  chaseButterfly: 'chaseButterfly',
  hurt: 'hurt', knockback: 'hurt',
};

// ── 隨機取一句話（優先 MBTI 對話，fallback 到舊對話） ──
function pickLine() {
  // 嘗試 MBTI 對話
  var S = window.ColorCatStats;
  var DM = window.ColorCatDialogueMBTI;
  if (S && S.runtime.mbti && DM) {
    var mbtiLines = DM[S.runtime.mbti];
    if (mbtiLines) {
      // 根據當前動作選對話類別
      var action = ch.action || 'idle';
      var cat = ACTION_TO_DIALOGUE[action] || 'general';
      var arr = mbtiLines[cat];
      if (!arr || arr.length === 0) arr = mbtiLines['general'];
      if (arr && arr.length > 0) {
        return arr[Math.floor(Math.random() * arr.length)];
      }
    }
  }
  // fallback：舊的 skin+mood 對話
  var D = window.ColorCatDialogue;
  if (!D) return '';
  var skinKey = window.ColorCatSprite ? ColorCatSprite.getSkin() : 'whiteCat';
  var charLines = D[skinKey];
  if (!charLines) return '';
  var moods = ['happy', 'angry', 'sad', 'joy'];
  var mood = moods[Math.floor(Math.random() * moods.length)];
  var fallback = charLines[mood];
  if (!fallback || fallback.length === 0) return '';
  return fallback[Math.floor(Math.random() * fallback.length)];
}

// ── 更新（每幀呼叫） ──
function updateBubble() {
  // 不在適合說話的狀態時不觸發
  if (ch.action === 'sleeping' || ch.action === 'dying' || ch.action === 'hurt' ||
      ch.action === 'knockback' || ch.action === 'ultimate' ||
      ch.action === 'runAway' || ch.action === 'returnPanting') {
    if (_showTimer > 0) _showTimer = 0;
    return;
  }
  if (_showTimer > 0) {
    _showTimer--;
    return;
  }
  if (_cooldown > 0) {
    _cooldown--;
    return;
  }
  // 觸發新對話
  _text = pickLine();
  if (_text) {
    _showTimer = SHOW_DURATION;
    resetCooldown();
  } else {
    resetCooldown();
  }
}

// ── 繪製泡泡 ──
function drawBubble(ctx) {
  if (_showTimer <= 0 || !_text) return;

  // 透明度（淡入淡出）
  var alpha = 1;
  var elapsed = SHOW_DURATION - _showTimer;
  if (elapsed < 8) alpha = elapsed / 8;                    // 淡入
  if (_showTimer < FADE_FRAMES) alpha = _showTimer / FADE_FRAMES; // 淡出

  ctx.save();
  ctx.globalAlpha = alpha;

  // 測量文字
  ctx.font = 'bold 14px "Noto Sans TC", sans-serif';
  var tw = ctx.measureText(_text).width;
  var padX = 8, padY = 4;
  var bw = tw + padX * 2;
  var bh = 20;
  var tailH = 5;

  // 泡泡位置（角色頭頂上方）
  var bx = ch.x - bw / 2;
  var by = ch.y - C.SPRITE_DRAW + 2 - bh - tailH;

  // 泡泡圓角矩形
  var r = 5;
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.strokeStyle = 'rgba(80,60,40,0.35)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(bx + r, by);
  ctx.lineTo(bx + bw - r, by);
  ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + r);
  ctx.lineTo(bx + bw, by + bh - r);
  ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - r, by + bh);
  ctx.lineTo(bx + r, by + bh);
  ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - r);
  ctx.lineTo(bx, by + r);
  ctx.quadraticCurveTo(bx, by, bx + r, by);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // 尾巴小三角
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.beginPath();
  ctx.moveTo(ch.x - 3, by + bh);
  ctx.lineTo(ch.x, by + bh + tailH);
  ctx.lineTo(ch.x + 3, by + bh);
  ctx.closePath();
  ctx.fill();
  // 尾巴邊框（左右兩邊）
  ctx.beginPath();
  ctx.moveTo(ch.x - 3, by + bh);
  ctx.lineTo(ch.x, by + bh + tailH);
  ctx.lineTo(ch.x + 3, by + bh);
  ctx.stroke();

  // 文字
  ctx.fillStyle = 'rgba(50,40,30,0.85)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(_text, ch.x, by + bh / 2 + 0.5);

  ctx.restore();
}

_.updateBubble = updateBubble;
_.drawBubble = drawBubble;

})();
