import { groupLabel } from './berger.js';
import type { DrawRule, Format, RankSource, Slot, TeamSource } from './types.js';

/**
 * 賽制範本與排名規則｜Formats & RankingRules
 * ------------------------------------------------------------------
 * 規格：docs/02-賽制引擎與排名規則.md §2、§3、§6
 *
 * 這份是「種子資料的來源」，執行時的權威來源是 Firestore 的
 * config/formats 與 config/rankingRules —— 主辦可在後台改，不需要改程式。
 * scripts/seed.js 會把這裡的內容寫進 Firestore。
 *
 * 純資料、零依賴，前端與 Cloud Functions 都可直接引用。
 */

// ══════════════════════════════════════════════════════════════════
//  Formats
// ══════════════════════════════════════════════════════════════════

/** 8 隊：兩組循環 ＋ 交叉排名（1–8 名全排）。每隊 5 場，共 20 場。 */
const F8_GROUP_CROSS = {
  formatId: 'F8_GROUP_CROSS',
  name: '8隊 兩組循環＋交叉排名（1–8名全排）',
  teamCount: 8,
  description: '每隊固定 5 場，單組別共 20 場',
  stages: [
    {
      stageId: 'group', name: '分組循環', type: 'roundRobin', order: 1,
      groupCount: 2, groupSize: 4, legs: 1, seedingMethod: 'snake'
    },
    {
      stageId: 'placement', name: '交叉賽', type: 'knockout', order: 2,
      drawRule: 'penalty',
      slots: [
        { matchKey: 'SF1', label: '準決賽①', round: 1,
          home: { type: 'standing', stageId: 'group', groupId: 'A', rank: 1 },
          away: { type: 'standing', stageId: 'group', groupId: 'B', rank: 2 } },
        { matchKey: 'SF2', label: '準決賽②', round: 1,
          home: { type: 'standing', stageId: 'group', groupId: 'B', rank: 1 },
          away: { type: 'standing', stageId: 'group', groupId: 'A', rank: 2 } },
        { matchKey: 'PF1', label: '5-8名賽①', round: 1,
          home: { type: 'standing', stageId: 'group', groupId: 'A', rank: 3 },
          away: { type: 'standing', stageId: 'group', groupId: 'B', rank: 4 } },
        { matchKey: 'PF2', label: '5-8名賽②', round: 1,
          home: { type: 'standing', stageId: 'group', groupId: 'B', rank: 3 },
          away: { type: 'standing', stageId: 'group', groupId: 'A', rank: 4 } }
      ]
    },
    {
      stageId: 'final', name: '名次決賽', type: 'knockout', order: 3,
      drawRule: 'penalty',
      slots: [
        { matchKey: 'F1', label: '冠軍賽',
          home: { type: 'matchWinner', matchKey: 'SF1' },
          away: { type: 'matchWinner', matchKey: 'SF2' } },
        { matchKey: 'F3', label: '季軍賽',
          home: { type: 'matchLoser', matchKey: 'SF1' },
          away: { type: 'matchLoser', matchKey: 'SF2' } },
        { matchKey: 'F5', label: '五六名賽',
          home: { type: 'matchWinner', matchKey: 'PF1' },
          away: { type: 'matchWinner', matchKey: 'PF2' } },
        { matchKey: 'F7', label: '七八名賽',
          home: { type: 'matchLoser', matchKey: 'PF1' },
          away: { type: 'matchLoser', matchKey: 'PF2' } }
      ]
    }
  ],
  finalRankingMap: [
    { rank: 1, from: { type: 'matchWinner', matchKey: 'F1' } },
    { rank: 2, from: { type: 'matchLoser',  matchKey: 'F1' } },
    { rank: 3, from: { type: 'matchWinner', matchKey: 'F3' } },
    { rank: 4, from: { type: 'matchLoser',  matchKey: 'F3' } },
    { rank: 5, from: { type: 'matchWinner', matchKey: 'F5' } },
    { rank: 6, from: { type: 'matchLoser',  matchKey: 'F5' } },
    { rank: 7, from: { type: 'matchWinner', matchKey: 'F7' } },
    { rank: 8, from: { type: 'matchLoser',  matchKey: 'F7' } }
  ]
};

/** 6 隊：兩組循環 ＋ 同名次對決。每隊 3 場，共 9 場。U6/U8/U10 建議採用。 */
const F6_TWO_GROUPS_MIRROR = {
  formatId: 'F6_TWO_GROUPS_MIRROR',
  name: '6隊 兩組循環＋同名次對決',
  teamCount: 6,
  description: '每隊固定 3 場，單組別共 9 場。適合單日多組別並行',
  stages: [
    {
      stageId: 'group', name: '分組循環', type: 'roundRobin', order: 1,
      groupCount: 2, groupSize: 3, legs: 1, seedingMethod: 'snake'
    },
    {
      stageId: 'final', name: '名次對決', type: 'knockout', order: 2,
      drawRule: 'penalty',
      slots: [
        { matchKey: 'F1', label: '冠軍賽',
          home: { type: 'standing', stageId: 'group', groupId: 'A', rank: 1 },
          away: { type: 'standing', stageId: 'group', groupId: 'B', rank: 1 } },
        { matchKey: 'F3', label: '季軍賽',
          home: { type: 'standing', stageId: 'group', groupId: 'A', rank: 2 },
          away: { type: 'standing', stageId: 'group', groupId: 'B', rank: 2 } },
        { matchKey: 'F5', label: '五六名賽',
          home: { type: 'standing', stageId: 'group', groupId: 'A', rank: 3 },
          away: { type: 'standing', stageId: 'group', groupId: 'B', rank: 3 } }
      ]
    }
  ],
  finalRankingMap: [
    { rank: 1, from: { type: 'matchWinner', matchKey: 'F1' } },
    { rank: 2, from: { type: 'matchLoser',  matchKey: 'F1' } },
    { rank: 3, from: { type: 'matchWinner', matchKey: 'F3' } },
    { rank: 4, from: { type: 'matchLoser',  matchKey: 'F3' } },
    { rank: 5, from: { type: 'matchWinner', matchKey: 'F5' } },
    { rank: 6, from: { type: 'matchLoser',  matchKey: 'F5' } }
  ]
};

