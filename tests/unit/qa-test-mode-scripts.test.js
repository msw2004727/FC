"use strict";

const fs = require("fs");
const path = require("path");
const lib = require("../../scripts/qa-test-mode/lib");
const core = require("../../functions/qa-test-mode-core");
const listCustomRolesScript = require("../../scripts/qa-test-mode/list-custom-roles");

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
    // 測試同步更新（T-028 加場主）
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

      const venueOwner = lib.buildUserDoc({ persona: personas.venueOwner, team, now });
      expect(venueOwner.role).toBe("venue_owner");
      expect(venueOwner.displayName).toBe("QA測試-場主");
      expect(venueOwner.teamId).toBe("tm_1");
      expect(venueOwner.teamIds).toEqual(["tm_1"]);
      expect(venueOwner.teamNames).toEqual(["QA測試俱樂部"]);
    });
  });

  describe("QA_ALLOWED_ROLES 與核心一致", () => {
    it("兩邊排序後相同，含 venue_owner，不含 admin 與 super_admin", () => {
      const coreRoles = [...core.QA_ALLOWED_ROLES].sort();
      const libRoles = [...lib.QA_ALLOWED_ROLES].sort();
      expect(libRoles).toEqual(coreRoles);
      expect(coreRoles).toEqual(["captain", "coach", "user", "venue_owner"]);
      for (const roles of [coreRoles, libRoles]) {
        expect(roles).not.toContain("admin");
        expect(roles).not.toContain("super_admin");
        expect(roles).toContain("venue_owner");
      }
    });
  });

  describe("defaultPersonas", () => {
    // 測試同步更新（T-028 加場主）
    it("UID、role、顯示名稱前綴都符合不變量", () => {
      const personas = lib.defaultPersonas();
      expect(Object.keys(personas)).toEqual([
        "captain", "coach", "venueOwner", "memberA", "memberB",
      ]);
      for (const persona of Object.values(personas)) {
        expect(persona.uid).toMatch(lib.QA_UID_RE);
        expect(lib.QA_ALLOWED_ROLES.has(persona.role)).toBe(true);
        expect(persona.displayName.startsWith(lib.QA_DISPLAY_NAME_PREFIX)).toBe(true);
        expect(persona.teamKey).toBe("main");
        expect(persona.enabled).toBe(true);
      }
      expect(personas.captain.uid.endsWith("0001")).toBe(true);
      expect(personas.coach.uid.endsWith("0002")).toBe(true);
      expect(personas.venueOwner.uid.endsWith("0003")).toBe(true);
      expect(personas.venueOwner.role).toBe("venue_owner");
      expect(personas.venueOwner.displayName).toBe("QA測試-場主");
      expect(personas.memberA.uid.endsWith("0011")).toBe(true);
      expect(personas.memberB.uid.endsWith("0012")).toBe(true);
    });
  });

  describe("buildTeamDoc", () => {
    // 測試同步更新（T-028 加場主）
    it("id、captainUid、coachUids 對應 persona，場主計入 members 但不入幹部", () => {
      const personas = lib.defaultPersonas();
      const doc = lib.buildTeamDoc({
        teamId: "tm_abc",
        name: "QA測試俱樂部",
        personas,
        now: "NOW",
      });
      expect(doc.id).toBe("tm_abc");
      expect(doc.captainUid).toBe(personas.captain.uid);
      expect(doc.captain).toBe(personas.captain.displayName);
      expect(doc.captainName).toBe(personas.captain.displayName);
      expect(doc.coachUids).toEqual([personas.coach.uid]);
      expect(doc.coachNames).toEqual([personas.coach.displayName]);
      expect(doc.captainUid).not.toBe(personas.venueOwner.uid);
      expect(doc.coachUids).not.toContain(personas.venueOwner.uid);
      // captain、coach、venueOwner、memberA 入隊；memberB 不入隊。
      expect(doc.members).toBe(4);
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

    it("靜態掃描包含 list-custom-roles.js", () => {
      const file = path.join(SCRIPT_DIR, "list-custom-roles.js");
      expect(files).toContain(file);
      const text = fs.readFileSync(file, "utf8");
      expect(text).toContain("本腳本唯讀，忽略 --execute");
      expect(text).toContain("customRoles");
      expect(text).not.toMatch(/fc-football/i);
      expect(text).not.toMatch(/projectId:\s*["']/);
    });
  });

  describe("list-custom-roles", () => {
    const { deriveCustomRoleLevels, listCustomRoles, resolveListTarget } = listCustomRolesScript;

    describe("deriveCustomRoleLevels", () => {
      it("空陣列回空陣列", () => {
        expect(deriveCustomRoleLevels([])).toEqual([]);
      });

      it("afterRole 缺省時接在 captain 之後，level 介於 2 與 3", () => {
        const roles = deriveCustomRoleLevels([
          { key: "scout", label: "偵察" },
        ]);
        expect(roles).toEqual([{
          key: "scout",
          label: "偵察",
          afterRole: "captain",
          derivedLevel: 2.5,
          belowAdmin: true,
        }]);
        expect(roles[0].derivedLevel).toBeGreaterThan(2);
        expect(roles[0].derivedLevel).toBeLessThan(3);
      });

      it("同一父角色下多個自訂角色等分插值", () => {
        const roles = deriveCustomRoleLevels([
          { key: "a", label: "A", afterRole: "captain" },
          { key: "b", label: "B", afterRole: "captain" },
        ]);
        expect(roles.map((role) => role.key)).toEqual(["a", "b"]);
        expect(roles[0].derivedLevel).toBeCloseTo(2 + (1 / 3), 10);
        expect(roles[1].derivedLevel).toBeCloseTo(2 + (2 / 3), 10);
        expect(roles[0].belowAdmin).toBe(true);
        expect(roles[1].belowAdmin).toBe(true);
      });

      it("掛在 venue_owner 後", () => {
        const roles = deriveCustomRoleLevels([
          { key: "host", label: "Host", afterRole: "venue_owner" },
        ]);
        expect(roles).toEqual([{
          key: "host",
          label: "Host",
          afterRole: "venue_owner",
          derivedLevel: 3.5,
          belowAdmin: true,
        }]);
      });

      it("掛在 admin 後，level 介於 4 與 5，belowAdmin 為 false", () => {
        const roles = deriveCustomRoleLevels([
          { key: "ops", label: "Ops", afterRole: "admin" },
        ]);
        expect(roles).toEqual([{
          key: "ops",
          label: "Ops",
          afterRole: "admin",
          derivedLevel: 4.5,
          belowAdmin: false,
        }]);
        expect(roles[0].derivedLevel).toBeGreaterThan(4);
        expect(roles[0].derivedLevel).toBeLessThan(5);
      });

      it("掛在 super_admin 後，level 大於等於 4，belowAdmin 為 false", () => {
        const roles = deriveCustomRoleLevels([
          { key: "rootish", label: "Rootish", afterRole: "super_admin" },
        ]);
        expect(roles).toHaveLength(1);
        expect(roles[0]).toMatchObject({
          key: "rootish",
          label: "Rootish",
          afterRole: "super_admin",
          derivedLevel: 4.5,
          belowAdmin: false,
        });
        expect(roles[0].derivedLevel).toBeGreaterThanOrEqual(4);
      });

      it("afterRole 指向不存在的 key 時視為不可入白名單", () => {
        const roles = deriveCustomRoleLevels([
          { key: "lost", label: "Lost", afterRole: "no_such_role" },
        ]);
        expect(roles).toEqual([{
          key: "lost",
          label: "Lost",
          afterRole: "no_such_role",
          derivedLevel: 4.5,
          belowAdmin: false,
        }]);
      });

      it("兩個自訂角色互為 afterRole 的循環不會無窮迴圈，且 belowAdmin 為 false", () => {
        const roles = deriveCustomRoleLevels([
          { key: "loopA", label: "A", afterRole: "loopB" },
          { key: "loopB", label: "B", afterRole: "loopA" },
        ]);
        expect(roles.map((role) => role.key)).toEqual(["loopA", "loopB"]);
        expect(roles[0].derivedLevel).toBeCloseTo(4 + (1 / 3), 10);
        expect(roles[1].derivedLevel).toBeCloseTo(4 + (2 / 3), 10);
        expect(roles.every((role) => role.belowAdmin === false)).toBe(true);
        expect(roles.every((role) => role.derivedLevel >= 4)).toBe(true);
      });

      it("key 缺失或空字串的項目被略過", () => {
        const roles = deriveCustomRoleLevels([
          { label: "沒有 key" },
          { key: "" },
          { key: "   ", label: "空白" },
          null,
          { key: "ok", label: "OK", afterRole: "user" },
        ]);
        expect(roles).toEqual([{
          key: "ok",
          label: "OK",
          afterRole: "user",
          derivedLevel: 0.5,
          belowAdmin: true,
        }]);
      });

      it("label 缺省時回 key", () => {
        const roles = deriveCustomRoleLevels([
          { key: "scout", afterRole: "coach" },
        ]);
        expect(roles).toEqual([{
          key: "scout",
          label: "scout",
          afterRole: "coach",
          derivedLevel: 1.5,
          belowAdmin: true,
        }]);
      });

      it("依推導序列排序，而不是輸入順序", () => {
        const roles = deriveCustomRoleLevels([
          { key: "late", label: "Late", afterRole: "admin" },
          { key: "early", label: "Early", afterRole: "user" },
        ]);
        expect(roles.map((role) => role.key)).toEqual(["early", "late"]);
        expect(roles[0].derivedLevel).toBe(0.5);
        expect(roles[0].belowAdmin).toBe(true);
        expect(roles[1].derivedLevel).toBe(4.5);
        expect(roles[1].belowAdmin).toBe(false);
      });
    });

    describe("listCustomRoles", () => {
      function readOnlyDb(docs) {
        const throwWrite = () => {
          throw new Error("不應寫入");
        };
        const set = jest.fn(throwWrite);
        const update = jest.fn(throwWrite);
        const del = jest.fn(throwWrite);
        const add = jest.fn(throwWrite);
        const batch = jest.fn(throwWrite);
        const runTransaction = jest.fn(throwWrite);
        const bulkWriter = jest.fn(throwWrite);
        const writes = { set, update, delete: del, add };
        const db = {
          ...writes,
          batch,
          runTransaction,
          bulkWriter,
          collection(name) {
            if (name !== "customRoles") throw new Error(`不該讀 ${name}`);
            return {
              ...writes,
              doc() {
                return writes;
              },
              get: async () => ({ docs }),
            };
          },
        };
        return { db, set, update, del, add, batch, runTransaction, bulkWriter };
      }

      function expectNoWrites(spies) {
        expect(spies.set).not.toHaveBeenCalled();
        expect(spies.update).not.toHaveBeenCalled();
        expect(spies.del).not.toHaveBeenCalled();
        expect(spies.add).not.toHaveBeenCalled();
        expect(spies.batch).not.toHaveBeenCalled();
        expect(spies.runTransaction).not.toHaveBeenCalled();
        expect(spies.bulkWriter).not.toHaveBeenCalled();
      }

      // 測試同步更新（T-028 A2）
      it("讀 customRoles，缺 key 時用文件 id，且不寫入", async () => {
        const harness = readOnlyDb([
          {
            id: "fromId",
            data: () => ({ label: "從文件", afterRole: "coach" }),
          },
          {
            id: "ignoredId",
            data: () => ({ key: "named", label: "有 key", afterRole: "user" }),
          },
        ]);

        const listed = await listCustomRoles(harness.db);
        expect(listed).toEqual({
          roles: [
            {
              key: "named",
              label: "有 key",
              afterRole: "user",
              derivedLevel: 0.5,
              belowAdmin: true,
              docId: "ignoredId",
              keyMismatch: true,
            },
            {
              key: "fromId",
              label: "從文件",
              afterRole: "coach",
              derivedLevel: 1.5,
              belowAdmin: true,
              docId: "fromId",
              keyMismatch: false,
            },
          ],
          documentCount: 2,
          duplicateKeys: [],
          keyMismatchCount: 1,
        });
        expectNoWrites(harness);
      });

      it("文件 id 為 ops、data.key 為 scout 時標出 keyMismatch", async () => {
        const harness = readOnlyDb([
          {
            id: "ops",
            data: () => ({ key: "scout", label: "偵察", afterRole: "captain" }),
          },
        ]);

        const listed = await listCustomRoles(harness.db);
        expect(listed.keyMismatchCount).toBe(1);
        expect(listed.documentCount).toBe(1);
        expect(listed.duplicateKeys).toEqual([]);
        expect(listed.roles).toEqual([{
          key: "scout",
          label: "偵察",
          afterRole: "captain",
          derivedLevel: 2.5,
          belowAdmin: true,
          docId: "ops",
          keyMismatch: true,
        }]);
        expectNoWrites(harness);
      });

      it("data.key 缺失或空白時 key 用文件 id 且 keyMismatch 為 false", async () => {
        const missing = readOnlyDb([
          {
            id: "fromId",
            data: () => ({ label: "從文件", afterRole: "coach" }),
          },
        ]);
        const missingListed = await listCustomRoles(missing.db);
        expect(missingListed.keyMismatchCount).toBe(0);
        expect(missingListed.roles).toEqual([{
          key: "fromId",
          label: "從文件",
          afterRole: "coach",
          derivedLevel: 1.5,
          belowAdmin: true,
          docId: "fromId",
          keyMismatch: false,
        }]);
        expectNoWrites(missing);

        const blank = readOnlyDb([
          {
            id: "emptyId",
            data: () => ({ key: "", label: "空", afterRole: "user" }),
          },
          {
            id: "spaceId",
            data: () => ({ key: "   ", label: "空白", afterRole: "coach" }),
          },
        ]);
        const blankListed = await listCustomRoles(blank.db);
        expect(blankListed.documentCount).toBe(2);
        expect(blankListed.keyMismatchCount).toBe(0);
        expect(blankListed.duplicateKeys).toEqual([]);
        expect(blankListed.roles).toEqual([
          {
            key: "emptyId",
            label: "空",
            afterRole: "user",
            derivedLevel: 0.5,
            belowAdmin: true,
            docId: "emptyId",
            keyMismatch: false,
          },
          {
            key: "spaceId",
            label: "空白",
            afterRole: "coach",
            derivedLevel: 1.5,
            belowAdmin: true,
            docId: "spaceId",
            keyMismatch: false,
          },
        ]);
        expectNoWrites(blank);
      });

      it("兩份文件 data.key 相同時去重並列入 duplicateKeys", async () => {
        const harness = readOnlyDb([
          {
            id: "scout",
            data: () => ({ key: "scout", label: "第一份", afterRole: "captain" }),
          },
          {
            id: "other",
            data: () => ({ key: "scout", label: "第二份", afterRole: "admin" }),
          },
        ]);

        const listed = await listCustomRoles(harness.db);
        expect(listed.documentCount).toBe(2);
        expect(listed.roles).toHaveLength(1);
        expect(listed.duplicateKeys).toEqual(["scout"]);
        expect(listed.roles[0]).toEqual({
          key: "scout",
          label: "第一份",
          afterRole: "captain",
          derivedLevel: 2.5,
          belowAdmin: true,
          docId: "scout",
          keyMismatch: false,
        });
        // 第二份文件 id 與 key 不同；計數按文件，不跟去重後的角色旗標。
        expect(listed.keyMismatchCount).toBe(1);
        expectNoWrites(harness);
      });

      it("duplicateKeys 依 key 排序", async () => {
        const harness = readOnlyDb([
          {
            id: "z1",
            data: () => ({ key: "zeta", label: "Z", afterRole: "captain" }),
          },
          {
            id: "a1",
            data: () => ({ key: "alpha", label: "A", afterRole: "user" }),
          },
          {
            id: "z2",
            data: () => ({ key: "zeta", label: "Z2", afterRole: "admin" }),
          },
          {
            id: "a2",
            data: () => ({ key: "alpha", label: "A2", afterRole: "coach" }),
          },
        ]);

        const listed = await listCustomRoles(harness.db);
        expect(listed.documentCount).toBe(4);
        expect(listed.roles).toHaveLength(2);
        expect(listed.duplicateKeys).toEqual(["alpha", "zeta"]);
        expectNoWrites(harness);
      });
    });

    describe("resolveListTarget", () => {
      const project = { project: "demo-qa-test" };
      const productionMessage = "正式環境即使唯讀也必須同時提供 --production 與 --confirm-project，且值必須與專案 ID 相同";

      it("emulator env 齊全 → mode emulator", () => {
        expect(resolveListTarget({ args: project, env: EMULATOR_ENV })).toEqual({
          mode: "emulator",
          projectId: "demo-qa-test",
        });
      });

      it("只有一個 emulator env → 丟錯", () => {
        expect(() => resolveListTarget({
          args: project,
          env: { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" },
        })).toThrow();
        expect(() => resolveListTarget({
          args: project,
          env: { FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099" },
        })).toThrow();
      });

      it("無 emulator 且無 --production → 丟錯", () => {
        expect(() => resolveListTarget({ args: project, env: {} })).toThrow();
      });

      it("有 --production 但缺 --confirm-project 或不符 → 丟錯", () => {
        expect(() => resolveListTarget({
          args: { ...project, production: true },
          env: {},
        })).toThrow(productionMessage);
        expect(() => resolveListTarget({
          args: { ...project, production: true, confirmProject: "other-project" },
          env: {},
        })).toThrow(productionMessage);
      });

      it("齊全 → mode production，--execute 不改變模式", () => {
        const expected = { mode: "production", projectId: "demo-qa-test" };
        expect(resolveListTarget({
          args: { ...project, production: true, confirmProject: "demo-qa-test" },
          env: {},
        })).toEqual(expected);
        expect(resolveListTarget({
          args: {
            ...project,
            production: true,
            confirmProject: "demo-qa-test",
            execute: true,
          },
          env: {},
        })).toEqual(expected);
      });
    });
  });
});
