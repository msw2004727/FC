"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const catalog = require("../../functions/sport-catalog");

// 來源：FC-B origin/main 5964a55c src/features/events/data/sports.ts（Q7 鎖定）
const EXPECTED_FCB_SPORTS = [
  ["football", "足球"],
  ["basketball", "籃球"],
  ["pickleball", "匹克球"],
  ["dodgeball", "美式躲避球"],
  ["restaurant", "餐廳(觀賽)"],
  ["escape_room", "密室逃脫"],
  ["esports", "電玩電競"],
  ["baseball_softball", "棒壘球"],
  ["volleyball", "排球"],
  ["table_tennis", "桌球"],
  ["tennis", "網球"],
  ["badminton", "羽球"],
  ["hiking", "登山"],
  ["running", "慢跑"],
  ["cycling", "單車"],
  ["motorcycle", "重機"],
  ["skateboard", "滑板"],
  ["dance", "舞蹈"],
  ["yoga", "瑜伽"],
  ["martial_arts", "武術"],
  ["other", "其他"],
];

describe("sport-catalog", () => {
  test("T-CAT-01 清單鎖定 21 項、順序與名稱", () => {
    expect(catalog.SPORT_CATALOG.map((s) => [s.tag, s.label])).toEqual(EXPECTED_FCB_SPORTS);
  });

  test("T-CAT-02 FAV 清單不含 other、20 項、不重複", () => {
    expect(catalog.FAV_SPORT_TAGS).toHaveLength(20);
    expect(catalog.FAV_SPORT_TAGS).not.toContain("other");
    expect(new Set(catalog.FAV_SPORT_TAGS).size).toBe(20);
    expect(catalog.FAV_SPORTS_MAX).toBe(20);
  });

  test("T-CAT-03 縣市 22 項全用「台」", () => {
    expect(catalog.TW_CITIES).toHaveLength(22);
    for (const city of catalog.TW_CITIES) {
      expect(city).not.toContain("臺");
    }
    const union = new Set();
    for (const cities of Object.values(catalog.REGION_CITY_MAP)) {
      for (const city of cities) union.add(city);
    }
    expect(union).toEqual(new Set(catalog.TW_CITIES));
  });

  test("T-CAT-04 normalizeCity", () => {
    expect(catalog.normalizeCity("臺北市")).toBe("台北市");
    expect(catalog.normalizeCity(" 臺東縣 ")).toBe("台東縣");
    expect(catalog.normalizeCity(null)).toBe("");
    expect(catalog.normalizeCity(5)).toBe("");
    expect(catalog.normalizeCity("其他")).toBe("其他");
  });

  test("T-CAT-05 buildSportRank 排序與過濾", () => {
    const events = [];
    for (let i = 0; i < 3; i += 1) events.push({ sportTag: "football" });
    for (let i = 0; i < 3; i += 1) events.push({ sportTag: "badminton" });
    events.push({ sportTag: "tennis" });
    for (let i = 0; i < 5; i += 1) events.push({ sportTag: "other" });
    for (let i = 0; i < 4; i += 1) events.push({ sportTag: "football", privateEvent: true });
    for (let i = 0; i < 4; i += 1) events.push({ sportTag: "football", teamOnly: true });
    for (let i = 0; i < 4; i += 1) events.push({ sportTag: "football", type: "external" });
    for (let i = 0; i < 2; i += 1) events.push({ sportTag: "xx" });
    expect(catalog.buildSportRank(events)).toEqual(["football", "badminton", "tennis"]);
  });

  test("T-CAT-06 buildSportRank 非陣列", () => {
    expect(catalog.buildSportRank(null)).toEqual([]);
  });

  test("T-CAT-07 parity 腳本可對字面常數驗證", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fcb-parity-"));
    const dataDir = path.join(dir, "src", "features", "events", "data");
    fs.mkdirSync(dataDir, { recursive: true });
    const lines = EXPECTED_FCB_SPORTS.map(([tag, label]) => (
      `  { key: '${tag}', label: '${label}', sportTag: '${tag}' },`
    ));
    const content = `export const SPORTS = [\n${lines.join("\n")}\n];\n`;
    fs.writeFileSync(path.join(dataDir, "sports.ts"), content, "utf8");
    const script = path.join(__dirname, "..", "..", "scripts", "check-sport-catalog-parity.js");
    const ok = spawnSync(process.execPath, [script, dir], { encoding: "utf8" });
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain("OK 21 項");

    const badContent = content.replace("label: '足球'", "label: '足球X'");
    fs.writeFileSync(path.join(dataDir, "sports.ts"), badContent, "utf8");
    const bad = spawnSync(process.execPath, [script, dir], { encoding: "utf8" });
    expect(bad.status).toBe(1);

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