/** 6 隊：兩組循環 ＋ 交叉準決賽。共 11 場（場次不齊一，見 description）。 */
const F6_TWO_GROUPS_CROSS = {
  formatId: 'F6_TWO_GROUPS_CROSS',
  name: '6隊 兩組循環＋交叉準決賽',
  teamCount: 6,
  description: '單組別共 11 場。晉級 4 隊每隊 4 場、分組第 3 名 2 隊每隊 3 場（場次不齊一）',
  stages: [
    {
      stageId: 'group', name: '分組循環', type: 'roundRobin', order: 1,
      groupCount: 2, groupSize: 3, legs: 1, seedingMethod: 'snake'
    },
    {
      stageId: 'placement', name: '準決賽', type: 'knockout', order: 2,
      drawRule: 'penalty',
      slots: [
        { matchKey: 'SF1', label: '準決賽①',
          home: { type: 'standing', stageId: 'group', groupId: 'A', rank: 1 },
          away: { type: 'standing', stageId: 'group', groupId: 'B', rank: 2 } },
        { matchKey: 'SF2', label: '準決賽②',
          home: { type: 'standing', stageId: 'group', groupId: 'B', rank: 1 },
          away: { type: 'standing', stageId: 'group', groupId: 'A', rank: 2 } }
      ]
    },
    {
      stageId: 'final', name: '名次決賽', type: 'knockout', order: 3,
      drawRule: 'penalty',
      slots: [
        { matchKey: 'F1', label: '冠軍賽',
          home: { type: 'matchWinner', matchKey: 'SF1' },
          away: { type: 'matchWinner', matchKey: 'SF2' } },
        { matchKey: 'F3', label: '季軍賽',
          home: { type: 'matchLoser', matchKey: 'SF1' },
          away: { type: 'matchLoser', matchKey: 'SF2' } },
        { matchKey: 'F5', label: '五六名賽',
          home: { type: 'standing', stageId: 'group', groupId: 'A', rank: 3 },
          away: { type: 'standing', stageId: 'group', groupId: 'B', rank: 3 } }
      ]
    }
  ],
  finalRankingMap: [
    { rank: 1, from: { type: 'matchWinner', matchKey: 'F1' } },
    { rank: 2, from: { type: 'matchLoser',  matchKey: 'F1' } },
    { rank: 3, from: { type: 'matchWinner', matchKey: 'F3' } },
    { rank: 4, from: { type: 'matchLoser',  matchKey: 'F3' } },
    { rank: 5, from: { type: 'matchWinner', matchKey: 'F5' } },
    { rank: 6, from: { type: 'matchLoser',  matchKey: 'F5' } }
  ]
};

/** 4 隊：單循環 ＋ 冠軍賽與季軍賽。每隊 4 場，共 8 場。 */
const F4_RR_FINAL = {
  formatId: 'F4_RR_FINAL',
  name: '4隊單循環＋冠軍季軍賽',
  teamCount: 4,
  description: '每隊 4 場，單組別共 8 場',
  stages: [
    {
      stageId: 'group', name: '單循環', type: 'roundRobin', order: 1,
      groupCount: 1, groupSize: 4, legs: 1, seedingMethod: 'snake'
    },
    {
      stageId: 'final', name: '名次決賽', type: 'knockout', order: 2,
      drawRule: 'penalty',
      slots: [
        { matchKey: 'F1', label: '冠軍賽',
          home: { type: 'standing', stageId: 'group', groupId: 'A', rank: 1 },
          away: { type: 'standing', stageId: 'group', groupId: 'A', rank: 2 } },
        { matchKey: 'F3', label: '季軍賽',
          home: { type: 'standing', stageId: 'group', groupId: 'A', rank: 3 },
          away: { type: 'standing', stageId: 'group', groupId: 'A', rank: 4 } }
      ]
    }
  ],
  finalRankingMap: [
    { rank: 1, from: { type: 'matchWinner', matchKey: 'F1' } },
    { rank: 2, from: { type: 'matchLoser',  matchKey: 'F1' } },
    { rank: 3, from: { type: 'matchWinner', matchKey: 'F3' } },
    { rank: 4, from: { type: 'matchLoser',  matchKey: 'F3' } }
  ]
};

