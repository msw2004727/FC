# GrowthGames 存檔與社交系統 — 完整施作計畫

> **建立日期**：2026-03-23
> **狀態**：待施作（用戶確認中）
> **負責**：Claude Code 協助施作
> **優先級**：高（用戶明確表達這是必然方向）

---

## 一、需求背景與前因後果

### 1.1 用戶需求原文（彙整自對話）

1. **存檔功能**：「摘了多少花，殺了多少敵人，殺了多少玩家，角色的數值各項數值我想要儲存，每次刷新瀏覽器玩都是延續進度」
2. **場景持久化**：「遊戲中的花朵與球的位置不能重啟遊戲後就被清空」
3. **未來擴充**：「未來還有道具與裝備，還有用戶遊戲畫面中的布置都會存入」
4. **社交互動**：「未來還要做玩家角色可以去用戶遊戲內拜訪或騷擾」
5. **交易/PvP**：「對於未來用戶與用戶之間的互動，甚至交易，或是 PvP 去用戶遊戲內搞破壞的架構要先設計好」
6. **角色命名**：「遊戲角色名稱會帶入用戶的 LINE 暱稱，但也會讓用戶自行取名」
7. **氣候系統**：「用戶 A 這裡是狂風暴雨閃電，用戶 B 是晴天，用戶 B 前往 A 時看到的畫面也是狂風暴雨」
8. **即時同步**：「自己角色去用戶 B 那邊摘花，那用戶 B 看到的畫面也會是與自己畫面同步」
9. **防作弊**：「這作法有保護不會被竄改的設計嗎？」
10. **不影響現有**：「修改這些會影響現有功能嗎？」
11. **預留未來**：「我沒想到的部分你都要先幫我預留好，因為我這遊戲未來會強調互動性」

### 1.2 遊玩場景定義（用戶明確指定）

- **自己端**：永遠在「個人資訊頁」遊玩，這是自己的家
- **拜訪別人**：主動前往「用戶名片頁面」互動
- **被拜訪**：別人的角色出現在自己的「個人資訊頁」

### 1.3 為什麼現在就要做

- GrowthGames 已有 35 個模組（7,822 行），功能成熟但只有 localStorage 暫存
- 用戶換裝置/清快取就丟失所有進度
- 社交功能是遊戲的核心發展方向，資料結構必須一開始就設計好，否則之後改結構極痛苦
- 角色同步的架構選擇會影響後續所有互動功能的實作方式

---

## 二、現有系統盤點

### 2.1 目前持久化狀態（localStorage `gg_stats_runtime`）

```javascript
{
  weakLevel: 0,          // 虛弱等級（存了但讀取時跳過）
  totalActions: 0,       // 累計動作次數
  totalKicks: 0,         // 累計踢球次數
  totalSleeps: 0,        // 累計睡覺次數
  flowersRed: 0,         // 紅花摘取數
  flowersGold: 0,        // 金花摘取數
  enemyKills: {},        // 敵人擊殺數 { skinKey: count }
  enemyBossKills: {},    // Boss 擊殺數 { skinKey: count }
  playerKills: 0,        // PvP 擊殺（預留）
  mbti: '',              // MBTI 人格（永久）
}
```

### 2.2 目前未持久化但應該存的

| 資料 | 目前狀態 | 應存 |
|------|----------|------|
| 角色皮膚 (skin) | 每次重置為 whiteCat | ✅ |
| 角色體力 (stamina.current) | 每次重置為 100 | ✅ |
| 花朵位置與狀態 | 每次重新生成 | ✅ |
| 球的位置 | 每次重新生成 | ✅ |
| 墓碑位置 | 每次清空 | ✅ |
| 角色等級/經驗 | placeholder，未實作 | ✅ |
| 角色六維屬性 | placeholder，全是 10 | ✅ |
| 裝備欄 | placeholder，全是 null | ✅ |
| 角色名稱 | 未實作 | ✅ |

