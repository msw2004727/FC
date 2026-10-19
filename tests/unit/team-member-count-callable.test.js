"use strict";

const {
  countTeamMembers,
  createRecountTeamMembersHandler,
} = require("../../functions/team-member-count");

class MockHttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

describe("recountTeamMembers — pure function & callable", () => {
  describe("countTeamMembers (golden scenarios from team-member-count.test.js)", () => {
    test("counts active extra students and deduplicates linked user students", () => {
      const students = [
        { id: "stu-cache", name: "快取學員", enrollStatus: "active" },
        { id: "stu-linked", name: "正式隊員學員", selfUid: "member", enrollStatus: "active" },
        { id: "stu-pending", name: "待審核學員", enrollStatus: "pending" },
      ];
      const users = [
        { uid: "member", name: "正式隊員", teamId: "teamA" },
        { uid: "captain", name: "經理" },
      ];
      const team = {
        id: "teamA",
        captainUid: "captain",
        students: [
          { id: "stu-direct", name: "手動新增學員", enrollStatus: "active" },
          { id: "stu-removed", name: "移除學員", enrollStatus: "removed" },
        ],
      };

      const result = countTeamMembers({ team, users, students });
      expect(result.members).toBe(4);
      expect(result.notes).toEqual([]);
    });

    test("deduplicates staff across captainUid, leaderUids, coachUids and teamIds members", () => {
      const team = {
        id: "teamB",
        captainUid: "u_cap",
        leaderUids: ["u_lead1", "u_cap"],
        leaderUid: "u_legacy_ignored_when_array_present",
        coachUids: ["u_coach1", "u_lead1"],
      };
      const users = [
        { uid: "u_cap", teamIds: ["teamB"] },
        { uid: "u_lead1", teamIds: ["teamB"] },
        { uid: "u_member1", teamIds: ["teamB"] },
        { uid: "u_other", teamIds: ["teamC"] },
      ];

      const result = countTeamMembers({ team, users, students: [] });
      // u_cap, u_lead1, u_coach1, u_member1 = 4
      expect(result.members).toBe(4);
    });

    test("omits name-only fallback keys and reports in notes (R-ID-002)", () => {
      const team = {
        id: "teamC",
        captainUid: "u_cap",
      };
      const users = [
        { uid: "u_cap", name: "Captain" },
        { name: "LegacyNoUidUser", teamId: "teamC" },
      ];
      const students = [
        { name: "NameOnlyStudent", enrollStatus: "active" },
        { id: "stu_1", name: "ValidStudent", enrollStatus: "active" },
      ];

      const result = countTeamMembers({ team, users, students });
      // u_cap + stu_1 = 2
      expect(result.members).toBe(2);
      expect(result.notes).toHaveLength(2);
      expect(result.notes[0]).toMatch(/R-ID-002/);
      expect(result.notes[1]).toMatch(/R-ID-002/);
    });
  });

  describe("Callable handler: reads all sources and writes only members + updatedAt", () => {
    function createMockTeamDb({
      teamData = { id: "teamA", captainUid: "u_captain", coachUids: ["u_coach"] },
      teamIdsUsers = [],
      legacyTeamIdUsers = [],
      staffUsersByUid = {},
      students = [],
    } = {}) {
      const updateCalls = [];
      const teamDocRef = {
        id: "teamA",
        path: "teams/teamA",
        collection: jest.fn((sub) => {
          if (sub !== "students") throw new Error(`Unexpected subcollection: ${sub}`);
          return {
            get: jest.fn(async () => ({
              docs: students.map((s, i) => ({ id: s._docId || s.id || `stu_${i}`, exists: true, data: () => s })),
            })),
          };
        }),
        update: jest.fn(async (payload) => {
          updateCalls.push(payload);
        }),
      };

      const teamSnap = {
        exists: true,
        id: "teamA",
        ref: teamDocRef,
        data: () => teamData,
      };

      const db = {
        collection: jest.fn((colName) => {
          if (colName === "teams") {
            return {
              doc: jest.fn(() => ({
                get: jest.fn(async () => teamSnap),
              })),
              where: jest.fn(() => ({
                limit: jest.fn(() => ({
                  get: jest.fn(async () => ({ docs: [teamSnap] })),
                })),
              })),
            };
          }
          if (colName === "users") {
            return {
              where: jest.fn((field, op, val) => ({
                get: jest.fn(async () => {
                  if (field === "teamIds" && op === "array-contains" && val === "teamA") {
                    return {
                      docs: teamIdsUsers.map((u) => ({ id: u._docId || u.uid, exists: true, data: () => u })),
                    };
                  }
                  if (field === "teamId" && op === "==" && val === "teamA") {
                    return {
                      docs: legacyTeamIdUsers.map((u) => ({ id: u._docId || u.uid, exists: true, data: () => u })),
                    };
                  }
                  return { docs: [] };
                }),
              })),
              doc: jest.fn((uid) => ({
                get: jest.fn(async () => {
                  const u = staffUsersByUid[uid];
                  return u
                    ? { id: uid, exists: true, data: () => u }
                    : { id: uid, exists: false, data: () => null };
                }),
              })),
            };
          }
          throw new Error(`Unexpected collection: ${colName}`);
        }),
      };

      const handler = createRecountTeamMembersHandler({
        HttpsError: MockHttpsError,
        db,
        FieldValue: { serverTimestamp: () => "SERVER_TS" },
        getCallerAccessContext: jest.fn(async () => ({
          role: "user",
          isSuperAdmin: false,
          hasPermission: () => false,
        })),
        logger: { error: jest.fn() },
      });

      return { handler, updateCalls };
    }

    test("rejects unauthenticated requests", async () => {
      const { handler } = createMockTeamDb();
      await expect(handler({ auth: null, data: { teamId: "teamA" } }))
        .rejects.toMatchObject({ code: "unauthenticated" });
    });

    test("queries teamIds, legacy teamId, staff users, and students subcollection, then writes only members and updatedAt", async () => {
      const { handler, updateCalls } = createMockTeamDb({
        teamData: {
          id: "teamA",
          name: "Alpha FC",
          captainUid: "u_captain",
          coachUids: ["u_coach"],
        },
        teamIdsUsers: [
          { uid: "u_m1", teamIds: ["teamA"] },
          { uid: "u_m2", teamIds: ["teamA"] },
        ],
        legacyTeamIdUsers: [
          { uid: "u_m2", teamId: "teamA" }, // 與 teamIds 重複
          { uid: "u_legacy", teamId: "teamA" },
        ],
        staffUsersByUid: {
          u_captain: { uid: "u_captain", name: "Cap" },
          u_coach: { uid: "u_coach", name: "Coach" },
        },
        students: [
          { id: "stu_1", enrollStatus: "active" },
          { id: "stu_2", selfUid: "u_m1", enrollStatus: "active" }, // 與正式隊員去重
          { id: "stu_3", enrollStatus: "pending" }, // 不計入
        ],
      });

      // 由剛退隊的一般成員觸發重算
      const res = await handler({
        auth: { uid: "u_just_left_member" },
        data: { teamId: "teamA" },
      });

      // u_captain, u_coach, u_m1, u_m2, u_legacy, stu_1 = 6
      expect(res).toEqual({
        success: true,
        members: 6,
      });

      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0]).toEqual({
        members: 6,
        updatedAt: "SERVER_TS",
      });
    });
  });
});