/** 8 隊：小組第一輪空，第二、三交叉淘汰，第四直接排七八名。 */
const F8_GROUP_TOP_SEED_BYE = {
  formatId: 'F8_GROUP_TOP_SEED_BYE',
  groupNames: { A: '甲組', B: '乙組' },
  matchNames: { QF1: '淘汰賽①', QF2: '淘汰賽②', SF1: '淘汰賽③', SF2: '淘汰賽④' },
  name: '8隊 兩組循環＋小組第一輪空淘汰賽',
  teamCount: 8,
  description: '共20場。小組第一輪空；第二、三交叉淘汰，第四直接打七八名賽。每隊4至6場。',
  stages: [
    { stageId: 'group', name: '分組循環', type: 'roundRobin', order: 1,
      groupCount: 2, groupSize: 4, legs: 1, seedingMethod: 'snake' },
    { stageId: 'qualifier', name: '交叉淘汰賽', type: 'knockout', order: 2, drawRule: 'penalty',
      slots: [
        { matchKey: 'QF1', label: '淘汰賽①',
          home: { type: 'standing', stageId: 'group', groupId: 'A', rank: 2 },
          away: { type: 'standing', stageId: 'group', groupId: 'B', rank: 3 } },
        { matchKey: 'QF2', label: '淘汰賽②',
          home: { type: 'standing', stageId: 'group', groupId: 'A', rank: 3 },
          away: { type: 'standing', stageId: 'group', groupId: 'B', rank: 2 } }
      ] },
    { stageId: 'placement', name: '準決賽', type: 'knockout', order: 3, drawRule: 'penalty',
      slots: [
        { matchKey: 'SF1', label: '淘汰賽③',
          home: { type: 'standing', stageId: 'group', groupId: 'A', rank: 1 },
          away: { type: 'matchWinner', matchKey: 'QF2' } },
        { matchKey: 'SF2', label: '淘汰賽④',
          home: { type: 'standing', stageId: 'group', groupId: 'B', rank: 1 },
          away: { type: 'matchWinner', matchKey: 'QF1' } }
      ] },
    { stageId: 'final', name: '名次決賽', type: 'knockout', order: 4, drawRule: 'penalty',
      slots: [
        { matchKey: 'F3', label: '季軍賽', round: 1,
          home: { type: 'matchLoser', matchKey: 'SF1' },
          away: { type: 'matchLoser', matchKey: 'SF2' } },
        { matchKey: 'F7', label: '七八名賽', round: 1,
          home: { type: 'standing', stageId: 'group', groupId: 'A', rank: 4 },
          away: { type: 'standing', stageId: 'group', groupId: 'B', rank: 4 } },
        { matchKey: 'F1', label: '冠軍賽', round: 2,
          home: { type: 'matchWinner', matchKey: 'SF1' },
          away: { type: 'matchWinner', matchKey: 'SF2' } },
        { matchKey: 'F5', label: '五六名賽', round: 2,
          home: { type: 'matchLoser', matchKey: 'QF1' },
          away: { type: 'matchLoser', matchKey: 'QF2' } }
      ] }
  ],
  finalRankingMap: F8_GROUP_CROSS.finalRankingMap.map(item => ({ ...item, from: { ...item.from } }))
};

const FORMATS = {
  F8_GROUP_CROSS,
  F8_GROUP_TOP_SEED_BYE,
  F6_TWO_GROUPS_MIRROR,
  F6_TWO_GROUPS_CROSS,
  F4_RR_FINAL
};

// ══════════════════════════════════════════════════════════════════
//  RankingRules
// ══════════════════════════════════════════════════════════════════

/** FIFA 標準行為分罰分（分數越接近 0 越好） */
const FAIR_PLAY = { yellow: -1, secondYellow: -3, directRed: -4, yellowThenRed: -5 };

/** 飛達盃預設：對戰關係優先，最後落到主辦裁定 */
const RR_FEDA_DEFAULT = {
  rankingRuleId: 'RR_FEDA_DEFAULT',
  name: '飛達盃預設（對戰關係優先）',
  points: { win: 3, draw: 1, loss: 0 },
  criteria: [
    'points',
    'headToHeadPoints',
    'headToHeadGoalDiff',
    'headToHeadGoalsFor',
    'goalDiff',
    'goalsFor',
    'goalsAgainstAsc',
    'fairPlay',
    'manual'
  ],
  fairPlay: FAIR_PLAY
};

/** 兒童組：拿掉行為分，較早落到主辦裁定，避免用得失球差鼓勵大比分 */
const RR_FEDA_YOUTH = {
  rankingRuleId: 'RR_FEDA_YOUTH',
  name: '飛達盃兒童組',
  points: { win: 3, draw: 1, loss: 0 },
  criteria: [
    'points',
    'headToHeadPoints',
    'headToHeadGoalDiff',
    'goalDiff',
    'goalsFor',
    'manual'
  ],
  fairPlay: FAIR_PLAY
};

/** 國際對照版（FIFA 2026 世界盃小組同分判定順序），備用 */
const RR_FIFA_2026 = {
  rankingRuleId: 'RR_FIFA_2026',
  name: 'FIFA 2026 標準',
  points: { win: 3, draw: 1, loss: 0 },
  criteria: [
    'points',
    'headToHeadPoints', 'headToHeadGoalDiff', 'headToHeadGoalsFor',
    'goalDiff', 'goalsFor',
    'fairPlay', 'drawLots'
  ],
  fairPlay: FAIR_PLAY
};

