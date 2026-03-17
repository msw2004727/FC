/* ================================================
   SportHub — Kickball UI
   Visual feedback, DOM building for game container
   ================================================ */
window._KickballUI = (function () {
  var H = window._KickballHelpers;

  /* ── Visual Feedback ── */
  function showMessage(G, text, color, ms) {
    if (!G.msgEl) return;
    G.msgEl.textContent = text;
    G.msgEl.style.color = color || '#fff';
    G.msgEl.style.opacity = '1';
    setTimeout(function () { if (G.gameState !== 'gameover') G.msgEl.style.opacity = '0'; }, ms || 2200);
  }
  function showGrade(G, text, color) {
    G.gradePop.textContent = text; G.gradePop.style.color = color;
    G.gradePop.style.opacity = '1'; G.gradePop.style.transform = 'translate(-50%,-50%) scale(1.06)';
    setTimeout(function () { G.gradePop.style.opacity = '0'; G.gradePop.style.transform = 'translate(-50%,-50%) scale(1.14)'; }, 620);
  }
  function showShotType(G, text) {
    G.shotTypePop.textContent = text; G.shotTypePop.style.opacity = '1'; G.shotTypePop.style.transform = 'translate(-50%,-50%) scale(1)';
    setTimeout(function () { G.shotTypePop.style.opacity = '0'; G.shotTypePop.style.transform = 'translate(-50%,-50%) scale(1.04)'; }, 2000);
  }
  function triggerFlash(G, strength) {
    G.flashOverlay.style.opacity = String(Math.min(1, 0.42 + (strength || 1) * 0.34));
    setTimeout(function () { G.flashOverlay.style.opacity = '0'; }, 120);
  }
  function triggerImpactRing(G, worldPos) {
    var p = worldPos.clone().project(G.camera);
    var cw = G.containerEl.offsetWidth, ch = G.containerEl.offsetHeight;
    G.impactRing.style.left = ((p.x * 0.5 + 0.5) * cw) + 'px';
    G.impactRing.style.top = ((-(p.y * 0.5) + 0.5) * ch) + 'px';
    G.impactRing.style.opacity = '0.9'; G.impactRing.style.transform = 'scale(.35)';
    requestAnimationFrame(function () { G.impactRing.style.opacity = '0'; G.impactRing.style.transform = 'scale(1.45)'; });
  }
  function classifyShotType(cx, cy, speed) {
    var ax = Math.abs(cx);
    if (ax >= 0.42) return cx < 0 ? '\u53F3\u5F4E\u7403' : '\u5DE6\u5F4E\u7403';
    if (cy <= -0.28) return speed >= 95 ? '\u9AD8\u540A\u7832' : '\u9AD8\u540A\u7403';
    if (cy >= 0.3) return speed >= 90 ? '\u4F4E\u5E73\u7832' : '\u4F4E\u5E73\u7403';
    if (speed >= 92) return '\u91CD\u7832\u76F4\u7403';
    return '\u76F4\u7DDA\u62BD\u5C04';
  }
  function triggerJuice(G, grade, pv) {
    var pr = H.clamp(((pv || 100) - 90) / 10, 0, 1);
    if (grade === 'PERFECT') { triggerFlash(G, 0.75 + pr * 0.25); showGrade(G, 'PERFECT', '#ffd54a'); G.cameraShakeTimer = 0.10 + pr * 0.07; G.cameraShakeStrength = 0.12 + pr * 0.14; G.slowMoTimer = 0.05 + pr * 0.04; }
    else if (grade === 'GREAT') { triggerFlash(G, 0.48 + pr * 0.28); showGrade(G, 'GREAT', '#7ee787'); G.cameraShakeTimer = 0.07 + pr * 0.05; G.cameraShakeStrength = 0.06 + pr * 0.08; G.slowMoTimer = 0.032 + pr * 0.03; }
    else if ((pv || 0) >= 90) { triggerFlash(G, 0.28 + pr * 0.24); showGrade(G, 'GOOD', '#fff'); G.cameraShakeTimer = 0.05 + pr * 0.04; G.cameraShakeStrength = 0.035 + pr * 0.045; G.slowMoTimer = 0.022 + pr * 0.02; }
  }

  /* ── DOM Building ── */
  function buildGameUI(containerEl, G) {
    var uiParts = [
      { id: 'kg-flash-overlay', style: 'position:absolute;inset:0;background:radial-gradient(circle,rgba(255,255,255,.82) 0%,rgba(255,255,255,.34) 34%,rgba(255,255,255,0) 74%);opacity:0;pointer-events:none;z-index:80;transition:opacity .14s ease-out' },
      { id: 'kg-impact-ring', style: 'position:absolute;width:80px;height:80px;margin-left:-40px;margin-top:-40px;border:3px solid rgba(255,255,255,.7);border-radius:50%;opacity:0;transform:scale(.35);pointer-events:none;z-index:45;transition:transform .22s ease-out,opacity .22s ease-out' },
      { id: 'kg-grade-pop', style: 'position:absolute;left:50%;top:24%;transform:translate(-50%,-50%) scale(.9);color:#fff;font-weight:900;text-shadow:0 3px 12px rgba(0,0,0,.72);opacity:0;pointer-events:none;transition:opacity .16s ease-out,transform .22s ease-out;z-index:85;font-size:clamp(30px,5.5vw,52px)' },
      { id: 'kg-shot-type-pop', style: 'position:absolute;left:50%;top:33%;transform:translate(-50%,-50%) scale(.9);color:#fff;font-weight:900;text-shadow:0 3px 12px rgba(0,0,0,.72);opacity:0;pointer-events:none;transition:opacity .16s ease-out,transform .22s ease-out;z-index:70;font-size:clamp(22px,4.2vw,36px)' },
      { id: 'kg-first-tip', style: 'position:absolute;left:50%;bottom:calc(12% + clamp(52px,13vw,72px) + 1.2em);transform:translateX(-50%);color:rgba(255,236,170,.94);font-size:clamp(18px,3.5vw,28px);font-weight:800;text-shadow:0 2px 10px rgba(0,0,0,.75);opacity:0;pointer-events:none;z-index:65;transition:opacity .2s ease-out;white-space:nowrap', text: '\u9EDE\u7403\u9577\u6309\u958B\u59CB' },
    ];
    containerEl.textContent = '';
    uiParts.forEach(function (p) {
      var el = document.createElement('div'); el.id = p.id; el.style.cssText = p.style;
      if (p.text) el.textContent = p.text;
      containerEl.appendChild(el);
    });
    // Floating UI (aim radar + power bar)
    var floatDiv = document.createElement('div');
    floatDiv.id = 'kg-floating-ui';
    floatDiv.style.cssText = 'position:absolute;transform:translate(-50%,-100%);display:flex;flex-direction:column;align-items:center;gap:12px;z-index:20;pointer-events:none;opacity:0;transition:opacity .15s';
    var radar = document.createElement('div'); radar.id = 'kg-aim-radar';
    radar.style.cssText = 'position:relative;width:100px;height:100px;border-radius:50%;border:4px solid rgba(255,255,255,.25);background:rgba(255,255,255,.03);box-shadow:inset 0 0 0 1px rgba(255,255,255,.08),0 0 12px rgba(0,0,0,.35);overflow:hidden';
    var dot = document.createElement('div'); dot.id = 'kg-aim-dot';
    dot.style.cssText = 'position:absolute;width:20px;height:20px;border-radius:50%;left:50%;top:50%;transform:translate(-50%,-50%);background:rgba(55,55,55,.62);border:3px solid rgba(255,255,255,.95);box-shadow:0 0 8px rgba(0,0,0,.28)';
    radar.appendChild(dot); floatDiv.appendChild(radar);
    var pwWrap = document.createElement('div'); pwWrap.id = 'kg-power-wrap';
    pwWrap.style.cssText = 'width:156px;height:22px;border-radius:11px;overflow:hidden;border:2px solid #fff;background:rgba(0,0,0,.75);display:none';
    var pwFill = document.createElement('div'); pwFill.id = 'kg-power-fill';
    pwFill.style.cssText = 'width:0%;height:100%;background:linear-gradient(90deg,#00bfff 0%,#0057a0 78%,#ff7a00 92%,#ff0000 100%)';
    pwWrap.appendChild(pwFill); floatDiv.appendChild(pwWrap);
    containerEl.appendChild(floatDiv);
    // Session badge
    _buildSessionBadge(containerEl);
    // Bottom UI elements
    _buildBottomUI(containerEl);
    // Bind DOM refs
    _bindDOMRefs(containerEl, G);
  }

  function _buildSessionBadge(containerEl) {
    var badge = document.createElement('div'); badge.id = 'kg-session-badge';
    var topTitle = document.createElement('div'); topTitle.className = 'kg-session-top-title'; topTitle.textContent = '\u672C\u5C40\u8A18\u9304';
    badge.appendChild(topTitle);
    var focusRow = document.createElement('div'); focusRow.className = 'kg-session-focus-row';
    [{ cls: 'dist', label: '\u8DDD\u96E2', id: 'kg-focus-dist', unit: 'm' },
     { cls: 'height', label: '\u9AD8\u5EA6', id: 'kg-focus-height', unit: 'm' },
     { cls: 'speed', label: '\u7403\u901F', id: 'kg-focus-speed', unit: 'km/h' }].forEach(function (item) {
      var box = document.createElement('div'); box.className = 'kg-session-focus-box kg-session-focus-box-' + item.cls;
      var lbl = document.createElement('div'); lbl.className = 'kg-session-focus-label'; lbl.textContent = item.label;
      var val = document.createElement('div'); val.className = 'kg-session-focus-value'; val.id = item.id; val.textContent = '0.00';
      var u = document.createElement('div'); u.className = 'kg-session-focus-unit'; u.textContent = item.unit;
      box.appendChild(lbl); box.appendChild(val); box.appendChild(u); focusRow.appendChild(box);
    });
    badge.appendChild(focusRow);
    var info = document.createElement('div'); info.className = 'kg-session-info';
    var shotsSpan = document.createElement('span'); shotsSpan.textContent = '\u5269\u9918\u8173\u6578: ';
    var shotsNum = document.createElement('span'); shotsNum.id = 'kg-shots-left'; shotsNum.textContent = '3';
    shotsSpan.appendChild(shotsNum); info.appendChild(shotsSpan);
    var sep = document.createElement('span'); sep.className = 'kg-session-sep'; sep.textContent = '\uFF5C'; info.appendChild(sep);
    var windSpan = document.createElement('span'); windSpan.id = 'kg-wind'; windSpan.textContent = '\u7121\u98A8'; info.appendChild(windSpan);
    badge.appendChild(info);
    var bestTitle = document.createElement('div'); bestTitle.className = 'kg-session-title'; bestTitle.textContent = '\u7576\u524D\u6700\u4F73\u8A18\u9304';
    badge.appendChild(bestTitle);
    var bestDiv = document.createElement('div'); bestDiv.className = 'kg-session-best';
    var bdSpan = document.createElement('span'); bdSpan.id = 'kg-best-dist'; bdSpan.textContent = '--';
    bestDiv.appendChild(bdSpan); bestDiv.appendChild(document.createTextNode('m'));
    var bSep = document.createElement('span'); bSep.className = 'kg-session-sep'; bSep.textContent = '|'; bestDiv.appendChild(bSep);
    bestDiv.appendChild(document.createTextNode('\u7403\u901F '));
    var bsSpan = document.createElement('span'); bsSpan.id = 'kg-best-speed'; bsSpan.textContent = '--';
    bestDiv.appendChild(bsSpan); bestDiv.appendChild(document.createTextNode('km/h'));
    badge.appendChild(bestDiv);
    containerEl.appendChild(badge);
  }

  function _buildBottomUI(containerEl) {
    var msgDiv = document.createElement('div'); msgDiv.id = 'kg-msg';
    msgDiv.style.cssText = 'position:absolute;left:50%;top:40%;transform:translate(-50%,-50%);color:#fff;font-size:clamp(18px,4.2vw,28px);font-weight:bold;text-shadow:0 2px 10px rgba(0,0,0,.9);text-align:center;opacity:0;transition:opacity .22s;white-space:nowrap;z-index:10;pointer-events:none';
    containerEl.appendChild(msgDiv);
    var restartWrap = document.createElement('div');
    restartWrap.style.cssText = 'position:absolute;bottom:70px;left:50%;transform:translateX(-50%);z-index:10';
    var restartB = document.createElement('button'); restartB.id = 'kg-restart';
    restartB.style.cssText = 'display:none;border:0;border-radius:8px;padding:12px 29px;background:#e53935;color:#fff;font-weight:bold;font-size:16px;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.25)';
    restartB.textContent = '\u91CD\u65B0\u6311\u6230';
    restartWrap.appendChild(restartB); containerEl.appendChild(restartWrap);
    var vBall = document.createElement('div'); vBall.id = 'kg-virtual-ball';
    vBall.style.cssText = 'position:absolute;left:50%;bottom:12%;transform:translateX(-50%);width:clamp(52px,13vw,72px);height:clamp(52px,13vw,72px);border-radius:50%;background:radial-gradient(circle at 38% 36%,rgba(255,255,255,.38),rgba(255,255,255,.08) 55%,rgba(0,0,0,.12));border:2.5px solid rgba(255,255,255,.45);box-shadow:0 0 18px rgba(0,180,255,.25),inset 0 -3px 8px rgba(0,0,0,.18);cursor:pointer;z-index:18;pointer-events:auto;transition:opacity .18s;display:flex;align-items:center;justify-content:center;font-size:clamp(46px,12vw,66px);line-height:0;user-select:none;overflow:hidden;padding-bottom:2px';
    vBall.textContent = '\u26BD'; containerEl.appendChild(vBall);
    var shotLog = document.createElement('div'); shotLog.id = 'kg-shot-log';
    shotLog.style.cssText = 'position:absolute;left:10px;bottom:68px;z-index:15;display:none;font-size:11px;color:#fff;text-shadow:0 1px 4px rgba(0,0,0,.7);line-height:1.5';
    containerEl.appendChild(shotLog);
    var leftWrap = document.createElement('div');
    leftWrap.style.cssText = 'position:absolute;left:10px;bottom:8px;z-index:15';
    var inlineBtn = document.createElement('button'); inlineBtn.id = 'kg-restart-inline';
    inlineBtn.className = 'kg-lb-btn kg-restart-bottom-btn'; inlineBtn.type = 'button';
    inlineBtn.textContent = '\u91CD\u65B0\u958B\u59CB';
    leftWrap.appendChild(inlineBtn); containerEl.appendChild(leftWrap);
    var rightWrap = document.createElement('div');
    rightWrap.style.cssText = 'position:absolute;right:10px;bottom:8px;z-index:15';
    var lbBtn = document.createElement('button'); lbBtn.id = 'kg-leaderboard-btn-inner';
    lbBtn.className = 'kg-lb-btn'; lbBtn.type = 'button';
    lbBtn.textContent = '\u958B\u7403\u699C';
    rightWrap.appendChild(lbBtn); containerEl.appendChild(rightWrap);
  }

  function _bindDOMRefs(containerEl, G) {
    G.msgEl = containerEl.querySelector('#kg-msg');
    G.bestDistEl = containerEl.querySelector('#kg-best-dist');
    G.bestSpeedEl = containerEl.querySelector('#kg-best-speed');
    G.focusDistEl = containerEl.querySelector('#kg-focus-dist');
    G.focusHeightEl = containerEl.querySelector('#kg-focus-height');
    G.focusSpeedEl = containerEl.querySelector('#kg-focus-speed');
    G.shotsLeftEl = containerEl.querySelector('#kg-shots-left');
    G.windEl = containerEl.querySelector('#kg-wind');
    G.restartBtn = containerEl.querySelector('#kg-restart');
    G.restartInlineBtn = containerEl.querySelector('#kg-restart-inline');
    G.floatingUI = containerEl.querySelector('#kg-floating-ui');
    G.aimRadar = containerEl.querySelector('#kg-aim-radar');
    G.aimDot = containerEl.querySelector('#kg-aim-dot');
    G.powerWrap = containerEl.querySelector('#kg-power-wrap');
    G.powerFill = containerEl.querySelector('#kg-power-fill');
    G.flashOverlay = containerEl.querySelector('#kg-flash-overlay');
    G.impactRing = containerEl.querySelector('#kg-impact-ring');
    G.gradePop = containerEl.querySelector('#kg-grade-pop');
    G.shotTypePop = containerEl.querySelector('#kg-shot-type-pop');
    G.firstTipEl = containerEl.querySelector('#kg-first-tip');
    G.shotLogEl = containerEl.querySelector('#kg-shot-log');
    G.virtualBallEl = containerEl.querySelector('#kg-virtual-ball');
  }

  return {
    showMessage: showMessage,
    showGrade: showGrade,
    showShotType: showShotType,
    triggerFlash: triggerFlash,
    triggerImpactRing: triggerImpactRing,
    classifyShotType: classifyShotType,
    triggerJuice: triggerJuice,
    buildGameUI: buildGameUI,
  };
})();