### 2.3 不需要存的（純暫態）

- 角色位置 x/y（重開從箱子旁醒來）
- 角色速度 vy、動作幀 actionFrame
- 粒子效果、動畫計時器
- UI 面板開關狀態
- 敵人實體（動態刷新）
- 蝴蝶、旗幟動畫

### 2.4 相關檔案清單

```
js/modules/color-cat/
├── color-cat-config.js              # 常數定義（4 skin、動作定義）
├── color-cat-stats.js               # 狀態管理 + localStorage 存讀
├── color-cat-profile.js             # 角色資料（名稱、MBTI、裝備）
├── color-cat-mbti.js                # 16 種 MBTI 行為權重
├── color-cat-character.js           # 角色核心（位置、動作、更新迴圈）
├── color-cat-character-stamina.js   # 體力系統
├── color-cat-character-combat.js    # 戰鬥（HP、死亡、重生）
├── color-cat-character-actions.js   # 移動與基本動作
├── color-cat-character-ai.js        # AI 自主行為
├── color-cat-character-combo.js     # 連續動作（爬牆、爬箱、咬球）
├── color-cat-character-particles.js # 粒子效果
├── color-cat-character-bubble.js    # 對話泡泡
├── color-cat-sprite.js              # 精靈圖管理
├── color-cat-ball.js                # 球物理
├── color-cat-enemy.js               # 敵人系統（10 種、Boss）
├── color-cat-enemy-draw.js          # 敵人渲染
├── color-cat-enemy-util.js          # 敵人工具
├── color-cat-enemy-projectile.js    # 遠程攻擊
├── color-cat-scene.js               # 主場景（迴圈、點擊、渲染）
├── color-cat-scene-bg.js            # 背景
├── color-cat-scene-box.js           # 箱子
├── color-cat-scene-flag.js          # 旗幟
├── color-cat-scene-flower.js        # 花朵（生長、盛開、凋謝、摘取）
├── color-cat-scene-butterfly.js     # 蝴蝶動畫
├── color-cat-scene-fog.js           # 霧氣效果
├── color-cat-scene-grave.js         # 墓碑
├── color-cat-scene-panel.js         # UI 面板（3 頁籤）
├── color-cat-scene-panel-tab0.js    # 基本資訊頁籤
├── color-cat-scene-panel-tab1.js    # 狀態頁籤
├── color-cat-scene-panel-tab2.js    # 詳細頁籤
├── color-cat-scene-stats-modal.js   # 統計彈窗
├── color-cat-damage-number.js       # 傷害數字
└── dialogue/                        # 對話資料（5 檔）
```

已有的存讀接口（`color-cat-stats.js`）：
- `ColorCatStats.toJSON()` — 匯出狀態
- `ColorCatStats.load(data)` — 從外部載入
- `ColorCatStats.saveLocal()` — 存 localStorage（500ms debounce）
- `ColorCatStats.loadLocal()` — 讀 localStorage

---

## 三、Firestore 資料結構

### 3.1 總覽

```
users/{uid}/
├── game/                           ← subcollection
│   ├── save                        ← 主存檔（私有，本人讀寫）
│   ├── inventory                   ← 道具背包（私有）
│   ├── scene                       ← 場景佈置/裝飾品（私有）
│   └── settings                    ← 遊戲設定（私有）
│
├── gamePublic/                     ← subcollection（公開資料）
│   ├── profile                     ← 公開名片（所有登入用戶可讀）
│   └── scene                       ← 場景快照（訪客載入用）
│
├── gameInbox/{docId}               ← 互動通知收件匣
├── gameTradeOffers/{docId}         ← 交易邀請
└── gamePvpLog/{docId}              ← PvP 戰鬥紀錄
```

### 3.2 主存檔 `game/save`