/**
 * ⭐ 2026 飛達盃競賽規章第十九條 —— **本次賽事六個組別全部採用這一份**。
 *
 * 規章原文（循環賽）：
 *   「勝 1 場得 3 分，和局各得 1 分，負 1 場 0 分，以積分多寡判定之，
 *     如遇積分相同者判定勝負如下：
 *       1. 對戰關係
 *       2. 正負球數（進球數-被進球數）
 *       3. 進球數多者
 *       4. 被進球數少者
 *       5. 抽籤」
 *
 * 與 RR_FEDA_DEFAULT 的三個差異（都會換掉名次，不是文字上的差別）：
 *   1. 規章的「對戰關係」只有**一層**。RR_FEDA_DEFAULT 拆成
 *      headToHeadPoints / headToHeadGoalDiff / headToHeadGoalsFor 三層，
 *      多出來的兩層會在規章要求「看正負球數」的時候先把名次分掉。
 *   2. 規章**沒有行為分**。RR_FEDA_DEFAULT 把 fairPlay 排在第 5 順位，
 *      等於用一條規章沒授權的條件決定名次。
 *   3. 規章第 5 順位是**抽籤**，不是主辦裁定。
 *
 * ⚠️ `drawLots` 在引擎裡是「標記 hasUnresolvedTie，等主辦實際抽完再回填」，
 *    **不會**自己擲骰子（R-ENG-004）。規章要的是真的抽籤，
 *    系統的角色是把該抽的那一組指出來、把結果記下來。
 */
const RR_FEDA_2026 = {
  rankingRuleId: 'RR_FEDA_2026',
  name: '飛達盃 2026 競賽規章第十九條',
  points: { win: 3, draw: 1, loss: 0 },
  criteria: [
    'points',
    'headToHeadPoints',   // 1. 對戰關係
    'goalDiff',           // 2. 正負球數
    'goalsFor',           // 3. 進球數多者
    'goalsAgainstAsc',    // 4. 被進球數少者
    'drawLots'            // 5. 抽籤（由主辦執行，引擎只標記）
  ],
  fairPlay: FAIR_PLAY     // 仍然計算，但**不列入 criteria**：射手榜／風度獎要用
};

/**
 * RR_FEDA_DEFAULT 與 RR_FEDA_YOUTH 是規章定案前的版本，**本次賽事不使用**。
 * 保留的原因：docs/02 §6 有對照說明，而且未來辦第二場時主辦可能選別的規則
 * （這個系統是設定檔驅動的，換規則不該要改程式）。
 */
const RANKING_RULES = { RR_FEDA_2026, RR_FEDA_DEFAULT, RR_FEDA_YOUTH, RR_FIFA_2026 };

// ══════════════════════════════════════════════════════════════════
//  本次活動的組別設定（seed 用）
// ══════════════════════════════════════════════════════════════════

/**
 * @deprecated 飛達盃專屬
 * 本次活動的六個組別。
 *
 * ⭐ 名稱、參賽資格、上場人數、比賽時間、用球一律**照競賽規章第十一～十八條**，
 *    不是我們挑的。改這裡等於改規章，先確認主辦有發佈修訂版。
 *
 * `divisionId` 沿用 u6/u8/u10（matchId 前綴、種子資料、既有測試都在用）。
 *
 * ⚠️ **`name` 與 `officialName` 是兩件事，兩個都要有。**
 *    ・`name`：畫面上的主標籤。學童三組是「U6兒童組／U8兒童組／U10兒童組」
 *      （主辦 2026-09-03 指定）——家長習慣 U 制的講法。
 *    ・`shortName`：窄機的分頁與晶片用，學童三組只留 U6／U8／U10。
 *    ・`officialName`：**規章上的正式名稱**（學童幼稚園／低年級／中年級）。
 *      規章與報名表上寫的是這個；只顯示 U10 的話，家長拿著報名表會對不上，
 *      而「我是不是報錯組」是報名期間最常見的詢問。
 *    所以報名頁與組別頁要把兩個一起顯示：`U10（學童中年級）`。
 *
 * 📌 規章本身**沒有**出現 U6/U8/U10 這種寫法（PDF 與 docs/ 的轉錄本都查過），
 *    U 制是主辦指定的顯示慣例，不是規章原文。
 *
 * `eligibility.bornOnOrAfter`：規章寫「2020年09月01日**以後**出生」，
 * 中文法規文字的「以後」含當日，所以是 >=。
 */
