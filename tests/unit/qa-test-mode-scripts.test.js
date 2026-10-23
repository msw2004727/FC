"use strict";

const fs = require("fs");
const path = require("path");
const lib = require("../../scripts/qa-test-mode/lib");

const ROOT = path.resolve(__dirname, "../..");
const SCRIPT_DIR = path.join(ROOT, "scripts", "qa-test-mode");
const EMULATOR_ENV = {
  FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
  FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
};

function walk(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

describe("qa-test-mode scripts", () => {
  describe("resolveTarget", () => {
    const project = { project: "demo-qa-test" };

    it("缺 --project 丟錯", () => {
      expect(() => lib.resolveTarget({ args: {}, env: {} })).toThrow();
    });

    it("只設一個 emulator env 丟錯", () => {
      expect(() => lib.resolveTarget({
        args: project,
        env: { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" },
      })).toThrow();
      expect(() => lib.resolveTarget({
        args: project,
        env: { FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099" },
      })).toThrow();
    });

    it("兩個都設 → emulator 且預設 write:false", () => {
      expect(lib.resolveTarget({ args: project, env: EMULATOR_ENV })).toEqual({
        mode: "emulator",
        projectId: "demo-qa-test",
        write: false,
      });
    });

    it("emulator＋--execute → write:true", () => {
      const result = lib.resolveTarget({
        args: { ...project, execute: true },
        env: EMULATOR_ENV,
      });
      expect(result.mode).toBe("emulator");
      expect(result.write).toBe(true);
    });

    it("正式（無 emulator env）無 --production 丟錯", () => {
      expect(() => lib.resolveTarget({ args: project, env: {} })).toThrow();
    });

    it("正式＋--production 預設 write:false", () => {
      expect(lib.resolveTarget({
        args: { ...project, production: true },
        env: {},
      })).toEqual({
        mode: "production",
        projectId: "demo-qa-test",
        write: false,
      });
    });

    it("正式＋--production --execute 缺 --confirm-project 丟錯", () => {
      expect(() => lib.resolveTarget({
        args: { ...project, production: true, execute: true },
        env: {},
      })).toThrow();
    });

    it("正式 confirm 值不符丟錯", () => {
      expect(() => lib.resolveTarget({
        args: {
          ...project,
          production: true,
          execute: true,
          confirmProject: "other-project",
        },
        env: {},
      })).toThrow();
    });

    it("正式 confirm 符合才 write:true", () => {
      expect(lib.resolveTarget({
        args: {
          ...project,
          production: true,
          execute: true,
          confirmProject: "demo-qa-test",
        },
        env: {},
      })).toEqual({
        mode: "production",
        projectId: "demo-qa-test",
        write: true,
      });
    });

    it("沒有 --project 時可用 GCLOUD_PROJECT", () => {
      expect(lib.resolveTarget({
        args: { production: true },
        env: { GCLOUD_PROJECT: "demo-from-env" },
      })).toEqual({
        mode: "production",
        projectId: "demo-from-env",
        write: false,
      });
    });
  });

  describe("parseArgs", () => {
    it("讀取旗標並拒絕未知旗標", () => {
      expect(lib.parseArgs([
        "node", "setup-config.js", "--project", "demo-qa-test", "--execute", "--enable",
      ])).toMatchObject({
        project: "demo-qa-test",
        execute: true,
        enable: true,
        production: false,
        help: false,
      });
      expect(() => lib.parseArgs(["node", "setup-config.js", "--nope"])).toThrow();
    });
  });

  describe("buildConfigDoc", () => {
    const personas = lib.defaultPersonas();

    it("預設 enabled:false", () => {
      const doc = lib.buildConfigDoc({
        existing: null,
        enable: false,
        personas,
        teamId: "tm_test",
      });
      expect(doc.enabled).toBe(false);
      expect(doc.clientIpXffFromRight).toBe(1);
      expect(doc.sessionCapHours).toBe(12);
      expect(doc.maxFutureHours).toBe(168);
      expect(doc.throttle.perIp).toEqual({ maxFailures: 5, windowSec: 600, lockSec: 900 });
      expect(doc.throttle.global).toEqual({ maxFailures: 100, windowSec: 600, lockSec: 300 });
      expect(doc.teams.main).toEqual({ teamId: "tm_test", name: "QA測試俱樂部" });
    });

    it("--enable 才 true", () => {
      const doc = lib.buildConfigDoc({
        existing: { enabled: false },
        enable: true,
        personas,
        teamId: "tm_test",
      });
      expect(doc.enabled).toBe(true);
    });

    it("冪等：保留既有 teamId 與既有 persona 設定", () => {
      const first = lib.buildConfigDoc({
        existing: null,
        enable: true,
        personas,
        teamId: "tm_keep",
      });
      first.personas.captain = {
        ...first.personas.captain,
        displayName: "QA測試-自訂隊長",
        enabled: false,
      };
      const second = lib.buildConfigDoc({
        existing: first,
        enable: false,
        personas,
        teamId: "tm_other",
      });
      expect(second.enabled).toBe(true);
      expect(second.teams.main.teamId).toBe("tm_keep");
      expect(second.personas.captain.displayName).toBe("QA測試-自訂隊長");
      expect(second.personas.captain.enabled).toBe(false);
      expect(second.personas.memberB.displayName).toBe("QA測試-會員乙");
      expect(second.clientIpXffFromRight).toBe(1);
    });

    it("clientIpXffFromRight 保留 1～5 整數，非法則回 1", () => {
      expect(lib.QA_CLIENT_IP_XFF_FROM_RIGHT).toBe(1);
      const base = { personas, teamId: "tm_test" };
      expect(lib.buildConfigDoc({ ...base, existing: null }).clientIpXffFromRight).toBe(1);
      expect(lib.buildConfigDoc({ ...base, existing: {} }).clientIpXffFromRight).toBe(1);
      for (const value of [1, 2, 3, 4, 5]) {
        expect(lib.buildConfigDoc({
          ...base,
          existing: { clientIpXffFromRight: value },
        }).clientIpXffFromRight).toBe(value);
      }
      for (const value of [0, 6, -1, 1.5, "3", null, undefined, true, NaN]) {
        expect(lib.buildConfigDoc({
          ...base,
          existing: { clientIpXffFromRight: value },
        }).clientIpXffFromRight).toBe(1);
      }
    });
  });

  describe("findDangerousClaimKeys", () => {
    it("null 與非物件回空陣列", () => {
      expect(lib.findDangerousClaimKeys(null)).toEqual([]);
      expect(lib.findDangerousClaimKeys(undefined)).toEqual([]);
      expect(lib.findDangerousClaimKeys("role")).toEqual([]);
      expect(lib.findDangerousClaimKeys(1)).toEqual([]);
      expect(lib.findDangerousClaimKeys(["role"])).toEqual([]);
    });

    it("無害的 qa* 鍵不算", () => {
      expect(lib.findDangerousClaimKeys({
        qa: true,
        qaTeamId: "tm",
        qaExp: 1,
        qaAgent: "check",
        qaPersona: "captain",
      })).toEqual([]);
    });

    it("role 算、rolePermissionsX 算，大小寫敏感", () => {
      expect(lib.findDangerousClaimKeys({ role: "captain" })).toEqual(["role"]);
      expect(lib.findDangerousClaimKeys({ rolePermissionsX: ["kick"] })).toEqual(["rolePermissionsX"]);
      expect(lib.findDangerousClaimKeys({ Role: "captain" })).toEqual([]);
      expect(lib.findDangerousClaimKeys({ ROLE: "captain" })).toEqual([]);
      expect(lib.findDangerousClaimKeys({ RolePermissionsX: true })).toEqual([]);
      expect(lib.findDangerousClaimKeys({ rolepermissionsX: true })).toEqual([]);
      expect(lib.findDangerousClaimKeys({
        admin: true,
        isAdmin: false,
        super_admin: 1,
        superAdmin: 1,
        permissions: ["*"],
        permissionsExtra: ["read"],
        rolePermissions: { a: 1 },
        roleExtra: "no",
        adminExtra: true,
        isAdministrator: true,
        superadmin: true,
        qa: true,
      })).toEqual([
        "admin",
        "isAdmin",
        "super_admin",
        "superAdmin",
        "permissions",
        "permissionsExtra",
        "rolePermissions",
      ]);
    });
  });

  describe("buildUserDoc", () => {
    const personas = lib.defaultPersonas();
    const team = { teamId: "tm_1", name: "QA測試俱樂部" };
    const now = { marker: "server-timestamp" };

    it("入隊者欄位與 memberB 不入隊", () => {
      const captain = lib.buildUserDoc({ persona: personas.captain, team, now });
      expect(captain.uid).toBe(personas.captain.uid);
      expect(captain.lineUserId).toBe(captain.uid);
      expect(captain.exp).toBe(0);
      expect(captain.level).toBe(1);
      expect(captain.role).toBe("captain");
      expect(captain.teamIds).toEqual(["tm_1"]);
      expect(captain.teamNames).toEqual(["QA測試俱樂部"]);
      expect(captain.displayName.startsWith(lib.QA_DISPLAY_NAME_PREFIX)).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(captain, "lineNotify")).toBe(false);
      expect(JSON.stringify(captain).includes("lineNotify")).toBe(false);
      expect(captain.createdAt).toBe(now);
      expect(captain.lastLogin).toBe(now);

      const memberB = lib.buildUserDoc({ persona: personas.memberB, team, now });
      expect(memberB.teamId).toBeNull();
      expect(memberB.teamName).toBeNull();
      expect(memberB.teamIds).toEqual([]);
      expect(memberB.teamNames).toEqual([]);
      expect(memberB.role).toBe("user");
      expect(Object.prototype.hasOwnProperty.call(memberB, "lineNotify")).toBe(false);
    });
  });

  describe("defaultPersonas", () => {
    it("UID、role、顯示名稱前綴都符合不變量", () => {
      const personas = lib.defaultPersonas();
      expect(Object.keys(personas)).toEqual(["captain", "coach", "memberA", "memberB"]);
      for (const persona of Object.values(personas)) {
        expect(persona.uid).toMatch(lib.QA_UID_RE);
        expect(lib.QA_ALLOWED_ROLES.has(persona.role)).toBe(true);
        expect(persona.displayName.startsWith(lib.QA_DISPLAY_NAME_PREFIX)).toBe(true);
        expect(persona.teamKey).toBe("main");
        expect(persona.enabled).toBe(true);
      }
      expect(personas.captain.uid.endsWith("0001")).toBe(true);
      expect(personas.coach.uid.endsWith("0002")).toBe(true);
      expect(personas.memberA.uid.endsWith("0011")).toBe(true);
      expect(personas.memberB.uid.endsWith("0012")).toBe(true);
    });
  });

  describe("buildTeamDoc", () => {
    it("id、captainUid、coachUids 對應 persona", () => {
      const personas = lib.defaultPersonas();
      const doc = lib.buildTeamDoc({
        teamId: "tm_abc",
        name: "QA測試俱樂部",
        personas,
        memberCount: 3,
        now: "NOW",
      });
      expect(doc.id).toBe("tm_abc");
      expect(doc.captainUid).toBe(personas.captain.uid);
      expect(doc.captain).toBe(personas.captain.displayName);
      expect(doc.captainName).toBe(personas.captain.displayName);
      expect(doc.coachUids).toEqual([personas.coach.uid]);
      expect(doc.coachNames).toEqual([personas.coach.displayName]);
      expect(doc.members).toBe(3);
      expect(doc.type).toBe("competitive");
      expect(doc.sportTag).toBe("");
      expect(doc.teachingEnabled).toBe(false);
      expect(doc.leaderUid).toBeNull();
      expect(doc.leader).toBe("");
      expect(doc.createdAt).toBe("NOW");
      expect(doc.updatedAt).toBe("NOW");
    });
  });

  describe("CLEANUP_CATEGORIES", () => {
    it("正好 11 類，且賽事的 matches 為未盤點", () => {
      const kinds = new Set(["doc", "collectionQuery", "collectionGroup", "authUsers", "readOnly"]);
      expect(lib.CLEANUP_CATEGORIES).toHaveLength(11);
      for (const category of lib.CLEANUP_CATEGORIES) {
        expect(kinds.has(category.kind)).toBe(true);
        expect(category.key).toEqual(expect.any(String));
        expect(category.label).toEqual(expect.any(String));
      }
      expect(lib.CLEANUP_CATEGORIES.map((category) => category.key)).toEqual([
        "userRoot",
        "uidDocCollections",
        "uidFieldCollections",
        "eventSubcollections",
        "events",
        "teams",
        "joinRequests",
        "tournaments",
        "pmPeerCopies",
        "auditEntries",
        "authUsers",
      ]);
      const tournaments = lib.CLEANUP_CATEGORIES.find((category) => category.key === "tournaments");
      expect(tournaments.matches).toBe("未盤點");
    });
  });

  describe("靜態掃描", () => {
    const files = walk(SCRIPT_DIR);

    it("腳本目錄不得寫死專案 ID", () => {
      expect(files.length).toBeGreaterThan(0);
      for (const file of files) {
        const text = fs.readFileSync(file, "utf8");
        expect(text).not.toMatch(/fc-football/i);
        expect(text).not.toMatch(/projectId:\s*["']/);
      }
    });

    it("cleanup-report.js 沒有刪除呼叫", () => {
      const text = fs.readFileSync(path.join(SCRIPT_DIR, "cleanup-report.js"), "utf8");
      expect(text).not.toMatch(/\.delete\(/);
      expect(text).not.toMatch(/recursiveDelete/);
      expect(text).not.toMatch(/batch\.delete/);
    });

    it("emulator-claims-check 預設 dry-run，撤銷前後各等 1500 毫秒", () => {
      const text = fs.readFileSync(path.join(SCRIPT_DIR, "emulator-claims-check.js"), "utf8");
      const readme = fs.readFileSync(path.join(SCRIPT_DIR, "README.md"), "utf8");
      expect(text).toContain("DRY-RUN：將簽發測試 token、換 idToken、refresh、撤銷並再 refresh（不影響任何資料以外狀態）");
      expect(text).toContain("emulator 是否強制執行撤銷僅供參考；正式環境行為以 Firebase 文件為準");
      expect(text).toMatch(/await sleep\(1500\);\s*await auth\.revokeRefreshTokens\(CHECK_UID\);\s*await sleep\(1500\);/);
      expect(text).toMatch(/target\.write !== true/);
      expect(readme).toMatch(/emulator-claims-check\.js --project demo-qa-test --execute/);
      expect(readme).toContain("部署後若發現 ipHash 不穩定或把所有人算成同一個，調整此值，無須重新部署");
    });

    it("provision-accounts 會檢查危險 claim 鍵名", () => {
      const text = fs.readFileSync(path.join(SCRIPT_DIR, "provision-accounts.js"), "utf8");
      expect(text).toContain("findDangerousClaimKeys(user.customClaims)");
      expect(text).toContain("customClaims 含不安全鍵名");
    });

    it("js 檔沒有 lineNotify 賦值", () => {
      const jsFiles = files.filter((file) => file.endsWith(".js"));
      expect(jsFiles.length).toBeGreaterThan(0);
      for (const file of jsFiles) {
        const text = fs.readFileSync(file, "utf8");
        expect(text).not.toMatch(/lineNotify:/);
      }
    });
  });
});
