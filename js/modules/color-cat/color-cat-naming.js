/* ================================================
   ColorCat — 角色命名 UI 模組
   提供首次遊玩時的角色命名 overlay 及後續改名功能
   依賴：ColorCatConfig, ColorCatStats, ColorCatCharacter, App
   ================================================ */
;(function () {
  'use strict';

  var C = window.ColorCatConfig;
  var MIN_LEN = 2;
  var MAX_LEN = 12;

  function _isDark() {
    return document.documentElement.getAttribute('data-theme') === 'dark';
  }

  function _sanitize(s) {
    return String(s).trim().replace(/[<>&"']/g, '');
  }

  function _defaultName() {
    var skin = window.ColorCatCharacter ? window.ColorCatCharacter.getSkin() : 'whiteCat';
    return (C.SKINS[skin] || C.SKINS.whiteCat).name;
  }

  function _lineName() {
    try { return window.App && window.App.currentUser ? window.App.currentUser.displayName : ''; }
    catch (e) { return ''; }
  }

  /* ---------- public: getCurrentName ---------- */
  function getCurrentName() {
    var stats = window.ColorCatStats;
    var saved = stats && stats.base ? stats.base.name : '';
    return saved || _defaultName();
  }

  /* ---------- public: setName ---------- */
  function setName(raw) {
    var clean = _sanitize(raw);
    if (clean.length < MIN_LEN || clean.length > MAX_LEN) return false;
    if (window.ColorCatStats && window.ColorCatStats.base) {
      window.ColorCatStats.base.name = clean;
    }
    return true;
  }

  /* ---------- public: showNameDialog ---------- */
  function showNameDialog(callback) {
    var dark = _isDark();
    var bg = dark ? 'rgba(0,0,0,0.82)' : 'rgba(0,0,0,0.55)';
    var panelBg = dark ? '#1e1e2e' : '#fff';
    var textCol = dark ? '#e0e0e0' : '#222';
    var borderCol = dark ? '#444' : '#ccc';
    var btnBg = dark ? '#5b6eae' : '#4a7dff';
    var hasPrev = !!(window.ColorCatStats && window.ColorCatStats.base && window.ColorCatStats.base.name);
    var defName = _defaultName();
    var line = _lineName();

    // overlay
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:10001;'
      + 'display:flex;align-items:center;justify-content:center;background:' + bg;

    // panel
    var pn = document.createElement('div');
    pn.style.cssText = 'background:' + panelBg + ';color:' + textCol
      + ';border-radius:12px;padding:24px 20px;min-width:260px;max-width:340px;'
      + 'text-align:center;font-family:sans-serif;box-shadow:0 4px 20px rgba(0,0,0,0.3)';

    var html = '<div style="font-size:18px;font-weight:bold;margin-bottom:12px">'
      + '\u70ba\u4f60\u7684\u89d2\u8272\u53d6\u540d</div>';

    if (line) {
      html += '<div style="font-size:13px;color:#888;margin-bottom:10px">'
        + 'LINE \u66b1\u7a31\uff1a ' + _sanitize(line) + '</div>';
    }

    html += '<input id="ccn-input" type="text" maxlength="' + MAX_LEN + '" placeholder="' + defName
      + '" style="width:85%;padding:8px 10px;font-size:16px;border:1px solid ' + borderCol
      + ';border-radius:6px;background:' + (dark ? '#2a2a3c' : '#f8f8f8')
      + ';color:' + textCol + ';outline:none;box-sizing:border-box" />';

    html += '<div id="ccn-count" style="font-size:12px;color:#888;margin:6px 0 14px">0 / '
      + MAX_LEN + ' (\u81f3\u5c11 ' + MIN_LEN + ' \u5b57)</div>';

    html += '<div style="display:flex;gap:10px;justify-content:center">';
    if (hasPrev) {
      html += '<button id="ccn-cancel" style="padding:8px 18px;border-radius:6px;border:1px solid '
        + borderCol + ';background:transparent;color:' + textCol
        + ';font-size:15px;cursor:pointer">\u53d6\u6d88</button>';
    }
    html += '<button id="ccn-ok" style="padding:8px 22px;border-radius:6px;border:none;background:'
      + btnBg + ';color:#fff;font-size:15px;cursor:pointer;opacity:0.4" disabled>\u78ba\u8a8d</button>';
    html += '</div>';

    pn.innerHTML = html;
    ov.appendChild(pn);
    document.body.appendChild(ov);

    var inp = document.getElementById('ccn-input');
    var cnt = document.getElementById('ccn-count');
    var okBtn = document.getElementById('ccn-ok');
    var canBtn = document.getElementById('ccn-cancel');

    if (hasPrev) inp.value = window.ColorCatStats.base.name;

    function updateCount() {
      var len = _sanitize(inp.value).length;
      cnt.textContent = len + ' / ' + MAX_LEN + ' (\u81f3\u5c11 ' + MIN_LEN + ' \u5b57)';
      var valid = len >= MIN_LEN && len <= MAX_LEN;
      okBtn.disabled = !valid;
      okBtn.style.opacity = valid ? '1' : '0.4';
    }
    inp.addEventListener('input', updateCount);
    updateCount();

    function close() { if (ov.parentNode) ov.parentNode.removeChild(ov); }

    function confirm() {
      var val = _sanitize(inp.value);
      if (val.length < MIN_LEN || val.length > MAX_LEN) return;
      setName(val);
      close();
      if (typeof callback === 'function') callback(val);
    }

    okBtn.addEventListener('click', confirm);
    okBtn.addEventListener('touchend', function (e) { e.preventDefault(); confirm(); });

    if (canBtn) {
      canBtn.addEventListener('click', close);
      canBtn.addEventListener('touchend', function (e) { e.preventDefault(); close(); });
    }

    setTimeout(function () { inp.focus(); }, 100);
  }

  /* ---------- expose ---------- */
  window.ColorCatNaming = {
    showNameDialog: showNameDialog,
    getCurrentName: getCurrentName,
    setName: setName
  };
})();