const DIVISIONS = [
  { divisionId: 'u6',         name: 'U6兒童組',  shortName: 'U6', officialName: '學童幼稚園', date: '2026-10-09',
    teamCount: 6, playersOnField: 5, matchDurationMin: 25, periods: 1, ballSize: 4,
    eligibility: { bornOnOrAfter: '2020-09-01', note: '就讀各公、私立小學' },
    formatId: 'F6_TWO_GROUPS_MIRROR', rankingRuleId: 'RR_FEDA_2026',
    colorToken: 'div-u6',    order: 1, code: 'U6',
    stats: { scorers: false }, display: { mercyRule: { enabled: false, cap: 7 }, scorerBoard: false } },

  { divisionId: 'u8',         name: 'U8兒童組',  shortName: 'U8', officialName: '學童低年級', date: '2026-10-09',
    teamCount: 6, playersOnField: 5, matchDurationMin: 25, periods: 1, ballSize: 4,
    eligibility: { bornOnOrAfter: '2018-09-01', note: '就讀各公、私立小學' },
    formatId: 'F6_TWO_GROUPS_MIRROR', rankingRuleId: 'RR_FEDA_2026',
    colorToken: 'div-u8',    order: 2, code: 'U8',
    stats: { scorers: false }, display: { mercyRule: { enabled: false, cap: 7 }, scorerBoard: false } },

  { divisionId: 'u10',        name: 'U10兒童組', shortName: 'U10', officialName: '學童中年級', date: '2026-10-09',
    teamCount: 6, playersOnField: 5, matchDurationMin: 25, periods: 1, ballSize: 4,
    eligibility: { bornOnOrAfter: '2016-09-01', note: '就讀各公、私立小學' },
    formatId: 'F6_TWO_GROUPS_MIRROR', rankingRuleId: 'RR_FEDA_2026',
    colorToken: 'div-u10',   order: 3, code: 'U10',
    stats: { scorers: false }, display: { mercyRule: { enabled: false, cap: 7 }, scorerBoard: false } },

  { divisionId: 'women',      name: '女子組',      shortName: '女子',  officialName: '女子公開組', date: '2026-10-09',
    teamCount: 4, playersOnField: 5, matchDurationMin: 25, periods: 1, ballSize: 5,
    eligibility: { bornOnOrAfter: null, note: '在學學生之社會人士、機關及公司員工均可自由組隊參加' },
    formatId: 'F4_RR_FINAL', rankingRuleId: 'RR_FEDA_2026',
    colorToken: 'div-women', order: 4, code: 'WM',
    display: { mercyRule: { enabled: false, cap: 7 }, scorerBoard: true } },

  { divisionId: 'adult-fun',  name: '成人興趣組',  shortName: '興趣',  officialName: '男子興趣組', date: '2026-10-10',
    teamCount: 8, playersOnField: 9, matchDurationMin: 30, periods: 1, ballSize: 5,
    eligibility: { bornOnOrAfter: null, note: '非職業甲乙組球員，自評球齡低於二年或以興趣為主' },
    formatId: 'F8_GROUP_TOP_SEED_BYE', rankingRuleId: 'RR_FEDA_2026',
    colorToken: 'div-fun',   order: 5, code: 'AF',
    display: { mercyRule: { enabled: false, cap: 7 }, scorerBoard: true } },

  { divisionId: 'adult-open', name: '成人公開組',  shortName: '公開',  officialName: '男子公開組', date: '2026-10-11',
    teamCount: 8, playersOnField: 9, matchDurationMin: 30, periods: 1, ballSize: 5,
    eligibility: { bornOnOrAfter: null, note: '在學學生之社會人士、機關及公司員工均可自由組隊參加' },
    formatId: 'F8_GROUP_CROSS', rankingRuleId: 'RR_FEDA_2026',
    colorToken: 'div-open',  order: 6, code: 'AO',
    display: { mercyRule: { enabled: false, cap: 7 }, scorerBoard: true } }
].map(division => ({ ...division, requiredFormatId: 'F8_GROUP_TOP_SEED_BYE', groupNames: { A: '甲組', B: '乙組' } }));

/**
 * @deprecated 飛達盃專屬
 * 報名限制（競賽規章第十二條）。
 * 寫在這裡是為了讓 seed 與前端有同一份依據；執行時的權威是
 * Firestore 的 config/registration（主辦可在後台改）。
 */
const REGISTRATION_LIMITS = {
  maxPlayers: 15,          // 「球員最多 15 人」
  maxStaff: 3,             // 「隊職員 3 人（領隊、教練、管理各 1 人）」
  staffRoles: ['leader', 'coach', 'manager'],
  onePlayerOneTeam: false, // 主辦 2026-09-29 調整：三天不同盃賽，允許同一球員跨隊參賽。
  fee: { youth: 5000, adult: 6000 }   // 學童三組 / 女子與男子兩組
};

/**
 * @deprecated 飛達盃專屬
 * 規章第二十條：申訴。
 * 「應由領隊或總教練於賽後三十分鐘內用書面提出，並需繳納保證金新台幣貳仟元整；
 *   如申訴理由不成立時，保證金不予發還」
 */
const APPEAL_RULES = {
  windowMin: 30,           // 賽後三十分鐘內
  deposit: 2000,           // 保證金新台幣貳仟元整
  roles: ['leader', 'headCoach']   // 領隊或總教練
};

/**
 * @deprecated 飛達盃專屬
 * 規章第二十七條：退費機制與取消辦法。
 * 「活動日前 15 天內取消恕不接受退費申請。但容許將名額轉讓給他人
 *   （請於活動前 3 天通知主辦單位變更參加者資料）」
 * 「若活動因不可抗力之因素……主辦單位宣布取消活動，將全額退費，不收取任何手續費」
 */
const REFUND_RULES = {
  noRefundWithinDays: 15,  // 活動日前 15 天內不退
  transferNoticeDays: 3    // 名額轉讓要在活動前 3 天通知
};