```javascript
{
  version: 1,                        // 資料格式版本（未來升級用）

  // ── 角色核心 ──
  character: {
    skin: 'whiteCat',                // 當前皮膚
    customName: '小白白',             // 用戶自訂暱稱
    level: 3,
    exp: 250,
    expToNext: 400,
    stats: {                         // 六維屬性
      stamina: 100,
      agility: 12,
      speed: 11,
      luck: 10,
      constitution: 13,
      intelligence: 10,
    },
    mbti: 'INFP',                    // MBTI 人格（永久不變）
    staminaCurrent: 78.5,            // 當前體力值
    weakLevel: 0,                    // 虛弱等級
  },

  // ── 累計成就數據 ──
  lifetime: {
    totalActions: 1520,
    totalKicks: 340,
    totalSleeps: 89,
    flowersRed: 156,
    flowersGold: 23,
    enemyKills: { slime_green: 12, goblin_axe: 5 },
    enemyBossKills: { orc_shaman: 1 },
    playerKills: 0,
    deaths: 7,                       // 角色死亡次數
    visitsMade: 0,                   // 拜訪別人次數
    visitsReceived: 0,               // 被拜訪次數
    tradesCompleted: 0,              // 交易完成次數
    pvpWins: 0,                      // PvP 勝場
    pvpLosses: 0,                    // PvP 敗場
  },

  // ── 場景物件（重開後恢復原位） ──
  scene: {
    flowers: [                       // 最多存 30 朵（已凋謝的不存）
      { x: 120, baseY: 0, state: 'bloomed', gold: false, hScale: 1.2 },
      { x: 200, baseY: 0, state: 'growing', gold: true, hScale: 0.8 },
    ],
    ball: { x: 180, y: 50 },        // 球靜止在原位（不存速度）
    graves: [ { x: 95 } ],          // 最多存 20 個
    goldCounter: 3,                  // 金花計數器
    nextGoldAt: 7,                   // 下一朵金花出現門檻
    weather: {                       // 氣候系統
      type: 'clear',                 // clear/cloudy/rain/thunderstorm/snow/fog
      intensity: 0.5,                // 0~1
      changedAt: Timestamp,          // 上次天氣變化時間
    },
  },

  // ── 時間戳 ──
  savedAt: Timestamp,
  createdAt: Timestamp,
  playTimeMinutes: 142,              // 累計遊玩時間（分鐘）
}
```

### 3.3 道具背包 `game/inventory`

```javascript
{
  version: 1,

  equipped: {                        // 穿戴中的裝備
    hat: null,
    top: null,
    gloves: null,
    pants: null,
    shoes: null,
    accessory: null,
  },

  items: [                           // 背包道具
    { itemId: 'hat_crown', quantity: 1, obtainedAt: Timestamp },
    { itemId: 'potion_hp', quantity: 5, obtainedAt: Timestamp },
  ],

  currency: {                        // 貨幣
    coins: 500,                      // 金幣（摘花、殺敵獲得）
    gems: 0,                         // 稀有貨幣（預留）
  },

  updatedAt: Timestamp,
}
```

### 3.4 場景佈置 `game/scene`

```javascript
{
  version: 1,

  decorations: [                     // 用戶擺放的裝飾物
    { itemId: 'deco_tree', x: 50, y: 0, placedAt: Timestamp },
  ],

  theme: 'default',                  // 場景主題（預留）
  bgColor: null,                     // 自訂背景色（預留）
  music: 'default',                  // 背景音樂（預留）

  updatedAt: Timestamp,
}
```

### 3.5 公開名片 `gamePublic/profile`

```javascript
{
  displayName: 'Kere',              // LINE 暱稱（自動同步）
  customName: '小白白',              // 自訂遊戲名
  skin: 'whiteCat',
  level: 3,
  mbti: 'INFP',
  equipped: { hat: null, top: null, accessory: null },

  // 社交設定
  allowVisit: true,
  allowPvp: true,
  allowTrade: true,
  lastOnline: Timestamp,
  status: 'online',                  // online/offline/busy/away

  updatedAt: Timestamp,
}
```

