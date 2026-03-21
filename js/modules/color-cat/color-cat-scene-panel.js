/* ================================================
   ColorCat — 場景右側抽屜面板（檔案夾框架、把手、側邊頁籤、動畫）
   頁籤內容由 panel-tab0 / tab1 / tab2 繪製
   依賴：color-cat-scene.js (ColorCatScene._)
   ================================================ */
;(function() {

var C = window.ColorCatConfig;
var _ = window.ColorCatScene._;

// ── 面板狀態 ──
var _open = false;
var _slide = 0;       // 0=關, 1=全開
var _tab = 0;         // 0=基本, 1=狀態, 2=裝備
var SLIDE_SPEED = 0.12;

// ── 尺寸常數 ──
var HANDLE_W = 12;
var HANDLE_H = 30;
var STAB_W = 14;      // 側邊頁籤寬度
var STAB_GAP = 2;     // 頁籤間距

// 頁籤內容插槽（由 panel-tab 子模組填入）
_.drawPanelTab0 = function() {};
_.drawPanelTab1 = function() {};
_.drawPanelTab2 = function() {};

function panelW(sw) { return Math.floor(sw / 3); }

// ── 面板更新（每幀在 scene.update 中呼叫，必須在角色位置夾限前執行） ──
function updatePanel(sw) {
  var prevSlide = _slide;
  if (_open && _slide < 1) _slide = Math.min(1, _slide + SLIDE_SPEED);
  if (!_open && _slide > 0) _slide = Math.max(0, _slide - SLIDE_SPEED);

  // 面板正在展開時，檢測面板左緣是否碰到角色/球
  if (_slide > prevSlide) {
    var panelEdge = sw - panelW(sw) * _slide - HANDLE_W;
    var charState = window.ColorCatCharacter.state;
    var halfW = C.SPRITE_DRAW / 2;
    // 用角色右緣（x + halfW）判定碰撞，而非中心點
    if (charState.x + halfW > panelEdge && charState.action !== 'knockback' && charState.action !== 'sleeping') {
      window.ColorCatCharacter.startKnockback(sw);
      if (window.ColorCatCharacter._ && window.ColorCatCharacter._.spawnKnockbackBurst) {
        window.ColorCatCharacter._.spawnKnockbackBurst();
      }
    }
    // 敵人彈飛
    if (window.ColorCatEnemy) {
      var eAll = window.ColorCatEnemy.getAll();
      var eVW = window.ColorCatEnemy.VIS_W;
      for (var ei = 0; ei < eAll.length; ei++) {
        var ee = eAll[ei];
        if (ee.dead || ee.inKnockback || ee.action === 'falling' || ee.action === 'spawning') continue;
        if (ee.x + eVW / 2 > panelEdge) {
          window.ColorCatEnemy.knockback(ei);
        }
      }
    }

    var ballState = window.ColorCatBall.state;
    if (ballState.x + ballState.r > panelEdge) {
      ballState.vx = -(3 + Math.random() * 2);
      ballState.vy = -(1 + Math.random() * 1.5);
      if (window.ColorCatBall.spawnPanelHitDust) {
        window.ColorCatBall.spawnPanelHitDust();
      }
    }
  }
}

// 暴露有效活動寬度（面板展開時壓縮）
_.getEffectiveWidth = function(sw) {
  if (_slide <= 0) return sw;
  return sw - panelW(sw) * _slide - HANDLE_W;
};

// ═══════════════════════════════════
//  抽屜把手
// ═══════════════════════════════════

function drawHandle(ctx, sw, h, light) {
  var pw = panelW(sw);
  var hx = sw - pw * _slide - HANDLE_W;
  var hy = Math.floor((h - HANDLE_H) / 2);

  ctx.save();
  ctx.fillStyle = light ? 'rgba(245,230,200,0.92)' : 'rgba(46,36,24,0.92)';
  ctx.beginPath();
  ctx.moveTo(hx + HANDLE_W, hy);
  ctx.lineTo(hx + 4, hy);
  ctx.quadraticCurveTo(hx, hy, hx, hy + 4);
  ctx.lineTo(hx, hy + HANDLE_H - 4);
  ctx.quadraticCurveTo(hx, hy + HANDLE_H, hx + 4, hy + HANDLE_H);
  ctx.lineTo(hx + HANDLE_W, hy + HANDLE_H);
  ctx.fill();

  ctx.strokeStyle = light ? '#C4A46E' : '#5A4830';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(hx + HANDLE_W, hy);
  ctx.lineTo(hx + 4, hy);
  ctx.quadraticCurveTo(hx, hy, hx, hy + 4);
  ctx.lineTo(hx, hy + HANDLE_H - 4);
  ctx.quadraticCurveTo(hx, hy + HANDLE_H, hx + 4, hy + HANDLE_H);
  ctx.lineTo(hx + HANDLE_W, hy + HANDLE_H);
  ctx.stroke();

  var ax = hx + HANDLE_W / 2, ay = hy + HANDLE_H / 2;
  ctx.fillStyle = light ? '#8B7355' : '#AA9060';
  ctx.beginPath();
  if (_open) { ctx.moveTo(ax - 2, ay - 3); ctx.lineTo(ax + 2, ay); ctx.lineTo(ax - 2, ay + 3); }
  else       { ctx.moveTo(ax + 2, ay - 3); ctx.lineTo(ax - 2, ay); ctx.lineTo(ax + 2, ay + 3); }
  ctx.fill();
  ctx.restore();
}

// ═══════════════════════════════════
//  側邊頁籤列
// ═══════════════════════════════════

function drawSideTabs(ctx, px, h, light) {
  var labels = ['基本', '狀態', '裝備'];
  var border = light ? '#C4A46E' : '#5A4830';
  var panelBg = light ? '#F5E6C8' : '#2E2418';
  var inactiveBg = light ? '#D8C498' : '#221A10';
  var tabH = Math.floor((h - STAB_GAP * 4) / 3);

  // 頁籤與內容區分隔線
  ctx.strokeStyle = border;
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(px + STAB_W + 0.5, 0);
  ctx.lineTo(px + STAB_W + 0.5, h);
  ctx.stroke();

  for (var i = 0; i < 3; i++) {
    var ty = STAB_GAP + i * (tabH + STAB_GAP);
    var active = _tab === i;

    // 頁籤底色
    ctx.fillStyle = active ? panelBg : inactiveBg;
    ctx.fillRect(px + 1, ty, STAB_W, tabH);

    // 作用中頁籤：擦除分隔線，讓底色連接內容區
    if (active) {
      ctx.fillStyle = panelBg;
      ctx.fillRect(px + STAB_W, ty + 1, 1.5, tabH - 2);
    }

    // 頁籤上下邊框
    ctx.strokeStyle = border;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(px + 1, ty); ctx.lineTo(px + STAB_W + (active ? 0.5 : 1), ty);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(px + 1, ty + tabH); ctx.lineTo(px + STAB_W + (active ? 0.5 : 1), ty + tabH);
    ctx.stroke();

    // 頁籤文字（垂直排列，置中）
    var tc = active ? (light ? '#4A3520' : '#E8D4A8') : (light ? '#8B7355' : '#8A7B60');
    ctx.fillStyle = tc;
    ctx.font = 'bold 7px "Noto Sans TC", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    var midX = px + STAB_W / 2 + 0.5;
    var midY = ty + tabH / 2;
    ctx.fillText(labels[i][0], midX, midY - 5);
    if (labels[i].length > 1) {
      ctx.fillText(labels[i][1], midX, midY + 5);
    }
  }
}

// ═══════════════════════════════════
//  主繪製入口
// ═══════════════════════════════════

function drawPanel(ctx, sw, light) {
  var h = C.SCENE_H;
  // _slide 已由 updatePanel() 在 update 階段推進，此處只負責繪製
  drawHandle(ctx, sw, h, light);
  if (_slide <= 0) return;

  var pw = panelW(sw);
  var px = sw - pw * _slide;

  ctx.save();
  ctx.beginPath(); ctx.rect(px, 0, pw, h); ctx.clip();

  // 面板底色
  ctx.fillStyle = light ? '#F5E6C8' : '#2E2418';
  ctx.fillRect(px, 0, pw, h);
  ctx.strokeStyle = light ? '#C4A46E' : '#5A4830';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(px + 0.5, 0); ctx.lineTo(px + 0.5, h); ctx.stroke();

  // 側邊頁籤
  drawSideTabs(ctx, px, h, light);

  // 內容區（右側，委派給頁籤子模組）
  var contentX = px + STAB_W + 1;
  var contentW = pw - STAB_W - 1;
  var cy = 2;
  ctx.save();
  ctx.beginPath(); ctx.rect(contentX + 1, cy, contentW - 3, h - cy - 2); ctx.clip();
  if (_tab === 0) _.drawPanelTab0(ctx, contentX, contentW, cy, light);
  else if (_tab === 1) _.drawPanelTab1(ctx, contentX, contentW, cy, light);
  else _.drawPanelTab2(ctx, contentX, contentW, cy, light);
  ctx.restore();

  ctx.restore();
}

// ═══════════════════════════════════
//  點擊處理
// ═══════════════════════════════════

function handlePanelClick(cx, cy, sw) {
  var h = C.SCENE_H;
  var pw = panelW(sw);

  // 把手點擊
  var hx = sw - pw * _slide - HANDLE_W;
  var hy = Math.floor((h - HANDLE_H) / 2);
  if (cx >= hx && cx <= hx + HANDLE_W && cy >= hy && cy <= hy + HANDLE_H) {
    _open = !_open;
    return true;
  }

  // 面板區域點擊
  if (_slide > 0.5) {
    var px = sw - pw * _slide;
    if (cx >= px) {
      // 側邊頁籤點擊
      if (cx < px + STAB_W + 2) {
        var tabH = Math.floor((h - STAB_GAP * 4) / 3);
        for (var i = 0; i < 3; i++) {
          var ty = STAB_GAP + i * (tabH + STAB_GAP);
          if (cy >= ty && cy < ty + tabH) {
            _tab = i;
            break;
          }
        }
      }
      return true; // 攔截面板內所有點擊
    }
  }
  return false;
}

// 註冊
_.updatePanel = updatePanel;
_.drawPanel = drawPanel;
_.handlePanelClick = handlePanelClick;

})();
