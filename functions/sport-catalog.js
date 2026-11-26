"use strict";
// 伺服器端運動清單：tag 與繁中名稱，順序與 FC-B src/features/events/data/sports.ts 的 SPORTS 相同（含 other）。
// 改這份清單必須同批改 FC-B，並更新 tests/unit/sport-catalog.test.js 的字面常數（Q7）。
const SPORT_CATALOG = Object.freeze([
  Object.freeze({ tag: "football", label: "足球" }),
  Object.freeze({ tag: "basketball", label: "籃球" }),
  Object.freeze({ tag: "pickleball", label: "匹克球" }),
  Object.freeze({ tag: "dodgeball", label: "美式躲避球" }),
  Object.freeze({ tag: "restaurant", label: "餐廳(觀賽)" }),
  Object.freeze({ tag: "escape_room", label: "密室逃脫" }),
  Object.freeze({ tag: "esports", label: "電玩電競" }),
  Object.freeze({ tag: "baseball_softball", label: "棒壘球" }),
  Object.freeze({ tag: "volleyball", label: "排球" }),
  Object.freeze({ tag: "table_tennis", label: "桌球" }),
  Object.freeze({ tag: "tennis", label: "網球" }),
  Object.freeze({ tag: "badminton", label: "羽球" }),
  Object.freeze({ tag: "hiking", label: "登山" }),
  Object.freeze({ tag: "running", label: "慢跑" }),
  Object.freeze({ tag: "cycling", label: "單車" }),
  Object.freeze({ tag: "motorcycle", label: "重機" }),
  Object.freeze({ tag: "skateboard", label: "滑板" }),
  Object.freeze({ tag: "dance", label: "舞蹈" }),
  Object.freeze({ tag: "yoga", label: "瑜伽" }),
  Object.freeze({ tag: "martial_arts", label: "武術" }),
  Object.freeze({ tag: "other", label: "其他" }),
]);
const SPORT_OTHER_TAG = "other";
const FAV_SPORT_TAGS = Object.freeze(SPORT_CATALOG.filter((s) => s.tag !== SPORT_OTHER_TAG).map((s) => s.tag)); // 20 項
const FAV_SPORTS_MAX = 20;

// 22 縣市（全用「台」），順序照 FC-B TW_REGIONS
const TW_CITIES = Object.freeze([
  "台北市", "新北市", "桃園市", "台中市", "台南市", "高雄市",
  "基隆市", "新竹市", "嘉義市",
  "新竹縣", "苗栗縣", "彰化縣", "南投縣", "雲林縣", "嘉義縣",
  "屏東縣", "宜蘭縣", "花蓮縣", "台東縣",
  "澎湖縣", "金門縣", "連江縣",
]);
// 四大區，照 FC-B REGION_MAP
const REGION_CITY_MAP = Object.freeze({
  "中部": Object.freeze(["台中市", "苗栗縣", "彰化縣", "南投縣", "雲林縣"]),
  "北部": Object.freeze(["台北市", "新北市", "基隆市", "桃園市", "新竹市", "新竹縣", "宜蘭縣"]),
  "南部": Object.freeze(["高雄市", "台南市", "嘉義市", "嘉義縣", "屏東縣"]),
  "東部&外島": Object.freeze(["花蓮縣", "台東縣", "澎湖縣", "金門縣", "連江縣"]),
});

function isFavSportTag(tag) {
  return typeof tag === "string" && FAV_SPORT_TAGS.includes(tag);
}

function sportLabelOf(tag) {
  const found = SPORT_CATALOG.find((s) => s.tag === tag);
  return found ? found.label : "";
}

function normalizeCity(value) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/臺/g, "台");
}

function isKnownCity(value) {
  return TW_CITIES.includes(normalizeCity(value));
}

function buildSportRank(events) {
  if (!Array.isArray(events)) return [];
  const counts = new Map();
  for (const e of events) {
    if (!e || typeof e !== "object") continue;
    if (!isFavSportTag(e.sportTag)) continue;
    if (e.privateEvent === true || e.teamOnly === true || e.type === "external") continue;
    counts.set(e.sportTag, (counts.get(e.sportTag) || 0) + 1);
  }
  const orderIndex = new Map(SPORT_CATALOG.map((s, i) => [s.tag, i]));
  return [...counts.entries()]
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return orderIndex.get(a[0]) - orderIndex.get(b[0]);
    })
    .map(([tag]) => tag);
}

module.exports = {
  SPORT_CATALOG,
  SPORT_OTHER_TAG,
  FAV_SPORT_TAGS,
  FAV_SPORTS_MAX,
  TW_CITIES,
  REGION_CITY_MAP,
  isFavSportTag,
  sportLabelOf,
  normalizeCity,
  isKnownCity,
  buildSportRank,
};