### 3.6 公開場景快照 `gamePublic/scene`

```javascript
{
  flowers: [ ... ],                  // 同 save.scene.flowers
  ball: { x: 180, y: 50 },
  graves: [ ... ],
  decorations: [ ... ],             // 同 game/scene.decorations
  weather: { type: 'rain', intensity: 0.7, changedAt: Timestamp },

  updatedAt: Timestamp,
}
```

### 3.7 互動收件匣 `gameInbox/{docId}`

```javascript
{
  type: 'visit',                     // visit/poke/gift/raid/trade_request/pvp_result/system
  fromUid: 'visitor_uid',
  fromName: '小黑',
  fromSkin: 'blackCat',

  payload: {
    // type=visit → { message: '來看看你~' }
    // type=gift → { itemId: 'potion_hp', quantity: 1 }
    // type=raid → { action: 'steal_flower', stolenCount: 2 }
    //             { action: 'kick_ball', ballNewX: 300 }
    //             { action: 'scare_cat', effect: 'run_away' }
    //             { action: 'leave_mark', markType: 'footprint', x: 100, expiresAt: Timestamp }
    //             { action: 'spawn_enemy', enemySkin: 'slime_green' }
    // type=pvp_result → { winner: 'uid', damageDealt: 45, reward: { coins: 50 } }
    // type=trade_request → { offeredItems: [...], requestedItems: [...] }
  },

  timestamp: Timestamp,
  read: false,
  processed: false,                  // 是否已套用效果（防重複）
}
```

### 3.8 交易 `gameTradeOffers/{docId}`

```javascript
{
  status: 'pending',                 // pending/accepted/rejected/expired/cancelled

  fromUid: 'xxx',
  fromName: '小黑',
  toUid: 'yyy',
  toName: '小白白',

  offered: [ { itemId: 'hat_crown', quantity: 1 } ],
  requested: [ { itemId: 'potion_hp', quantity: 3 } ],

  createdAt: Timestamp,
  expiresAt: Timestamp,              // 24 小時後自動過期
  respondedAt: null,
}
```

### 3.9 PvP 戰鬥紀錄 `gamePvpLog/{docId}`

```javascript
{
  attackerUid: 'xxx',
  attackerName: '小黑',
  attackerSkin: 'blackCat',
  attackerLevel: 5,

  defenderUid: 'yyy',
  defenderName: '小白白',
  defenderSkin: 'whiteCat',
  defenderLevel: 3,

  winner: 'xxx',                     // 由 Cloud Function 裁定
  rounds: 3,
  damageLog: [ ... ],                // 預留：回放用

  rewards: {
    winner: { coins: 100, exp: 50 },
    loser: { coins: -20 },
  },
  raidEffects: [                     // 勝者可對敗者場景搞破壞
    { action: 'steal_flower', count: 1 },
    { action: 'kick_ball' },
  ],

  timestamp: Timestamp,
  processed: false,
}
```

---

## 四、Firebase Realtime Database 結構（即時同步用）

> 選用 RTDB 而非 Firestore 做位置同步，因為高頻小資料更新用 Firestore 太貴。

```
/presence/
  {hostUid}/
    online: true
    lastSeen: 1711180800000
    visitors/
      {visitorUid}/
        x: 120
        y: 50
        action: 'walk'              // idle/walk/run/jump/attack/sleep...
        facing: 1                    // 1=右, -1=左
        skin: 'blackCat'
        name: '小黑'
        timestamp: 1711180800123

/ballSync/
  {hostUid}/
    x: 180
    y: 30
    vx: 2.5
    vy: -1.0
    lastKickBy: 'visitorUid'
    timestamp: 1711180800456
```

### RTDB vs Firestore 成本比較（位置同步場景）

