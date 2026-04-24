/* ================================================
   ToosterX — Event Calendar Constants
   運動色對照、月份/週天格式化、日期 key normalize
   ================================================ */

/**
 * 8 種熱門運動啟用色 + 7 種結構預留 + 1 種備援
 * 未來啟用某個預留運動：改 css/calendar.css 的 CSS 變數即可，不需動 JS
 */
const SPORT_COLORS = Object.freeze({
  // 啟用運動（8）— emoji 與 config.js SPORT_ICON_EMOJI 對齊
  football:     { var: '--sport-football',     emoji: '⚽', label: '足球',     enabled: true },
  basketball:   { var: '--sport-basketball',   emoji: '🏀', label: '籃球',     enabled: true },
  pickleball:   { var: '--sport-pickleball',   emoji: '🏓', label: '匹克球',   enabled: true },
  dodgeball:    { var: '--sport-dodgeball',    emoji: '🤾', label: '美式躲避球', enabled: true },
  running:      { var: '--sport-running',      emoji: '🏃', label: '跑步',     enabled: true },
  hiking:       { var: '--sport-hiking',       emoji: '🥾', label: '登山健行',  enabled: true },
  badminton:    { var: '--sport-badminton',    emoji: '🏸', label: '羽球',     enabled: true },
  swimming:     { var: '--sport-swimming',     emoji: '🏊', label: '游泳',     enabled: true },
  // 結構預留（未啟用、fallback 灰）
  volleyball:   { var: '--sport-volleyball',   emoji: '🏐', label: '排球',     enabled: false },
  tennis:       { var: '--sport-tennis',       emoji: '🎾', label: '網球',     enabled: false },
  table_tennis: { var: '--sport-table-tennis', emoji: '🏓', label: '桌球',     enabled: false },
  baseball:     { var: '--sport-baseball',     emoji: '⚾', label: '棒球',     enabled: false },
  softball:     { var: '--sport-softball',     emoji: '🥎', label: '壘球',     enabled: false },
  fitness:      { var: '--sport-fitness',      emoji: '💪', label: '健身',     enabled: false },
  cycling:      { var: '--sport-cycling',      emoji: '🚴', label: '自行車',   enabled: false },
  // 備援
  other:        { var: '--sport-other',        emoji: '🏃', label: '其他',     enabled: true },
});

/**
 * 取得運動色定義（含 fallback 保險）
 * - emoji：優先從平台統一的 SPORT_ICON_EMOJI（js/config.js）取、對齊運動分類圖示
 *          SPORT_COLORS 內的 emoji 僅作為 SPORT_ICON_EMOJI 沒有該 key 時的備援
 * - var / label / enabled：用 SPORT_COLORS 的月曆自訂配色
 * @param {string} sportTag - event.sportTag
 * @returns {{var: string, emoji: string, label: string, enabled: boolean}}
 */
function getSportDef(sportTag) {
  const def = SPORT_COLORS[sportTag] || SPORT_COLORS.other;
  const platformEmoji = (typeof SPORT_ICON_EMOJI !== 'undefined')
    ? SPORT_ICON_EMOJI[sportTag]
    : null;
  return {
    var: def.var,
    label: def.label,
    enabled: def.enabled,
    emoji: platformEmoji || def.emoji,
  };
}

/**
 * 週一起始的週天標題（ISO 8601 + 台灣習慣）
 */
const WEEK_DAY_NAMES = Object.freeze(['一', '二', '三', '四', '五', '六', '日']);

/**
 * 月份名稱 formatter — 用 Intl.DateTimeFormat 支援 locale 切換（i18n 預留）
 * 未來多語系：改 App.currentLocale 或手動傳入即可
 */
const MONTH_FORMATTER = new Intl.DateTimeFormat('zh-TW', {
  year: 'numeric',
  month: 'long',
});

/**
 * 將 event.date（"YYYY/M/D HH:mm~HH:mm"）轉成 padded YYYY-MM-DD
 * 與 data-date-anchor / 月曆 group key 一致
 * 範例："2026/5/1 19:30~21:00" → "2026-05-01"
 * @param {string} eventDate
 * @returns {string} "YYYY-MM-DD" 或空字串（失敗時）
 */
function toDateKey(eventDate) {
  if (!eventDate || typeof eventDate !== 'string') return '';
  const parts = eventDate.split(' ')[0].split('/');
  if (parts.length < 3) return '';
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const d = parseInt(parts[2], 10);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return '';
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * 將 Date(y, m-1, d) 轉成 padded YYYY-MM-DD（配合月曆格 data-date）
 */
function dateObjToKey(dateObj) {
  if (!(dateObj instanceof Date) || isNaN(dateObj)) return '';
  const y = dateObj.getFullYear();
  const m = dateObj.getMonth() + 1;
  const d = dateObj.getDate();
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * 取得指定月份的格子結構（動態 5/6 週，週一起始）
 * @param {number} year
 * @param {number} month - 0~11
 * @returns {{ firstWeekday: number, daysInMonth: number, weekRows: number, totalCells: number }}
 */
function getMonthGridShape(year, month) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  // 週一起始：把 getDay 的 0(日)~6(六) 轉成 0(一)~6(日)
  const firstWeekday = (firstDay.getDay() + 6) % 7;
  const daysInMonth = lastDay.getDate();
  const totalCells = firstWeekday + daysInMonth;
  const weekRows = Math.ceil(totalCells / 7);
  return { firstWeekday, daysInMonth, weekRows, totalCells };
}

/**
 * DOM 回收門檻（月曆預載超過此數量時、最遠月自動回收）
 * 見 calendar-view-plan §12.V
 */
const DOM_RECYCLE_THRESHOLD = 5;

/**
 * 月份邊界：過去最多 3 個月、未來無限
 */
const MAX_PAST_MONTHS = 3;
