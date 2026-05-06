/* ================================================
   ToosterX - Scoreboard Config
   Public-safe SportsAPI Pro display settings.
   ================================================ */

(function(root) {
  const app = (typeof App !== 'undefined') ? App : root.App;
  if (!app) return;
  root.App = app;

  const SPORT_CATALOG = [
    { key: 'football', label: '足球', icon: '⚽', apiSport: 'football', sourceKey: 'sportsapipro_v2_football', defaultEnabled: true },
    { key: 'basketball', label: '籃球 / NBA', icon: '🏀', apiSport: 'basketball', sourceKey: 'sportsapipro_v2_basketball', defaultEnabled: true },
    { key: 'tennis', label: '網球', icon: '🎾', apiSport: 'tennis', sourceKey: 'sportsapipro_v2_tennis', defaultEnabled: true },
    { key: 'mma', label: '綜合格鬥', icon: '🥊', apiSport: 'mma', sourceKey: 'sportsapipro_v2_mma' },
    { key: 'american_football', label: '美式足球', icon: '🏈', apiSport: 'american-football', sourceKey: 'sportsapipro_v2_american_football' },
    { key: 'ice_hockey', label: '冰球', icon: '🏒', apiSport: 'ice-hockey', sourceKey: 'sportsapipro_v2_ice_hockey' },
    { key: 'rugby', label: '橄欖球', icon: '🏉', apiSport: 'rugby', sourceKey: 'sportsapipro_v2_rugby' },
    { key: 'baseball', label: '棒壘球', icon: '⚾', apiSport: 'baseball', sourceKey: 'sportsapipro_v2_baseball', defaultEnabled: true },
    { key: 'handball', label: '手球', icon: '🤾', apiSport: 'handball', sourceKey: 'sportsapipro_v2_handball' },
    { key: 'volleyball', label: '排球', icon: '🏐', apiSport: 'volleyball', sourceKey: 'sportsapipro_v2_volleyball' },
    { key: 'table_tennis', label: '桌球', icon: '🏓', apiSport: 'table-tennis', sourceKey: 'sportsapipro_v2_table_tennis' },
    { key: 'badminton', label: '羽球', icon: '🏸', apiSport: 'badminton', sourceKey: 'sportsapipro_v2_badminton', defaultEnabled: true },
    { key: 'esports', label: '電競', icon: '🎮', apiSport: 'esports', sourceKey: 'sportsapipro_v2_esports' },
    { key: 'darts', label: '飛鏢', icon: '🎯', apiSport: 'darts', sourceKey: 'sportsapipro_v2_darts' },
    { key: 'cricket', label: '板球', icon: '🏏', apiSport: 'cricket', sourceKey: 'sportsapipro_v2_cricket' },
    { key: 'motorsport', label: '賽車', icon: '🏁', apiSport: 'motorsport', sourceKey: 'sportsapipro_v2_motorsport' },
    { key: 'futsal', label: '五人制足球', icon: '⚽', apiSport: 'futsal', sourceKey: 'sportsapipro_v2_futsal' },
    { key: 'water_polo', label: '水球', icon: '🤽', apiSport: 'water-polo', sourceKey: 'sportsapipro_v2_water_polo' },
    { key: 'snooker', label: '司諾克 / 撞球', icon: '🎱', apiSport: 'snooker', sourceKey: 'sportsapipro_v2_snooker' },
    { key: 'aussie_rules', label: '澳式足球', icon: '🏉', apiSport: 'aussie-rules', sourceKey: 'sportsapipro_v2_aussie_rules' },
    { key: 'cycling', label: '自行車', icon: '🚴', apiSport: 'cycling', sourceKey: 'sportsapipro_v2_cycling' },
    { key: 'beach_volleyball', label: '沙灘排球', icon: '🏖️', apiSport: 'beach-volleyball', sourceKey: 'sportsapipro_v2_beach_volleyball' },
    { key: 'minifootball', label: '迷你足球', icon: '⚽', apiSport: 'minifootball', sourceKey: 'sportsapipro_v2_minifootball' },
    { key: 'floorball', label: '地板球', icon: '🏑', apiSport: 'floorball', sourceKey: 'sportsapipro_v2_floorball' },
    { key: 'bandy', label: '班迪球', icon: '🏒', apiSport: 'bandy', sourceKey: 'sportsapipro_v2_bandy' },
    { key: 'boxing', label: '拳擊', icon: '🥊', apiSport: 'boxing', sourceKey: 'sportsapipro_v2_boxing' },
    { key: 'rugby_league', label: '聯盟式橄欖球', icon: '🏉', apiSport: 'rugby-league', sourceKey: 'sportsapipro_v2_rugby_league' },
    { key: 'golf', label: '高爾夫', icon: '⛳', apiSport: 'golf', sourceKey: 'sportsapipro_v2_golf' },
    { key: 'field_hockey', label: '曲棍球', icon: '🏑', apiSport: 'field-hockey', sourceKey: 'sportsapipro_v2_field_hockey' },
    { key: 'beach_soccer', label: '沙灘足球', icon: '⚽', apiSport: 'beach-soccer', sourceKey: 'sportsapipro_v2_beach_soccer' },
    { key: 'netball', label: '籃網球', icon: '🏐', apiSport: 'netball', sourceKey: 'sportsapipro_v2_netball' },
    { key: 'pesapallo', label: '芬蘭棒球', icon: '⚾', apiSport: 'pesapallo', sourceKey: 'sportsapipro_v2_pesapallo' },
    { key: 'horse_racing', label: '賽馬', icon: '🏇', apiSport: 'horse-racing', sourceKey: 'sportsapipro_v2_horse_racing' },
    { key: 'winter_sports', label: '冬季運動', icon: '⛷️', apiSport: 'winter-sports', sourceKey: 'sportsapipro_v2_winter_sports' },
    { key: 'kabaddi', label: '卡巴迪', icon: '🤼', apiSport: 'kabaddi', sourceKey: 'sportsapipro_v2_kabaddi' },
  ].map((item, index) => ({ sortOrder: index + 1, defaultEnabled: false, icon: '🏟️', ...item }));

  const FEATURED_SOURCE_CATALOG = [
    { id: 'premier_league', label: '英超', sport: 'football', matchKeywords: ['premier league', 'epl'], defaultEnabled: true },
    { id: 'laliga', label: '西甲', sport: 'football', matchKeywords: ['laliga', 'la liga'], defaultEnabled: true },
    { id: 'serie_a', label: '義甲', sport: 'football', matchKeywords: ['serie a'], defaultEnabled: true },
    { id: 'bundesliga', label: '德甲', sport: 'football', matchKeywords: ['bundesliga'], defaultEnabled: true },
    { id: 'ligue_1', label: '法甲', sport: 'football', matchKeywords: ['ligue 1'], defaultEnabled: true },
    { id: 'champions_league', label: '歐冠', sport: 'football', matchKeywords: ['champions league'], defaultEnabled: true },
    { id: 'europa_league', label: '歐聯', sport: 'football', matchKeywords: ['europa league'], defaultEnabled: true },
    { id: 'world_cup', label: '世界盃', sport: 'football', matchKeywords: ['world cup'], defaultEnabled: true },
    { id: 'nba', label: 'NBA', sport: 'basketball', matchKeywords: ['nba', 'national basketball association'], defaultEnabled: true },
    { id: 'mlb', label: 'MLB', sport: 'baseball', matchKeywords: ['mlb', 'major league baseball'], defaultEnabled: false },
    { id: 'bwf', label: 'BWF 羽球', sport: 'badminton', matchKeywords: ['bwf', 'badminton world federation'], defaultEnabled: false },
  ].map((item, index) => ({ sortOrder: index + 1, ...item }));

  const SPORT_KEYS = SPORT_CATALOG.map(item => item.key);
  const FEATURED_KEYS = FEATURED_SOURCE_CATALOG.map(item => item.id);
  const DEFAULT_ENABLED_SPORTS = SPORT_CATALOG.filter(item => item.defaultEnabled).map(item => item.key);
  const DEFAULT_FEATURED_SOURCES = FEATURED_SOURCE_CATALOG.filter(item => item.defaultEnabled).map(item => item.id);

  function uniqueList(value, allowedKeys, fallback) {
    if (!Array.isArray(value)) return fallback.slice();
    const allowed = new Set(allowedKeys);
    const result = [];
    value.map(item => String(item || '').trim()).forEach(item => {
      if (allowed.has(item) && !result.includes(item)) result.push(item);
    });
    return result;
  }

  function toBool(value, fallback) {
    return typeof value === 'boolean' ? value : fallback;
  }

  function defaultSources() {
    return FEATURED_SOURCE_CATALOG.reduce((acc, item) => {
      acc[item.id] = {
        enabled: item.defaultEnabled === true,
        sport: item.sport,
        label: item.label,
        matchKeywords: item.matchKeywords.slice(),
        sortOrder: item.sortOrder,
      };
      return acc;
    }, {});
  }

  function defaultConfig() {
    return normalizeConfig({
      schemaVersion: 2,
      homepageEnabled: true,
      publicPageEnabled: true,
      enabledSports: DEFAULT_ENABLED_SPORTS,
      homepageSports: DEFAULT_ENABLED_SPORTS,
      liveSports: DEFAULT_ENABLED_SPORTS,
      scheduleSports: DEFAULT_ENABLED_SPORTS,
      detailSports: DEFAULT_ENABLED_SPORTS,
      sportsOrder: SPORT_KEYS,
      defaultSportTabs: DEFAULT_ENABLED_SPORTS,
      enabledFeaturedSources: DEFAULT_FEATURED_SOURCES,
      featuredSourceOrder: FEATURED_KEYS,
      homepageOrder: DEFAULT_FEATURED_SOURCES,
    });
  }

  function normalizeLegacySources(input) {
    const inputSources = input.sources && typeof input.sources === 'object' ? input.sources : {};
    return FEATURED_SOURCE_CATALOG.reduce((acc, item) => {
      const src = inputSources[item.id] || {};
      acc[item.id] = {
        enabled: toBool(src.enabled, item.defaultEnabled === true),
        sport: item.sport,
        label: String(src.label || item.label).slice(0, 24),
        matchKeywords: Array.isArray(src.matchKeywords) ? src.matchKeywords.slice(0, 12) : item.matchKeywords.slice(),
        sortOrder: Math.max(1, Math.min(999, Number(src.sortOrder || item.sortOrder || 99))),
      };
      return acc;
    }, {});
  }

  function normalizeConfig(raw) {
    const input = raw && typeof raw === 'object' ? raw : {};
    const legacySources = normalizeLegacySources(input);
    const enabledSports = uniqueList(input.enabledSports, SPORT_KEYS, DEFAULT_ENABLED_SPORTS);
    const homepageSports = uniqueList(input.homepageSports, SPORT_KEYS, enabledSports);
    const liveSports = uniqueList(input.liveSports, SPORT_KEYS, enabledSports);
    const scheduleSports = uniqueList(input.scheduleSports, SPORT_KEYS, enabledSports);
    const detailSports = uniqueList(input.detailSports, SPORT_KEYS, enabledSports);
    const sportsOrder = uniqueList(input.sportsOrder, SPORT_KEYS, SPORT_KEYS);
    const enabledFeaturedSources = uniqueList(
      input.enabledFeaturedSources,
      FEATURED_KEYS,
      Object.entries(legacySources).filter(([, src]) => src.enabled !== false).map(([id]) => id)
    );
    const featuredSourceOrder = uniqueList(input.featuredSourceOrder, FEATURED_KEYS, FEATURED_KEYS);
    const homepageOrder = uniqueList(input.homepageOrder, [...FEATURED_KEYS, ...SPORT_KEYS], enabledFeaturedSources);
    const defaultSportTabs = uniqueList(input.defaultSportTabs, SPORT_KEYS, enabledSports).filter(key => enabledSports.includes(key));

    const sports = SPORT_CATALOG.reduce((acc, item) => {
      acc[item.key] = {
        enabled: enabledSports.includes(item.key),
        homepageEnabled: homepageSports.includes(item.key),
        liveEnabled: liveSports.includes(item.key),
        scheduleEnabled: scheduleSports.includes(item.key),
        detailEnabled: detailSports.includes(item.key),
        label: item.label,
        apiSport: item.apiSport,
        sourceKey: item.sourceKey,
        sortOrder: sportsOrder.indexOf(item.key) >= 0 ? sportsOrder.indexOf(item.key) + 1 : item.sortOrder,
      };
      return acc;
    }, {});

    const featuredSources = FEATURED_SOURCE_CATALOG.reduce((acc, item) => {
      const legacy = legacySources[item.id] || {};
      acc[item.id] = {
        enabled: enabledFeaturedSources.includes(item.id),
        sport: item.sport,
        label: legacy.label || item.label,
        matchKeywords: Array.isArray(legacy.matchKeywords) ? legacy.matchKeywords.slice(0, 12) : item.matchKeywords.slice(),
        sortOrder: featuredSourceOrder.indexOf(item.id) >= 0 ? featuredSourceOrder.indexOf(item.id) + 1 : item.sortOrder,
      };
      return acc;
    }, {});

    return {
      schemaVersion: 2,
      homepageEnabled: toBool(input.homepageEnabled, true),
      publicPageEnabled: toBool(input.publicPageEnabled, true),
      enabledSports,
      homepageSports,
      liveSports,
      scheduleSports,
      detailSports,
      sportsOrder,
      defaultSportTabs,
      enabledFeaturedSources,
      featuredSourceOrder,
      homepageOrder,
      sports,
      featuredSources,
      sources: legacySources,
    };
  }

  function toPersistedConfig(config) {
    const normalized = normalizeConfig(config);
    return {
      schemaVersion: 2,
      homepageEnabled: normalized.homepageEnabled,
      publicPageEnabled: normalized.publicPageEnabled,
      homepageOrder: normalized.homepageOrder,
      defaultSportTabs: normalized.defaultSportTabs,
      enabledSports: normalized.enabledSports,
      homepageSports: normalized.homepageSports,
      liveSports: normalized.liveSports,
      scheduleSports: normalized.scheduleSports,
      detailSports: normalized.detailSports,
      sportsOrder: normalized.sportsOrder,
      enabledFeaturedSources: normalized.enabledFeaturedSources,
      featuredSourceOrder: normalized.featuredSourceOrder,
    };
  }

  function firebaseService() {
    return (typeof FirebaseService !== 'undefined') ? FirebaseService : root.FirebaseService;
  }

  function firestoreDb() {
    return (typeof db !== 'undefined') ? db : root.db;
  }

  async function loadScoreboardConfig() {
    const cached = firebaseService()?.getCachedDoc?.('siteConfig', 'scoreboardConfig');
    if (cached) return normalizeConfig(cached);
    const doc = await firebaseService()?.ensureSingleDocLoaded?.('siteConfig', 'scoreboardConfig');
    return normalizeConfig(doc || {});
  }

  async function saveScoreboardConfig(config) {
    const payload = toPersistedConfig(config);
    payload.updatedAt = root.firebase?.firestore?.FieldValue?.serverTimestamp?.() || new Date().toISOString();
    const dbRef = firestoreDb();
    if (!dbRef) throw new Error('Firestore 尚未初始化');
    await dbRef.collection('siteConfig').doc('scoreboardConfig').set(payload, { merge: true });
    const service = firebaseService();
    if (service?._singleDocCache) {
      service._singleDocCache['siteConfig/scoreboardConfig'] = { ...payload };
    }
    return normalizeConfig(payload);
  }

  root.ScoreboardConfigUtils = {
    SPORT_CATALOG,
    FEATURED_SOURCE_CATALOG,
    SOURCE_CATALOG: FEATURED_SOURCE_CATALOG,
    DEFAULT_ORDER: DEFAULT_FEATURED_SOURCES,
    defaultConfig,
    normalizeConfig,
    toPersistedConfig,
  };

  Object.assign(app, {
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