| 操作 | Firestore | RTDB |
|------|-----------|------|
| 每 200ms 更新位置 | $0.18/100K writes → 很貴 | 免費額度 1GB 傳輸/月 |
| 即時監聽延遲 | ~200-500ms | ~50-100ms |
| 斷線偵測 | 無內建 | onDisconnect 自動清理 |
| 結論 | ❌ 不適合高頻更新 | ✅ 專為此場景設計 |

---

## 五、角色命名系統

```
LINE 暱稱（自動帶入，不可編輯）
  displayName: 'Kere'
  來源：App.currentUser.displayName 或 LINE LIFF profile

遊戲暱稱（用戶自訂，可隨時修改）
  customName: '小白白'
  預設值：角色皮膚預設名（小白/小黑/藍兔/粉兔）
  限制：2~12 字元、escapeHTML 過濾、敏感詞過濾接口預留
  儲存：game/save → character.customName + gamePublic/profile → customName

顯示規則：
  自己場景    → customName
  拜訪別人    → customName
  被拜訪時    → 訪客的 customName
  排行榜/PvP  → customName (LINE暱稱)
```

---

## 六、氣候系統

### 6.1 天氣類型

| 類型 | 視覺效果 | 遊戲影響 |
|------|----------|----------|
| `clear` 晴天 | 明亮背景 | 無 |
| `cloudy` 多雲 | 略暗背景 | 無 |
| `rain` 下雨 | 雨滴粒子 + 暗背景 | 花朵生長加速 |
| `thunderstorm` 雷暴 | 雨 + 閃電 + 極暗 | 閃電隨機擊暈角色 |
| `snow` 下雪 | 雪花粒子 + 白背景 | 花朵生長減慢 |
| `fog` 霧 | 霧氣覆蓋 + 能見度低 | 敵人可能躲在霧中 |

### 6.2 天氣變化邏輯

- 本地計算，不耗 Firestore
- 根據 `weather.changedAt` 判斷是否該換天氣
- 每 2~6 小時自動變化（隨機間隔）
- 天氣權重：晴天 40%、多雲 25%、雨 15%、雷暴 5%、雪 10%、霧 5%
- 存檔時寫入 `scene.weather`，下次開啟恢復
- 訪客看到的天氣 = 讀取 host 的 `gamePublic/scene.weather`

---

## 七、遊玩場景與同步架構

### 7.1 場景切換圖

```
┌─────────────────────────────────────────────────┐
│  個人資訊頁（自己的家）                            │
│  ├─ 讀取自己的 game/save                          │
│  ├─ 自己的花、球、墓碑、天氣、裝飾                 │
│  ├─ 自己操控自己的角色                             │
│  └─ 別人來拜訪時：                                │
│     ├─ RTDB 監聽 presence/{myUid}/visitors        │
│     ├─ 有訪客 → 渲染訪客角色（讀 RTDB 位置）       │
│     └─ 訪客做了什麼 → gameInbox 通知 or 即時看到    │
│                                                   │
│  用戶名片頁（別人的家）                            │
│  ├─ 讀取對方 gamePublic/profile + gamePublic/scene │
│  ├─ 渲染對方的場景（花、球、天氣、裝飾）            │
│  ├─ 渲染對方角色（AI 或即時同步）                   │
│  ├─ 自己操控自己的角色在對方場景互動                 │
│  └─ 重要動作（摘花、踢球）→ Cloud Function 驗證     │
└─────────────────────────────────────────────────┘
```

### 7.2 同步方案：半即時（RTDB 位置 + Firestore 事件）

```
位置/動作/朝向 → RTDB（每 200ms，低成本、低延遲）
重要動作（摘花、踢球、攻擊） → Cloud Function → Firestore（防作弊）
B 不在線時 → 降級為信箱制（寫入 gameInbox）
```