/** 階段代碼（用於 matchId：{組別碼}-{階段碼}-{小組}-{序}） */
const STAGE_CODE: Record<string, string> = { group: 'G', qualifier: 'Q', placement: 'P', final: 'F' };

/** 與 FORMATS 同一份物件。來源只有五個賽制範本，不是六個。 */
const FORMAT_TEMPLATES = FORMATS;

const TEAM_MIN = 2;
const TEAM_MAX = 64;
const DRAW_RULES = ['none', 'penalty', 'goldenGoal'] as const;

function requireInt(name: string, value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} 必須是 ${min} 到 ${max} 的整數`);
  }
  return value;
}

function requireDrawRule(drawRule: string): DrawRule {
  if (!(DRAW_RULES as readonly string[]).includes(drawRule)) {
    throw new RangeError(`drawRule 必須是 ${DRAW_RULES.join('、')}`);
  }
  return drawRule as DrawRule;
}

function isPow2(n: number): boolean {
  return n >= 2 && (n & (n - 1)) === 0;
}

/** 標準種子位：1 對最後、再展開成 1,8,4,5…。size 必須是 2 的冪。 */
function seedOrder(size: number): number[] {
  let positions = [1];
  while (positions.length < size) {
    const n = positions.length * 2;
    const next: number[] = [];
    for (const p of positions) next.push(p, n + 1 - p);
    positions = next;
  }
  return positions;
}

function seedSource(rank: number): TeamSource {
  return { type: 'standing', stageId: 'seed', groupId: 'S', rank };
}

function roundPrefix(teamsInRound: number): string {
  if (teamsInRound === 2) return 'F';
  if (teamsInRound === 4) return 'SF';
  if (teamsInRound === 8) return 'QF';
  return `R${teamsInRound}_`;
}

function slotLabel(prefix: string, index: number): string {
  if (prefix === 'F') return '冠軍賽';
  const mark = index <= 4 ? '①②③④'[index - 1] : String(index);
  if (prefix === 'SF') return `準決賽${mark}`;
  if (prefix === 'QF') return `八強${mark}`;
  return `淘汰賽${mark}`;
}

interface BracketPiece {
  slots: Slot[];
  ranking: RankSource[];
}

/**
 * 單淘汰括號。輪空不產生場次：種子直接以 standing（stageId seed／groupId S）
 * 出現在下一輪，對上 matchWinner。這是小組第一輪空那種寫法，不是多排一場空比賽。
 */
function knockoutSlots(teamCount: number, thirdPlace: boolean): BracketPiece {
  const size = 1 << Math.ceil(Math.log2(teamCount));
  let current: Array<TeamSource | null> = seedOrder(size).map(p => (p <= teamCount ? seedSource(p) : null));
  const rounds: Slot[][] = [];

  while (current.length > 1) {
    const teamsInRound = current.length;
    const prefix = roundPrefix(teamsInRound);
    const slots: Slot[] = [];
    const next: Array<TeamSource | null> = [];
    for (let i = 0; i < current.length; i += 2) {
      const a = current[i] ?? null;
      const b = current[i + 1] ?? null;
      if (a && b) {
        const idx = slots.length + 1;
        const matchKey = prefix === 'F' ? 'F1' : `${prefix}${idx}`;
        slots.push({
          matchKey,
          label: slotLabel(prefix, idx),
          round: rounds.length + 1,
          home: a,
          away: b
        });
        next.push({ type: 'matchWinner', matchKey });
      } else if (a || b) {
        next.push(a ?? b);
      } else {
        next.push(null);
      }
    }
    if (slots.length) rounds.push(slots);
    current = next;
  }

  const slots = rounds.flat();
  if (slots.length !== teamCount - 1) {
    throw new RangeError(`淘汰賽場次應為 ${teamCount - 1}，實際 ${slots.length}`);
  }

  const ranking: RankSource[] = [
    { rank: 1, from: { type: 'matchWinner', matchKey: 'F1' } },
    { rank: 2, from: { type: 'matchLoser', matchKey: 'F1' } }
  ];

  if (thirdPlace) {
    const semis = rounds.length >= 2 ? rounds[rounds.length - 2] : undefined;
    if (!semis || semis.length !== 2) {
      throw new RangeError('季軍賽需要恰好兩場準決賽（隊數至少 4，且準決賽不得因輪空少場）');
    }
    const s1 = semis[0];
    const s2 = semis[1];
    if (!s1 || !s2) throw new RangeError('季軍賽需要恰好兩場準決賽');
    slots.push({
      matchKey: 'F3',
      label: '季軍賽',
      round: (s1.round ?? rounds.length) ,
      home: { type: 'matchLoser', matchKey: s1.matchKey },
      away: { type: 'matchLoser', matchKey: s2.matchKey }
    });
    ranking.push(
      { rank: 3, from: { type: 'matchWinner', matchKey: 'F3' } },
      { rank: 4, from: { type: 'matchLoser', matchKey: 'F3' } }
    );
  }

  return { slots, ranking };
}

/** 後續輪次：奇數時第一個（通常是 A1 的勝隊）輪空；其餘 i 對 i+half，避免同組勝隊立刻再碰。 */
function pairRest(entrants: TeamSource[], startRound: number, startSeq: number): { rounds: Slot[][]; flat: Slot[] } {
  let current = entrants;
  const rounds: Slot[][] = [];
  let seq = startSeq;
  while (current.length > 1) {
    const next: TeamSource[] = [];
    let pool = current;
    if (pool.length % 2 === 1) {
      const bye = pool[0];
      if (!bye) throw new RangeError('淘汰賽輪空失敗');
      next.push(bye);
      pool = pool.slice(1);
    }
    const half = pool.length / 2;
    const slots: Slot[] = [];
    for (let i = 0; i < half; i++) {
      const home = pool[i];
      const away = pool[i + half];
      if (!home || !away) throw new RangeError('淘汰賽配對失敗');
      seq += 1;
      const matchKey = `K${seq}`;
      slots.push({
        matchKey,
        label: '淘汰賽',
        round: startRound + rounds.length,
        home,
        away
      });
      next.push({ type: 'matchWinner', matchKey });
    }
    if (slots.length) rounds.push(slots);
    current = next;
  }
  return { rounds, flat: rounds.flat() };
}

function renameKnockoutKeys(rounds: Slot[][], thirdPlace: boolean): BracketPiece {
  const rename = new Map<string, string>();
  const finalRound = rounds[rounds.length - 1];
  if (!finalRound || finalRound.length !== 1 || !finalRound[0]) {
    throw new RangeError('淘汰賽缺少冠軍賽');
  }
  rename.set(finalRound[0].matchKey, 'F1');
  const semis = rounds.length >= 2 ? rounds[rounds.length - 2] : undefined;
  if (thirdPlace && (!semis || semis.length !== 2)) {
    throw new RangeError('季軍賽需要恰好兩場準決賽（晉級隊數需能排出兩場準決賽，通常是 2 的冪且至少 4 隊）');
  }
  if (semis && semis.length === 2 && semis[0] && semis[1]) {
    rename.set(semis[0].matchKey, 'SF1');
    rename.set(semis[1].matchKey, 'SF2');
  }
  const qf = rounds.find(r => r.length === 4);
  if (qf) qf.forEach((slot, i) => rename.set(slot.matchKey, `QF${i + 1}`));

  const apply = (src: TeamSource): TeamSource => {
    if ((src.type === 'matchWinner' || src.type === 'matchLoser') && rename.has(src.matchKey)) {
      const matchKey = rename.get(src.matchKey);
      if (!matchKey) return src;
      return { ...src, matchKey };
    }
    return src;
  };

  const slots: Slot[] = rounds.flat().map(slot => {
    const matchKey = rename.get(slot.matchKey) ?? slot.matchKey;
    const prefix = matchKey === 'F1' ? 'F' : matchKey.startsWith('SF') ? 'SF' : matchKey.startsWith('QF') ? 'QF' : 'K';
    const idx = Number(matchKey.replace(/\D/g, '')) || 1;
    return {
      ...slot,
      matchKey,
      label: prefix === 'K' ? slot.label : slotLabel(prefix, idx),
      home: apply(slot.home),
      away: apply(slot.away)
    };
  });

  const ranking: RankSource[] = [
    { rank: 1, from: { type: 'matchWinner', matchKey: 'F1' } },
    { rank: 2, from: { type: 'matchLoser', matchKey: 'F1' } }
  ];
  if (thirdPlace && semis && semis.length === 2) {
    slots.push({
      matchKey: 'F3',
      label: '季軍賽',
      round: finalRound[0].round ?? rounds.length,
      home: { type: 'matchLoser', matchKey: 'SF1' },
      away: { type: 'matchLoser', matchKey: 'SF2' }
    });
    ranking.push(
      { rank: 3, from: { type: 'matchWinner', matchKey: 'F3' } },
      { rank: 4, from: { type: 'matchLoser', matchKey: 'F3' } }
    );
  }
  return { slots, ranking };
}

/**
 * 單一組循環。legs 只允許 1 或 2。
 * 場數應為 n(n-1)/2×legs（由 schedule.buildMatches 產生）。
 */
export function buildRoundRobinFormat({
  teamCount,
  legs = 1
}: {
  teamCount: number;
  legs?: number;
}): Format {
  const n = requireInt('teamCount', teamCount, TEAM_MIN, TEAM_MAX);
  const leg = requireInt('legs', legs, 1, 2);
  const total = (n * (n - 1) / 2) * leg;
  return {
    formatId: `RR_${n}T_${leg}L`,
    name: `${n}隊 ${leg === 2 ? '雙循環' : '單循環'}（系統產生）`,
    teamCount: n,
    generated: true,
    description: `單一組，每隊 ${(n - 1) * leg} 場，共 ${total} 場。名次由積分榜決定。`,
    stages: [{
      stageId: 'group',
      name: leg === 2 ? '雙循環' : '單循環',
      type: 'roundRobin',
      order: 1,
      groupCount: 1,
      groupSize: n,
      legs: leg === 2 ? 2 : 1,
      seedingMethod: 'snake'
    }],
    finalRankingMap: Array.from({ length: n }, (_, i) => ({
      rank: i + 1,
      from: { type: 'standing' as const, stageId: 'group', groupId: 'A', rank: i + 1 }
    }))
  };
}

/**
 * 單淘汰。隊數不是 2 的冪時，最高種子先輪空，輪空不另排場次。
 * 場數為 n-1；thirdPlace 時再加一場季軍賽。
 */
export function buildKnockoutFormat({
  teamCount,
  thirdPlace = false,
  drawRule = 'penalty'
}: {
  teamCount: number;
  thirdPlace?: boolean;
  drawRule?: string;
}): Format {
  const n = requireInt('teamCount', teamCount, TEAM_MIN, TEAM_MAX);
  if (typeof thirdPlace !== 'boolean') throw new RangeError('thirdPlace 必須是布林值');
  const rule = requireDrawRule(drawRule);
  const piece = knockoutSlots(n, thirdPlace);
  const bye = !isPow2(n);
  return {
    formatId: `KO_${n}T${thirdPlace ? '_3P' : ''}`,
    name: `${n}隊 單淘汰${thirdPlace ? '（含季軍賽）' : ''}（系統產生）`,
    teamCount: n,
    generated: true,
    description: bye
      ? `${n} 隊單淘汰，最高種子輪空（不另排場次）。正賽 ${n - 1} 場${thirdPlace ? '，另加季軍賽' : ''}。`
      : `${n} 隊單淘汰，共 ${n - 1} 場${thirdPlace ? '，另加季軍賽' : ''}。`,
    stages: [{
      stageId: 'final',
      name: '淘汰賽',
      type: 'knockout',
      order: 1,
      drawRule: rule,
      slots: piece.slots
    }],
    finalRankingMap: piece.ranking
  };
}

/**
 * 分組循環（蛇形）後，各組前 advancePerGroup 名交叉進淘汰。
 * groupCount 必須是 2 的冪。A1 對 B2、B1 對 A2。
 * 淘汰場數為晉級隊數 − 1；thirdPlace 再加一場，且必須剛好有兩場準決賽。
 */
export function buildGroupKnockoutFormat({
  groupCount,
  groupSize,
  advancePerGroup,
  thirdPlace = false,
  drawRule = 'penalty'
}: {
  groupCount: number;
  groupSize: number;
  advancePerGroup: number;
  thirdPlace?: boolean;
  drawRule?: string;
}): Format {
  const groups = requireInt('groupCount', groupCount, 2, 32);
  const size = requireInt('groupSize', groupSize, 2, TEAM_MAX);
  const take = requireInt('advancePerGroup', advancePerGroup, 1, size);
  if (!isPow2(groups)) throw new RangeError('groupCount 必須是 2 的冪');
  if (typeof thirdPlace !== 'boolean') throw new RangeError('thirdPlace 必須是布林值');
  const rule = requireDrawRule(drawRule);
  const teamCount = groups * size;
  if (teamCount > TEAM_MAX) throw new RangeError(`總隊數 ${teamCount} 超過 ${TEAM_MAX}`);
  const advancing = groups * take;
  if (advancing < 2) throw new RangeError('晉級隊數至少 2');

  const first: Slot[] = [];
  const winners: TeamSource[] = [];
  let seq = 0;
  for (let p = 0; p < groups; p += 2) {
    const g1 = groupLabel(p);
    const g2 = groupLabel(p + 1);
    for (let r = 1; r <= take; r++) {
      const opp = take + 1 - r;
      const home: TeamSource = r % 2 === 1
        ? { type: 'standing', stageId: 'group', groupId: g1, rank: r }
        : { type: 'standing', stageId: 'group', groupId: g2, rank: opp };
      const away: TeamSource = r % 2 === 1
        ? { type: 'standing', stageId: 'group', groupId: g2, rank: opp }
        : { type: 'standing', stageId: 'group', groupId: g1, rank: r };
      seq += 1;
      const matchKey = `K${seq}`;
      first.push({ matchKey, label: '淘汰賽', round: 1, home, away });
      winners.push({ type: 'matchWinner', matchKey });
    }
  }

  const rest = pairRest(winners, 2, seq);
  const piece = renameKnockoutKeys([first, ...rest.rounds], thirdPlace);
  const rrEach = (size * (size - 1)) / 2;
  const ko = advancing - 1 + (thirdPlace ? 1 : 0);
  if (piece.slots.length !== ko) {
    throw new RangeError(`分組淘汰的淘汰場數應為 ${ko}，實際 ${piece.slots.length}`);
  }

  return {
    formatId: `GK_${groups}x${size}_A${take}${thirdPlace ? '_3P' : ''}`,
    name: `${groups}組×${size}隊 分組循環＋淘汰（系統產生）`,
    teamCount,
    generated: true,
    description: `${groups} 組各 ${size} 隊循環，各組前 ${take} 名交叉淘汰。分組 ${groups * rrEach} 場，淘汰 ${ko} 場。`,
    stages: [
      {
        stageId: 'group',
        name: '分組循環',
        type: 'roundRobin',
        order: 1,
        groupCount: groups,
        groupSize: size,
        legs: 1,
        seedingMethod: 'snake'
      },
      {
        stageId: 'final',
        name: '淘汰賽',
        type: 'knockout',
        order: 2,
        drawRule: rule,
        slots: piece.slots
      }
    ],
    finalRankingMap: piece.ranking
  };
}

export {
  FORMATS,
  FORMAT_TEMPLATES,
  RANKING_RULES,
  DIVISIONS,
  FAIR_PLAY,
  STAGE_CODE,
  REGISTRATION_LIMITS,
  APPEAL_RULES,
  REFUND_RULES
};
