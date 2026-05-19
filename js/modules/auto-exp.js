/* Legacy path shim.
   Kept for clients whose old Service Worker still serves an older script-loader
   that requests js/modules/auto-exp.js. */
(function () {
  if (typeof App !== 'undefined' && typeof App._getAutoExpRules === 'function') return;

  function loadReplacement(path) {
    var version = (typeof CACHE_VERSION !== 'undefined' && CACHE_VERSION) || Date.now();
    var xhr = new XMLHttpRequest();
    xhr.open('GET', path + '?v=' + encodeURIComponent(version), false);
    xhr.send(null);
    if (xhr.status < 200 || xhr.status >= 300) {
      throw new Error('Failed to load legacy replacement: ' + path + ' (' + xhr.status + ')');
    }
    (0, eval)(xhr.responseText + '\n//# sourceURL=/' + path);
  }

  try {
    loadReplacement('js/modules/auto-exp/index.js');
  } catch (err) {
    console.error('[legacy-auto-exp] failed:', err);
  }
})();