| 資料 | 同步方式 | 頻率 | 延遲 |
|------|----------|------|------|
| 角色位置 x, y | RTDB | 每 200ms | ~50-100ms |
| 角色動作 action | RTDB | 動作變化時 | ~50-100ms |
| 角色朝向 facing | RTDB | 變化時 | ~50-100ms |
| 摘花 | Cloud Function → Firestore | 事件觸發 | ~500ms |
| 踢球 | RTDB（球位置） | 事件觸發 | ~100ms |
| 攻擊/PvP | Cloud Function | 事件觸發 | ~500ms |
| 天氣 | 不同步（各讀 host 場景） | 讀取時 | — |

### 7.3 訪客生命週期

```
A 進入 B 的名片頁
  │
  ├─ 讀取 B 的 gamePublic（2 Firestore reads）
  ├─ 寫入 RTDB: presence/{B}/visitors/{A} = { x, y, action, ... }
  ├─ 設定 onDisconnect().remove()（斷線自動清理）
  ├─ 開始每 200ms 更新位置到 RTDB
  │
  ├─ B 端（如果在線）：
  │   ├─ 監聽 presence/{B}/visitors → 發現 A
  │   ├─ 渲染 A 的角色（讀 RTDB 位置+動作）
  │   └─ A 做重要動作 → B 即時看到場景變化
  │
  └─ A 離開 B 的名片頁
      ├─ 移除 RTDB: presence/{B}/visitors/{A}
      └─ B 端：訪客角色消失
```

---

## 八、存檔觸發機制

| 觸發點 | 存到哪 | 為什麼 |
|--------|--------|--------|
| 摘花/殺敵/升級 | localStorage（即時） | 關鍵動作不能丟，零成本 |
| 每 5 分鐘定時 | Firestore | 定期雲端備份 |
| `visibilitychange`（切分頁/最小化） | Firestore | 用戶可能不會回來 |
| `beforeunload`（關閉分頁） | localStorage（同步）+ Firestore（嘗試） | 最後機會存檔 |
| 用戶手動存檔（按鈕） | Firestore | 用戶安心 |
| 改名/換裝/擺設 | Firestore（立即） | 社交資料需即時更新 |
| 開啟遊戲 | 讀 Firestore → 覆蓋 localStorage | 確保最新存檔 |

### 手機殺 APP / 瀏覽器崩潰

- 最多丟失最近一次「關鍵動作存檔」到「上次 5 分鐘定時」之間的閒逛資料
- 重要進度（摘花、殺敵）已即時存入 localStorage，不會丟

---

## 九、防作弊分層設計

| 層級 | 保護目標 | 機制 | 何時做 |
|------|----------|------|--------|
| L1 Rules 身分 | 只能改自己的資料 | `request.auth.uid == uid` | 第一期 |
| L2 Rules 欄位 | 數值合理範圍 | 型別+範圍限制 | 第一期 |
| L3 頻率限制 | 防刷騷擾/交易 | Cloud Function 檢查冷卻 | 第二期 |
| L4 Server 裁定 | PvP/交易結果 | Cloud Function 計算 | 第三期 |
| L5 異常偵測 | 數值暴增偵測 | Cloud Function 定期掃描 | 未來 |

### Firestore Rules

```javascript
// 私有遊戲資料：本人讀寫
match /users/{uid}/game/{doc} {
  allow read, write: if request.auth.uid == uid;
}

// 公開名片：本人寫，登入用戶可讀
match /users/{uid}/gamePublic/{doc} {
  allow read: if request.auth != null;
  allow write: if request.auth.uid == uid;
}

// 互動收件匣：本人可讀可刪，他人可建立
match /users/{uid}/gameInbox/{docId} {
  allow read, delete: if request.auth.uid == uid;
  allow create: if request.auth != null
    && request.auth.uid != uid
    && request.resource.data.fromUid == request.auth.uid;
}

// 交易/PvP：本人可讀，寫入由 Cloud Function 處理
match /users/{uid}/gameTradeOffers/{docId} {
  allow read: if request.auth.uid == uid;
}
match /users/{uid}/gamePvpLog/{docId} {
  allow read: if request.auth.uid == uid;
}
```

---

