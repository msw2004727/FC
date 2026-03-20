/* ================================================
   ColorCat — 角色個人檔案資料
   數值、狀態、個性(MBTI)、心情、裝備
   所有欄位先預留，尚未定義遊戲效果
   ================================================ */
;(function() {

var C = window.ColorCatConfig;

// ── 五項數值（純數字，預設 10） ──
var _stats = {
  stamina: 10,       // 體力
  agility: 10,       // 敏捷
  speed: 10,         // 速度
  luck: 10,          // 幸運
  constitution: 10,  // 體質
  intelligence: 10,  // 智力
};
var STAT_KEYS   = ['stamina', 'agility', 'speed', 'luck', 'constitution', 'intelligence'];
var STAT_LABELS = { stamina: '體力', agility: '敏捷', speed: '速度', luck: '幸運', constitution: '體質', intelligence: '智力' };

// ── 狀態（預留四種，尚未定義效果） ──
var STATUS_LIST = ['正常', '虛弱', '瀕死', '興奮'];
var _status = STATUS_LIST[0];

// ── 個性：MBTI 16 型（預設未定義，先存英文代碼） ──
var MBTI_TYPES = [
  'ISTJ', 'ISFJ', 'INFJ', 'INTJ',
  'ISTP', 'ISFP', 'INFP', 'INTP',
  'ESTP', 'ESFP', 'ENFP', 'ENTP',
  'ESTJ', 'ESFJ', 'ENFJ', 'ENTJ',
];
var _mbti = '----';  // 尚未定義

// ── 心情（預留四種，尚未定義效果） ──
var MOOD_LIST = ['喜', '怒', '哀', '樂'];
var _mood = '----';  // 尚未定義

// ── 裝備欄位 ──
var EQUIP_SLOTS  = ['hat', 'top', 'gloves', 'pants', 'shoes', 'accessory'];
var EQUIP_LABELS = { hat: '帽子', top: '上衣', gloves: '手套', pants: '褲子', shoes: '鞋子', accessory: '飾品' };
var _equipped = { hat: null, top: null, gloves: null, pants: null, shoes: null, accessory: null };

// ── 公開 API ──
window.ColorCatProfile = {
  // 名稱 & 等級
  // TODO: 未來與用戶系統對接時，改為讀取用戶實際名稱
  // 例如：return App.currentUser?.displayName || C.SKINS[skin].name;
  // 或透過 ApiService.getCurrentUser() 取得用戶暱稱
  getName: function() {
    var skin = ColorCatCharacter.getSkin();
    return C.SKINS[skin] ? C.SKINS[skin].name : '???';
  },
  // TODO: 未來與用戶系統對接時，改為讀取用戶實際等級與稱號
  // 例如：var user = App.currentUser;
  //       return 'Lv.' + (user?.level || 1) + ' ' + (user?.title || '見習冒險者');
  // 或透過 ApiService.getUserTitle() 取得稱號
  getLevelText: function() { return 'Lv.1 見習冒險者'; },

  // 五項數值
  STAT_KEYS: STAT_KEYS,
  STAT_LABELS: STAT_LABELS,
  getStats: function() { return _stats; },
  setStat: function(key, val) {
    if (_stats.hasOwnProperty(key)) _stats[key] = Math.max(0, val);
  },

  // 狀態
  STATUS_LIST: STATUS_LIST,
  getStatus: function() { return _status; },
  setStatus: function(s) { if (STATUS_LIST.indexOf(s) !== -1) _status = s; },

  // 個性 (MBTI)
  MBTI_TYPES: MBTI_TYPES,
  getMBTI: function() { return _mbti; },
  setMBTI: function(t) { if (t === '----' || MBTI_TYPES.indexOf(t) !== -1) _mbti = t; },

  // 心情
  MOOD_LIST: MOOD_LIST,
  getMood: function() { return _mood; },
  setMood: function(m) { if (m === '----' || MOOD_LIST.indexOf(m) !== -1) _mood = m; },

  // 裝備
  EQUIP_SLOTS: EQUIP_SLOTS,
  EQUIP_LABELS: EQUIP_LABELS,
  getEquipped: function() { return _equipped; },
  setEquip: function(slot, item) {
    if (EQUIP_LABELS[slot]) _equipped[slot] = item || null;
  },
};

})();
