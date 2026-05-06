/* ================================================
   ToosterX - Scoreboard Config
   Single-doc config for homepage score/schedule placeholders.
   ================================================ */

(function(root) {
  const SOURCE_CATALOG = [
    { id: 'premier_league', label: '英超', sport: 'football', sourceKey: 'football_epl' },
    { id: 'laliga', label: '西甲', sport: 'football', sourceKey: 'football_laliga' },
    { id: 'serie_a', label: '義甲', sport: 'football', sourceKey: 'football_serie_a' },
    { id: 'bundesliga', label: '德甲', sport: 'football', sourceKey: 'football_bundesliga' },
    { id: 'ligue_1', label: '法甲', sport: 'football', sourceKey: 'football_ligue_1' },
    { id: 'champions_league', label: '歐冠', sport: 'football', sourceKey: 'football_ucl' },
    { id: 'europa_league', label: '歐聯', sport: 'football', sourceKey: 'football_uel' },
    { id: 'world_cup', label: '世界盃', sport: 'football', sourceKey: 'football_world_cup' },
    { id: 'nba', label: 'NBA', sport: 'basketball', sourceKey: 'basketball_nba' },
    { id: 'badminton', label: '羽球', sport: 'badminton', sourceKey: 'badminton_general' },
    { id: 'olympics', label: '奧運', sport: 'multi', sourceKey: 'olympics_general' },
  ];

  const DEFAULT_ORDER = [
    'premier_league',
    'laliga',
    'serie_a',
    'bundesliga',
    'ligue_1',
    'champions_league',
    'europa_league',
    'world_cup',
  ];

  function defaultSources() {
    return SOURCE_CATALOG.reduce((acc, item) => {
      acc[item.id] = {
        enabled: DEFAULT_ORDER.includes(item.id),
        label: item.label,
        sport: item.sport,
        sourceKey: item.sourceKey,
        sortOrder: DEFAULT_ORDER.indexOf(item.id) >= 0 ? DEFAULT_ORDER.indexOf(item.id) + 1 : 99,
      };
      return acc;
    }, {});
  }

  function defaultConfig() {
    return {
      schemaVersion: 1,
      homepageEnabled: true,
      homepageOrder: DEFAULT_ORDER.slice(),
      sources: defaultSources(),
    };
  }

  function toBool(value, fallback) {
    return typeof value === 'boolean' ? value : fallback;
  }

  function normalizeOrder(order, sources) {
    const allowed = new Set(SOURCE_CATALOG.map(item => item.id));
    const selected = Array.isArray(order)
      ? order.map(item => String(item || '').trim()).filter(id => allowed.has(id))
      : [];
    const unique = Array.from(new Set(selected));
    Object.entries(sources || {})
      .filter(([, src]) => src && src.enabled !== false)
      .sort((a, b) => Number(a[1].sortOrder || 99) - Number(b[1].sortOrder || 99))
      .forEach(([id]) => {
        if (!unique.includes(id)) unique.push(id);
      });
    return unique.slice(0, SOURCE_CATALOG.length);
  }

  function normalizeConfig(raw) {
    const base = defaultConfig();
    const input = raw && typeof raw === 'object' ? raw : {};
    const inputSources = input.sources && typeof input.sources === 'object' ? input.sources : {};
    const sources = {};

    SOURCE_CATALOG.forEach(item => {
      const src = inputSources[item.id] || {};
      const fallback = base.sources[item.id];
      sources[item.id] = {
        enabled: toBool(src.enabled, fallback.enabled),
        label: String(src.label || fallback.label).slice(0, 24),
        sport: item.sport,
        sourceKey: String(src.sourceKey || fallback.sourceKey).slice(0, 48),
        sortOrder: Math.max(1, Math.min(999, Number(src.sortOrder || fallback.sortOrder || 99))),
      };
    });

    return {
      schemaVersion: 1,
      homepageEnabled: toBool(input.homepageEnabled, true),
      homepageOrder: normalizeOrder(input.homepageOrder, sources),
      sources,
    };
  }

  async function loadScoreboardConfig() {
    const cached = root.FirebaseService?.getCachedDoc?.('siteConfig', 'scoreboardConfig');
    if (cached) return normalizeConfig(cached);
    const doc = await root.FirebaseService?.ensureSingleDocLoaded?.('siteConfig', 'scoreboardConfig');
    return normalizeConfig(doc || {});
  }

  async function saveScoreboardConfig(config) {
    const payload = normalizeConfig(config);
    payload.updatedAt = root.firebase?.firestore?.FieldValue?.serverTimestamp?.() || new Date().toISOString();
    if (!root.db) throw new Error('Firestore 尚未初始化');
    await root.db.collection('siteConfig').doc('scoreboardConfig').set(payload, { merge: true });
    if (root.FirebaseService?._singleDocCache) {
      root.FirebaseService._singleDocCache['siteConfig/scoreboardConfig'] = { ...payload };
    }
    return payload;
  }

  root.ScoreboardConfigUtils = {
    SOURCE_CATALOG,
    DEFAULT_ORDER,
    defaultConfig,
    normalizeConfig,
  };

  Object.assign(root.App, {
    async loadScoreboardConfig() {
      this._scoreboardConfig = await loadScoreboardConfig();
      return this._scoreboardConfig;
    },

    async saveScoreboardConfig(config) {
      this._scoreboardConfig = await saveScoreboardConfig(config);
      return this._scoreboardConfig;
    },
  });
})(typeof window !== 'undefined' ? window : globalThis);