## 十、資料版本升級策略

```javascript
// 讀取存檔時自動升級
function migrateGameSave(data) {
  if (!data.version) data.version = 1;

  if (data.version < 2) {
    // v2: 新增寵物系統
    data.pets = { equipped: null, collection: [] };
    data.version = 2;
  }

  if (data.version < 3) {
    // v3: 新增季節活動
    data.seasonData = {};
    data.version = 3;
  }

  // 原則：只新增欄位，不刪除/改名舊欄位
  return data;
}
```

---

## 十一、額度估算

### 單人遊玩（無社交）

| 操作 | 每人每小時 | 服務 |
|------|-----------|------|
| 開啟讀檔 | 1 read | Firestore |
| 定時存檔 | ~12 writes | Firestore |
| 公開名片同步 | ~1 write | Firestore |
| **小計** | 1 read + 13 writes | — |

### 一次拜訪（10 分鐘）

| 操作 | 數量 | 服務 |
|------|------|------|
| 載入場景 | 2 reads | Firestore |
| 位置同步 | ~3000 次 | RTDB（~600KB） |
| 摘花 3 朵 | 3 CF calls + 6 writes | Firestore + Functions |
| 踢球 5 次 | 5 writes | RTDB（~500 bytes） |

### 月度總估算（100 用戶、每天各玩 30 分 + 拜訪 3 次）

| 服務 | 月用量 | 免費額度 | 佔比 |
|------|--------|----------|------|
| RTDB 傳輸 | ~5.4 GB | 10 GB | 54% |
| RTDB 同時連線 | <20 | 100 | <20% |
| Firestore reads | ~18K | 1.5M | 1.2% |
| Firestore writes | ~54K | 600K | 9% |
| Functions calls | ~27K | 2M | 1.4% |

**結論：完全在 Spark 免費額度內。**

---

## 十二、現有功能影響評估

| 影響範圍 | 風險等級 | 說明 |
|----------|----------|------|
| 遊戲核心邏輯 | **無** | 只新增存讀接口，不改現有遊戲運算 |
| localStorage 暫存 | **無** | 保留現有機制，雲端為上層補充 |
| 主站其他功能 | **無** | 用 `users/{uid}/game/*` subcollection，與其他集合完全隔離 |
| Firestore 用量 | **極低** | 佔免費額度 <10% |
| 前端載入速度 | **無** | 存讀檔為非同步，不阻塞遊戲啟動 |
| GrowthGames.html（測試頁） | **無** | 保留 localStorage only，不加 Firebase |

---

## 十三、預留設計（用戶未提但未來會需要）

| 項目 | 預留方式 | 理由 |
|------|----------|------|
| 離線遊玩→上線合併 | `savedAt` 時間戳比對取較新者 | 可能在沒網路時玩 |
| 多角色存檔 | `game/saves/{slotId}` 可擴展 | 可能想玩不同角色 |
| 成就系統 | `lifetime` 已含各種累計數據 | 判斷達成條件只需讀 lifetime |
| 排行榜 | `gamePublic` 已有 level + lifetime | Cloud Function 定期彙整 |
| 好友系統 | `gameInbox` 可擴展 type=friend_request | 不需新 collection |
| 公會/組隊 | `game/save` 可加 `guildId` 欄位 | 結構不衝突 |
| 場景主題/背景 | `game/scene` 已有 theme + bgColor | 商城賣場景 |
| 季節活動 | `game/save` 加 `seasonData: {}` | 活動結束後歸檔 |
| 觀戰模式 | `gamePublic/scene` 是完整場景快照 | 即時觀戰改用 onSnapshot |
| 反騷擾/黑名單 | `game/settings` 加 `blockedUids: []` | 拜訪時前端過濾 |
| 禮物追溯 | `gameInbox` type=gift 已設計 | 可查送禮歷史 |
| 道具耐久度 | `inventory.items` 可加 durability | version 升級時補上 |
| 背景音樂 | `game/scene.music` 已預留 | 不同場景不同音樂 |
| 角色表情/動作 | RTDB visitor 資料可加 emote 欄位 | 社交表達 |
| 留言板 | `gameInbox` type=message | 離線留言 |

