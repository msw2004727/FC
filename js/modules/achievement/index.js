/* ================================================
   SportHub — Achievement Module Facade Registry
   建立 achievement 領域模組容器，供舊入口逐步轉接
   ================================================ */

Object.assign(App, {

  _ensureAchievementModule() {
    if (this._achievementModule) return this._achievementModule;
    this._achievementModule = {
      registry: null,
      shared: null,
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

  _getAchievementEvaluator() {
    return this._getAchievementPart('evaluator');
  },

});

App._ensureAchievementModule();
