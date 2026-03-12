/* ================================================
   SportHub Achievement Module Registry
   Keeps the legacy facade stable while internals
   move into js/modules/achievement/.
   ================================================ */

Object.assign(App, {

  _ensureAchievementModule() {
    if (this._achievementModule) return this._achievementModule;
    this._achievementModule = {
      registry: null,
      shared: null,
      stats: null,
      evaluator: null,
    };
    return this._achievementModule;
  },

  _registerAchievementPart(key, value) {
    const mod = this._ensureAchievementModule();
    mod[key] = value;
    return value;
  },

  _getAchievementPart(key) {
    const mod = this._ensureAchievementModule();
    return mod[key] || null;
  },

  _getAchievementRegistry() {
    return this._getAchievementPart('registry');
  },

  _getAchievementShared() {
    return this._getAchievementPart('shared');
  },

  _getAchievementStats() {
    return this._getAchievementPart('stats');
  },

  _getAchievementEvaluator() {
    return this._getAchievementPart('evaluator');
  },

});

App._ensureAchievementModule();