---

## 十四、施作計畫

### 第一期：存讀檔 + 場景持久化 + 命名 + 天氣（現在做）

| 步驟 | 檔案 | 內容 | 類型 |
|------|------|------|------|
| 1a | `color-cat-cloud-save.js` | Firestore 存讀檔核心 + 公開名片同步 | **新增** |
| 1b | `color-cat-stats.js` | `toFullJSON()` / `loadFull()` + version 升級邏輯 | 修改 |
| 1c | `color-cat-scene-flower.js` | `exportFlowers()` / `importFlowers()` | 修改 |
| 1d | `color-cat-ball.js` | `exportBall()` / `importBall()` | 修改 |
| 1e | `color-cat-scene-grave.js` | `exportGraves()` / `importGraves()` | 修改 |
| 1f | `color-cat-scene.js` | 存檔觸發器 + 天氣欄位 + 開局讀檔流程 | 修改 |
| 1g | `color-cat-scene-weather.js` | 天氣渲染（雨/雷/雪/霧粒子效果）+ 天氣變化邏輯 | **新增** |
| 1h | `color-cat-naming.js` | 取名 UI（輸入框+驗證+LINE 暱稱帶入） | **新增** |
| 1i | `color-cat-profile.js` | 顯示 customName + displayName | 修改 |
| 1j | `firestore.rules` | 新增 game/* / gamePublic/* 規則 | 修改 |
| 1k | 快取版本 + QA | js/config.js, index.html, sw.js | 修改 |

**預估：新增 3 檔、修改 8 檔，約 500 行新增代碼**

### 第二期：社交基礎（拜訪 + 即時同步 + 騷擾）

| 步驟 | 檔案 | 內容 |
|------|------|------|
| 2a | Firebase Console | 啟用 Realtime Database |
| 2b | `color-cat-social.js` | 拜訪入口 + 好友列表 + 訪客場景載入 | **新增** |
| 2c | `color-cat-presence.js` | RTDB 位置同步 + onDisconnect | **新增** |
| 2d | `color-cat-visitor-render.js` | 渲染訪客角色 | **新增** |
| 2e | `color-cat-inbox.js` | 收件匣 UI + 通知 badge | **新增** |
| 2f | `color-cat-raid.js` | 騷擾動作（踢球/偷花/嚇貓/留記號/放敵人） | **新增** |
| 2g | `functions/index.js` | `processRaidAction` Cloud Function | 修改 |

### 第三期：PvP + 交易 + 道具

| 步驟 | 檔案 | 內容 |
|------|------|------|
| 3a | `color-cat-inventory.js` | 道具背包 UI + 穿脫裝備 | **新增** |
| 3b | `color-cat-pvp.js` | PvP 戰鬥 UI + 結果展示 | **新增** |
| 3c | `color-cat-trade.js` | 交易 UI + 流程 | **新增** |
| 3d | `functions/index.js` | `validatePvpChallenge` / `createTradeOffer` / `respondToTrade` | 修改 |

---

## 十五、驗收標準

### 第一期完成條件

- [ ] 開啟遊戲自動從 Firestore 讀取存檔
- [ ] 關閉/切走分頁自動存檔到 Firestore
- [ ] 摘花、殺敵等關鍵動作即時存 localStorage
- [ ] 花朵、球、墓碑重開後位置不變
- [ ] 天氣每 2~6 小時自動變化，重開後恢復
- [ ] 用戶可自訂遊戲暱稱，LINE 暱稱自動帶入
- [ ] 未登入時降級為 localStorage only
- [ ] Firestore Rules 限制本人讀寫
- [ ] 不影響現有 GrowthGames.html 測試頁
- [ ] 不影響主站其他功能
